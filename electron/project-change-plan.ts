// Mevcut projelere güvenli özellik ekleme: önce değişiklik planı (hangi dosya
// yeni / hangisi düzenlenecek), hedefli düzenleme (tam yeniden yazım yok),
// değişiklik öncesi/sonrası doğrulama ve kullanıcı değişikliklerini ezmeme.
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { applyPatchToContent } from './agent-editing.ts'
import { analyzeProjectFiles, relativePathProblem, type PlanIssue } from './project-analysis.ts'
import { ancestorStaysInside } from './project-writer.ts'
import { formatVerificationReport, readProjectSources, verifyProject } from './project-verifier.ts'
import type { ProjectStack } from './project-template-registry.ts'

export type ProjectProfile = {
  language: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'unknown'
  framework?: string
  stack?: ProjectStack
  importStyle: 'esm' | 'commonjs' | 'python-packages' | 'go-modules' | 'rust-modules' | 'unknown'
  buildCommand?: string
  testCommand?: string
}

export type FileCreate = { path: string; content: string; purpose?: string }
export type FileEdit = { path: string; oldText: string; newText: string; replaceAll?: boolean }
export type ChangeRequest = { creates?: FileCreate[]; edits?: FileEdit[] }

export type PlannedEdit = { path: string; before: string; sha256: string; after: string; replacements: number }
export type PlannedCreate = { path: string; content: string; purpose: string }

export type ChangePlan = {
  root: string
  profile: ProjectProfile
  creates: PlannedCreate[]
  edits: PlannedEdit[]
  /** Planlanıp zaten var olduğu için oluşturulmayacak dosyalar. */
  skipped: Array<{ path: string; reason: string }>
  /** Değişiklik nedeniyle ortaya çıkan (önceden olmayan) bulgular. */
  issues: PlanIssue[]
}

export type VerifyOutcome = { ok: boolean; detail?: string }
export type ChangeReport = {
  phase: 'edit'
  ok: boolean
  created: string[]
  edited: string[]
  skipped: Array<{ path: string; reason: string }>
  failed: Array<{ path: string; error: string }>
  notAttempted: string[]
  baseline?: VerifyOutcome
  after?: VerifyOutcome
  issues: PlanIssue[]
  error?: string
}

export type ApplyOptions = {
  /** Değişiklikten önce ve sonra çağrılır (ör. typecheck/test). */
  verify?: () => Promise<VerifyOutcome>
  authorize?: (request: { root: string; creates: string[]; edits: string[] }) => boolean | Promise<boolean>
  /** Başlangıç doğrulaması başarısız olsa da devam et (varsayılan: hayır). */
  proceedOnFailingBaseline?: boolean
}

const MAX_EDIT_BYTES = 1_000_000

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function issueKey(issue: PlanIssue): string {
  return `${issue.severity}|${issue.code}|${issue.path ?? ''}|${issue.message}`
}

export async function detectProject(root: string): Promise<ProjectProfile> {
  const read = (file: string) => fs.readFile(path.join(root, file), 'utf8').catch(() => undefined)
  const packageText = await read('package.json')
  if (packageText !== undefined) {
    let manifest: { type?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {}
    try { manifest = JSON.parse(packageText) } catch { /* geçersiz manifest: varsayılanlarla devam */ }
    const deps = { ...manifest.dependencies, ...manifest.devDependencies }
    const has = (name: string) => name in deps
    const framework = has('next') ? 'next' : has('electron') || has('electron-vite') ? 'electron' : has('react') ? 'react' : has('express') ? 'express' : undefined
    const stack: ProjectStack | undefined = has('next') ? 'next' : framework === 'electron' ? 'electron' : manifest.scripts?.['dev:server'] ? 'fullstack' : has('react') ? (has('vite') ? 'vite' : 'react') : has('express') ? 'express' : 'node'
    const typescript = has('typescript') || (await read('tsconfig.json')) !== undefined
    return {
      language: typescript ? 'typescript' : 'javascript',
      framework,
      stack,
      importStyle: manifest.type === 'module' ? 'esm' : 'commonjs',
      buildCommand: manifest.scripts?.build ? 'npm run build' : undefined,
      testCommand: manifest.scripts?.test ? 'npm test' : undefined,
    }
  }
  const requirements = (await read('requirements.txt')) ?? (await read('pyproject.toml'))
  if (requirements !== undefined) {
    return {
      language: 'python',
      framework: /fastapi/i.test(requirements) ? 'fastapi' : undefined,
      stack: 'python-fastapi',
      importStyle: 'python-packages',
      buildCommand: 'python -m compileall -q .',
      testCommand: /pytest/i.test(requirements) ? 'python -m pytest' : undefined,
    }
  }
  if ((await read('go.mod')) !== undefined) return { language: 'go', stack: 'go', importStyle: 'go-modules', buildCommand: 'go build ./...', testCommand: 'go test ./...' }
  if ((await read('Cargo.toml')) !== undefined) return { language: 'rust', stack: 'rust', importStyle: 'rust-modules', buildCommand: 'cargo check', testCommand: 'cargo test' }
  return { language: 'unknown', importStyle: 'unknown' }
}

async function resolveSafe(realRoot: string, relative: string): Promise<{ target: string } | { problem: string }> {
  const problem = relativePathProblem(relative)
  if (problem) return { problem: `${problem} (${relative})` }
  const target = path.resolve(realRoot, relative)
  if (!within(realRoot, target) || !(await ancestorStaysInside(realRoot, target))) return { problem: `Yol proje kökünün dışına çıkıyor: ${relative}` }
  return { target }
}

/** Değişiklik planı: diske yazmaz; düzenlemeleri bellekte uygular ve tutarlılığı denetler. */
export async function planChange(root: string, request: ChangeRequest): Promise<ChangePlan> {
  const realRoot = await fs.realpath(path.resolve(root))
  const profile = await detectProject(realRoot)
  const issues: PlanIssue[] = []
  const error = (code: string, message: string, file?: string) => issues.push({ severity: 'error', code, message, path: file })
  const plan: ChangePlan = { root: realRoot, profile, creates: [], edits: [], skipped: [], issues }

  const baseline = await readProjectSources(realRoot)
  const merged = new Map(baseline)
  const editsByPath = new Map<string, PlannedEdit>()

  for (const edit of request.edits ?? []) {
    const resolved = await resolveSafe(realRoot, edit.path)
    if ('problem' in resolved) { error('unsafe-path', resolved.problem, edit.path); continue }
    const existing = editsByPath.get(edit.path)
    let before = existing?.before
    if (before === undefined) {
      const stat = await fs.lstat(resolved.target).catch(() => undefined)
      if (!stat?.isFile() || stat.size > MAX_EDIT_BYTES) { error('edit-target', `Düzenlenecek dosya yok, sıradan dosya değil veya çok büyük: ${edit.path}`, edit.path); continue }
      before = await fs.readFile(resolved.target, 'utf8')
    }
    const applied = applyPatchToContent(existing?.after ?? before, edit.oldText, edit.newText, edit.replaceAll)
    if (!applied.ok) { error('edit-failed', `${edit.path}: ${applied.error}`, edit.path); continue }
    const planned: PlannedEdit = { path: edit.path, before, sha256: existing?.sha256 ?? sha(before), after: applied.content, replacements: (existing?.replacements ?? 0) + applied.replacements }
    editsByPath.set(edit.path, planned)
    merged.set(edit.path, planned.after)
  }
  plan.edits = [...editsByPath.values()]

  const seen = new Set<string>()
  for (const create of request.creates ?? []) {
    const resolved = await resolveSafe(realRoot, create.path)
    if ('problem' in resolved) { error('unsafe-path', resolved.problem, create.path); continue }
    if (seen.has(create.path.toLowerCase()) || editsByPath.has(create.path)) { error('duplicate-path', `Dosya birden fazla kez planlanmış: ${create.path}`, create.path); continue }
    seen.add(create.path.toLowerCase())
    if (await fs.lstat(resolved.target).then(() => true, () => false)) {
      plan.skipped.push({ path: create.path, reason: 'Dosya zaten var; üzerine yazılmadı.' })
      continue
    }
    plan.creates.push({ path: create.path, content: create.content, purpose: create.purpose ?? 'Yeni özellik dosyası' })
    merged.set(create.path, create.content)
  }

  // Yalnızca bu değişiklikle ortaya çıkan yeni bulgular plana yansır.
  const before = new Set(analyzeProjectFiles(baseline).map(issueKey))
  for (const issue of analyzeProjectFiles(merged)) if (!before.has(issueKey(issue))) issues.push(issue)
  return plan
}

export function changePlanHasErrors(plan: ChangePlan): boolean {
  return plan.issues.some((issue) => issue.severity === 'error')
}

/** typecheck/test için varsayılan doğrulayıcı: verifyProject (bağımlılık kurmaz). */
export function projectVerifier(root: string, profile: ProjectProfile, runTests = true): () => Promise<VerifyOutcome> {
  return async () => {
    if (!profile.stack) return { ok: false, detail: 'Proje yığını tanınmadığı için doğrulama çalıştırılamadı.' }
    const report = await verifyProject(root, { stack: profile.stack, runTests })
    return { ok: report.ok, detail: formatVerificationReport(report).join('\n') }
  }
}

export async function applyChangePlan(plan: ChangePlan, options: ApplyOptions = {}): Promise<ChangeReport> {
  const all = [...plan.edits.map((item) => item.path), ...plan.creates.map((item) => item.path)]
  const report: ChangeReport = { phase: 'edit', ok: false, created: [], edited: [], skipped: [...plan.skipped], failed: [], notAttempted: all, issues: plan.issues }

  if (changePlanHasErrors(plan)) { report.error = 'Değişiklik planı hata içeriyor; hiçbir dosya değiştirilmedi.'; return report }
  if (options.authorize && !(await options.authorize({ root: plan.root, creates: plan.creates.map((item) => item.path), edits: plan.edits.map((item) => item.path) }))) {
    report.error = 'Değişiklik izni verilmedi; hiçbir dosya değiştirilmedi.'
    return report
  }

  if (options.verify) {
    report.baseline = await options.verify()
    if (!report.baseline.ok && !options.proceedOnFailingBaseline) {
      report.error = 'Değişiklik öncesi doğrulama başarısız; proje zaten bozuk olduğundan hiçbir dosya değiştirilmedi.'
      return report
    }
  }

  const remaining = new Set(all)
  try {
    for (const edit of plan.edits) {
      const target = path.resolve(plan.root, edit.path)
      if (!(await ancestorStaysInside(plan.root, target))) throw new Error('Yol proje kökünün dışına çıkıyor.')
      const current = await fs.readFile(target, 'utf8').catch(() => undefined)
      if (current === undefined || sha(current) !== edit.sha256) {
        throw new Error('Dosya plan sonrasında değişmiş (kullanıcı değişikliği korunuyor); yeniden planlayın.')
      }
      const temporary = `${target}.ultron-${randomBytes(6).toString('hex')}.tmp`
      const mode = (await fs.stat(target)).mode & 0o777
      await fs.writeFile(temporary, edit.after, { encoding: 'utf8', flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode })
      try {
        await fs.chmod(temporary, mode)
        await fs.rename(temporary, target)
      } catch (error) {
        await fs.rm(temporary, { force: true })
        throw error
      }
      report.edited.push(edit.path)
      remaining.delete(edit.path)
    }
    for (const create of plan.creates) {
      const target = path.resolve(plan.root, create.path)
      if (!(await ancestorStaysInside(plan.root, target))) throw new Error('Yol proje kökünün dışına çıkıyor.')
      await fs.mkdir(path.dirname(target), { recursive: true })
      try {
        await fs.writeFile(target, create.content, { encoding: 'utf8', flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        report.skipped.push({ path: create.path, reason: 'Dosya zaten var; üzerine yazılmadı.' })
        remaining.delete(create.path)
        continue
      }
      report.created.push(create.path)
      remaining.delete(create.path)
    }
  } catch (error) {
    const failing = [...remaining][0]
    report.failed.push({ path: failing ?? '', error: errorMessage(error) })
    report.notAttempted = [...remaining].slice(1)
    report.error = `Değişiklik kısmen uygulandı: ${errorMessage(error)}`
    return report
  }
  report.notAttempted = []

  if (options.verify) {
    report.after = await options.verify()
    if (!report.after.ok) {
      report.error = `Değişiklik sonrası doğrulama başarısız. Değişen dosyalar korunmuştur (otomatik geri alma yapılmadı): ${[...report.edited, ...report.created].join(', ')}`
      return report
    }
  }
  report.ok = true
  return report
}
