// Aşama 2 – Yazma: yalnızca doğrulanmış bir ProjectPlan'ı diske yazar.
// Politika: üzerine yazma yok (`never`), silme yok, tüm yollar proje kökü içinde
// (symlink/`..` dahil) doğrulanır, kısmi yazmada net rapor üretilir.
import { constants } from 'node:fs'
import { lstat, mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PlanIssue } from './project-analysis.ts'
import { checkProjectPlan, hasPlanErrors, type ProjectPlan } from './project-plan.ts'

export type WriteSkip = { path: string; reason: string }
export type WriteFailure = { path: string; error: string }

export type WriteReport = {
  phase: 'write'
  ok: boolean
  root: string
  created: string[]
  directoriesCreated: string[]
  skipped: WriteSkip[]
  failed: WriteFailure[]
  notAttempted: string[]
  issues: PlanIssue[]
  /** true: en az bir dosya yazıldı ama plan tamamlanamadı. */
  partial: boolean
  error?: string
}

export type WriteOptions = {
  root: string
  /** Yazmadan önce bir kez çağrılır; false dönerse hiçbir şey yazılmaz. */
  authorize?: (request: { root: string; files: string[] }) => boolean | Promise<boolean>
  signal?: AbortSignal
}

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target)
    return true
  } catch {
    return false
  }
}

/** Var olan en derin üst dizinin gerçek yolunun kök içinde kaldığını doğrular. */
export async function ancestorStaysInside(realRoot: string, target: string): Promise<boolean> {
  let current = path.dirname(target)
  while (within(realRoot, current)) {
    try {
      return within(realRoot, await realpath(current))
    } catch {
      if (current === realRoot) return false
      current = path.dirname(current)
    }
  }
  return false
}

function failure(root: string, plan: ProjectPlan, partial: Partial<WriteReport>): WriteReport {
  return {
    phase: 'write',
    ok: false,
    root,
    created: [],
    directoriesCreated: [],
    skipped: [],
    failed: [],
    notAttempted: plan.files.map((file) => file.path),
    issues: [],
    partial: false,
    ...partial,
  }
}

export async function writeProjectPlan(plan: ProjectPlan, options: WriteOptions): Promise<WriteReport> {
  const root = path.resolve(options.root)

  const issues = checkProjectPlan(plan)
  if (hasPlanErrors(issues)) {
    return failure(root, plan, { issues, error: 'Plan statik denetimden geçemedi; hiçbir dosya yazılmadı.' })
  }

  if (options.authorize && !(await options.authorize({ root, files: plan.files.map((file) => file.path) }))) {
    return failure(root, plan, { issues, error: 'Yazma izni verilmedi; hiçbir dosya yazılmadı.' })
  }

  // Kök: yoksa oluşturulacak, varsa dizin olmalı.
  let rootExisted = false
  try {
    await lstat(root)
    rootExisted = true
    if (!(await stat(root).then((info) => info.isDirectory(), () => false))) return failure(root, plan, { issues, error: `Hedef bir dizin değil: ${root}` })
  } catch {
    rootExisted = false
  }

  // Ön doğrulama: hiçbir şey yazılmadan önce tüm yollar kök içinde mi?
  if (rootExisted) {
    const realRoot = await realpath(root)
    for (const file of plan.files) {
      const target = path.resolve(realRoot, file.path)
      if (!within(realRoot, target) || !(await ancestorStaysInside(realRoot, target))) {
        return failure(root, plan, {
          issues: [...issues, { severity: 'error', code: 'path-escape', message: `Yol proje kökünün dışına çıkıyor (symlink/..): ${file.path}`, path: file.path }],
          error: `Yol proje kökünün dışına çıkıyor: ${file.path}`,
        })
      }
    }
  }

  const report: WriteReport = failure(root, plan, { ok: true, issues, notAttempted: [] })
  try {
    await mkdir(root, { recursive: true })
  } catch (error) {
    return failure(root, plan, { issues, error: `Proje kökü oluşturulamadı: ${message(error)}` })
  }
  const realRoot = await realpath(root)
  if (!rootExisted) report.directoriesCreated.push('.')

  for (const [index, file] of plan.files.entries()) {
    if (options.signal?.aborted) {
      report.notAttempted = plan.files.slice(index).map((item) => item.path)
      report.ok = false
      report.error = 'Yazma iptal edildi.'
      break
    }
    const target = path.resolve(realRoot, file.path)
    try {
      if (!within(realRoot, target)) throw new Error('Yol proje kökünün dışına çıkıyor.')
      if (await exists(target)) {
        report.skipped.push({ path: file.path, reason: 'Dosya zaten var; üzerine yazılmadı.' })
        continue
      }
      const parent = path.dirname(target)
      if (!(await exists(parent))) {
        if (!(await ancestorStaysInside(realRoot, target))) throw new Error('Üst dizin proje kökünün dışına çıkıyor.')
        await mkdir(parent, { recursive: true })
        report.directoriesCreated.push(path.relative(realRoot, parent).split(path.sep).join('/'))
      }
      if (!within(realRoot, await realpath(parent))) throw new Error('Üst dizin proje kökünün dışına çıkıyor.')
      // wx: dosya (symlink dahil) varsa yazma reddedilir; yarış durumunda da ezme olmaz.
      await writeFile(target, file.content, { encoding: 'utf8', flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL })
      report.created.push(file.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        report.skipped.push({ path: file.path, reason: 'Dosya zaten var; üzerine yazılmadı.' })
        continue
      }
      report.failed.push({ path: file.path, error: message(error) })
      report.notAttempted = plan.files.slice(index + 1).map((item) => item.path)
      report.ok = false
      report.error = `"${file.path}" yazılamadı: ${message(error)}`
      break
    }
  }
  report.partial = !report.ok && report.created.length > 0
  return report
}
