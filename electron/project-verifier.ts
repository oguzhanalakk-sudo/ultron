import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { analyzeProjectFiles, tomlProblem, type PlanIssue } from './project-analysis.ts'
import type { ProjectStack } from './project-template-registry.ts'

export type VerificationResult = {
  ok: boolean
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
}

export type ProjectVerificationReport = {
  ok: boolean
  checks: string[]
  outputs: string[]
}

const MAX_OUTPUT_CHARS = 500_000

function appendBounded(current: string, chunk: unknown): string {
  const remaining = MAX_OUTPUT_CHARS - current.length
  return remaining <= 0 ? current : current + String(chunk).slice(0, remaining)
}

// Yalnızca üst düzey, ayırıcı içermeyen dizin/dosya adları: yol gezintisi ve bayrak enjeksiyonu yok.
const COMPILEALL_PATTERN = /^python -m compileall -q(?: [A-Za-z0-9_][A-Za-z0-9_.-]*)+$/

function allowedCommand(command: string, args: string[]): boolean {
  const joined = [command, ...args].join(' ')
  return joined === 'npm install'
    || joined === 'npm run build'
    || joined === 'python -m pip install -r requirements.txt'
    || joined === 'python -m py_compile app.py'
    || COMPILEALL_PATTERN.test(joined)
    || joined === 'npm test'
    || joined === 'python -m pytest'
    || joined === 'go build ./...'
    || joined === 'go test ./...'
    || joined === 'cargo check'
    || joined === 'cargo test'
}

async function runProcess(
  root: string,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<VerificationResult> {
  if (!allowedCommand(command, args)) {
    return { ok: false, command: [command, ...args].join(' '), stdout: '', stderr: 'Doğrulama komutu izin listesinde değil.', exitCode: 126 }
  }

  const workingDirectory = await fs.realpath(path.resolve(root))
  if (!(await fs.stat(workingDirectory)).isDirectory()) {
    return { ok: false, command: [command, ...args].join(' '), stdout: '', stderr: 'Proje klasörü bulunamadı.', exitCode: 1 }
  }

  const isNpm = command === 'npm'
  const executable = isNpm && process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : command
  const executableArgs = isNpm && process.platform === 'win32'
    ? ['/d', '/s', '/c', ['npm', ...args].join(' ')]
    : args
  const displayCommand = [command, ...args].join(' ')

  return await new Promise<VerificationResult>((resolve) => {
    let child: ChildProcess
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const finish = (exitCode: number | null, spawnError?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (spawnError) stderr = appendBounded(stderr, `${stderr ? '\n' : ''}${spawnError.message}`)
      if (timedOut) stderr = appendBounded(stderr, `${stderr ? '\n' : ''}İşlem ${timeoutMs} ms zaman aşımına uğradı.`)
      resolve({ ok: !timedOut && exitCode === 0, command: displayCommand, stdout, stderr, exitCode: timedOut ? null : exitCode })
    }

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid && process.platform === 'win32') {
        const killer = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `taskkill /pid ${child.pid} /t /f`], { windowsHide: true, stdio: 'ignore' })
        killer.unref()
      }
      child.kill()
    }, timeoutMs)

    try {
      child = spawn(executable, executableArgs, {
        cwd: workingDirectory,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout?.on('data', (chunk: Buffer | string) => { stdout = appendBounded(stdout, chunk) })
      child.stderr?.on('data', (chunk: Buffer | string) => { stderr = appendBounded(stderr, chunk) })
      child.once('error', (error) => finish(null, error))
      child.once('close', (code) => finish(code))
    } catch (error) {
      finish(null, error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export async function runVerification(root: string, command: string, args: string[], timeoutMs = 180_000): Promise<VerificationResult> {
  return runProcess(root, command, args, timeoutMs)
}

export async function verifyProjectGeneration(root: string, expectedFiles: string[] = []): Promise<ProjectVerificationReport> {
  const checks: string[] = []
  const outputs: string[] = []
  try {
    const projectRoot = await fs.realpath(path.resolve(root))
    if (!(await fs.stat(projectRoot)).isDirectory()) throw new Error('Proje yolu bir klasör değil.')
    const entries = await fs.readdir(projectRoot)
    checks.push(`Proje klasörü okunuyor (${entries.length} giriş).`)
    outputs.push(...entries.slice(0, 100))

    for (const relative of expectedFiles) {
      const filePath = path.resolve(projectRoot, relative)
      const pathFromRoot = path.relative(projectRoot, filePath)
      if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(pathFromRoot)) {
        checks.push(`Proje dışı dosya yolu reddedildi: ${relative}`)
        continue
      }
      const stat = await fs.stat(filePath).catch(() => undefined)
      checks.push(stat?.isFile() ? `Dosya mevcut: ${relative}` : `Dosya eksik: ${relative}`)
    }

    if (entries.includes('package.json')) {
      try {
        JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
        checks.push('package.json geçerli JSON.')
      } catch {
        checks.push('package.json geçersiz JSON.')
      }
    }

    const ok = checks.every((check) => !check.startsWith('Dosya eksik:') && !check.startsWith('Proje dışı') && !check.includes('geçersiz JSON'))
    return { ok, checks, outputs }
  } catch (error) {
    return { ok: false, checks: ['Proje doğrulaması başarısız.'], outputs: [error instanceof Error ? error.message : String(error)] }
  }
}

export async function installProjectDependencies(root: string, stack: ProjectStack): Promise<{ ok: boolean; output: string[] }> {
  if (stack === 'go' || stack === 'rust') {
    return { ok: true, output: ['Bu yığın için ayrı kurulum adımı yok; bağımlılıklar build doğrulaması sırasında çözülür.'] }
  }
  const command = stack === 'python-fastapi' ? 'python' : 'npm'
  const args = stack === 'python-fastapi' ? ['-m', 'pip', 'install', '-r', 'requirements.txt'] : ['install']
  const result = await runProcess(root, command, args, 900_000)
  return { ok: result.ok, output: [result.command, result.stdout, result.stderr].filter(Boolean) }
}

export async function validateGeneratedBuild(root: string, stack: ProjectStack): Promise<{ ok: boolean; output: string[] }> {
  const step = await buildStep(root, stack)
  if (!step) return { ok: false, output: ['Bu proje için çalıştırılabilir build adımı bulunamadı.'] }
  const result = await runProcess(root, step.command, step.args, 600_000)
  return { ok: result.ok, output: [result.command, result.stdout, result.stderr].filter(Boolean) }
}

export async function verifyGeneratedProject(
  root: string,
  stack: ProjectStack,
  install: boolean,
  expectedFiles: string[] = [],
): Promise<{ ok: boolean; summary: string[]; results: VerificationResult[] }> {
  const report = await verifyProject(root, { stack, install, expectedFiles })
  const results = report.phases.flatMap((phase) => phase.checks.map((check) => check.result).filter((result): result is VerificationResult => Boolean(result)))
  return { ok: report.ok, summary: formatVerificationReport(report), results }
}

// ---------------------------------------------------------------------------
// Aşama 3 – Doğrulama: yazmadan ayrı, aşama bazlı rapor.
// Çalıştırılamayan adımlar "passed" gösterilmez: `skipped` / `not-run` olarak raporlanır.
// ---------------------------------------------------------------------------

export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'not-run'
export type VerificationPhaseName = 'structure' | 'static' | 'install' | 'build' | 'test'

export type VerificationCheck = {
  name: string
  status: CheckStatus
  detail?: string
  command?: string
  result?: VerificationResult
}

export type VerificationPhaseReport = {
  phase: VerificationPhaseName
  ok: boolean
  checks: VerificationCheck[]
  issues: PlanIssue[]
}

export type ProjectVerification = {
  /** Hiçbir kontrol başarısız olmadı ve hiçbir hata bulgusu yok. */
  ok: boolean
  /** Tüm adımlar gerçekten çalıştı (skipped/not-run yok). */
  complete: boolean
  phases: VerificationPhaseReport[]
}

export type VerifyProjectOptions = {
  stack: ProjectStack
  /** Bağımlılık kurulumunu çalıştır (açıkça istenmeli). */
  install?: boolean
  /** Test komutunu çalıştır (yalnızca kullanıcı --verify istediğinde). */
  runTests?: boolean
  expectedFiles?: string[]
  buildTimeoutMs?: number
  testTimeoutMs?: number
  installTimeoutMs?: number
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'target', 'dist', 'out', 'build', '.next', '.pytest_cache', 'coverage'])
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.py', '.go', '.rs', '.toml', '.txt', '.mod', '.css', '.scss', '.html', '.svg', '.md', '.ini', '.yml', '.yaml'])
const MAX_FILES = 2000
const MAX_FILE_BYTES = 512 * 1024

function phase(name: VerificationPhaseName, checks: VerificationCheck[], issues: PlanIssue[] = []): VerificationPhaseReport {
  return {
    phase: name,
    ok: checks.every((check) => check.status !== 'failed') && issues.every((issue) => issue.severity !== 'error'),
    checks,
    issues,
  }
}

function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function exists(target: string): Promise<boolean> {
  return fs.lstat(target).then(() => true, () => false)
}

export async function readProjectSources(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  async function walk(directory: string, prefix: string): Promise<void> {
    if (files.size >= MAX_FILES) return
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.size >= MAX_FILES) return
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) await walk(path.join(directory, entry.name), relative)
        continue
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name)) && entry.name !== 'go.mod') continue
      const full = path.join(directory, entry.name)
      const stat = await fs.stat(full).catch(() => undefined)
      if (!stat || stat.size > MAX_FILE_BYTES) continue
      files.set(relative, await fs.readFile(full, 'utf8'))
    }
  }
  await walk(root, '')
  return files
}

async function readScripts(root: string): Promise<Record<string, string> | undefined> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    return manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {}
  } catch {
    return undefined
  }
}

async function pythonCompileTargets(root: string): Promise<string[]> {
  const targets: string[] = []
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(entry.name) || SKIPPED_DIRECTORIES.has(entry.name)) continue
    if (entry.isFile() && entry.name.endsWith('.py')) targets.push(entry.name)
    if (entry.isDirectory() && (await containsPython(path.join(root, entry.name), 0))) targets.push(entry.name)
  }
  return targets.sort()
}

async function containsPython(directory: string, depth: number): Promise<boolean> {
  if (depth > 6) return false
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name)) continue
    if (entry.isFile() && entry.name.endsWith('.py')) return true
    if (entry.isDirectory() && (await containsPython(path.join(directory, entry.name), depth + 1))) return true
  }
  return false
}

async function buildStep(root: string, stack: ProjectStack): Promise<{ command: string; args: string[] } | undefined> {
  if (stack === 'python-fastapi') {
    const targets = await pythonCompileTargets(root)
    return targets.length ? { command: 'python', args: ['-m', 'compileall', '-q', ...targets] } : undefined
  }
  if (stack === 'go') return { command: 'go', args: ['build', './...'] }
  if (stack === 'rust') return { command: 'cargo', args: ['check'] }
  return { command: 'npm', args: ['run', 'build'] }
}

function describe(result: VerificationResult): string {
  const output = (result.stderr || result.stdout).trim().split(/\r?\n/).slice(-8).join('\n')
  return `çıkış kodu ${result.exitCode ?? 'yok'}${output ? `\n${output}` : ''}`
}

function ranCheck(name: string, result: VerificationResult): VerificationCheck {
  return { name, status: result.ok ? 'passed' : 'failed', command: result.command, detail: result.ok ? undefined : describe(result), result }
}

async function structurePhase(root: string, expectedFiles: string[]): Promise<VerificationPhaseReport> {
  const checks: VerificationCheck[] = []
  const issues: PlanIssue[] = []
  for (const relative of expectedFiles) {
    const target = path.resolve(root, relative)
    if (!insideRoot(root, target)) {
      issues.push({ severity: 'error', code: 'unsafe-path', message: `Proje dışı dosya yolu reddedildi: ${relative}`, path: relative })
      continue
    }
    const stat = await fs.stat(target).catch(() => undefined)
    checks.push({ name: `Dosya mevcut: ${relative}`, status: stat?.isFile() ? 'passed' : 'failed', detail: stat?.isFile() ? undefined : 'Dosya eksik.' })
  }
  for (const manifest of ['package.json', 'Cargo.toml', 'pyproject.toml']) {
    const text = await fs.readFile(path.join(root, manifest), 'utf8').catch(() => undefined)
    if (text === undefined) continue
    let problem: string | undefined
    if (manifest === 'package.json') {
      try { JSON.parse(text) } catch (error) { problem = error instanceof Error ? error.message : 'Geçersiz JSON.' }
    } else {
      problem = tomlProblem(text)
    }
    checks.push({ name: `${manifest} geçerli`, status: problem ? 'failed' : 'passed', detail: problem })
  }
  if (!checks.length && !issues.length) checks.push({ name: 'Yapı denetimi', status: 'skipped', detail: 'Denetlenecek beklenen dosya veya manifest yok.' })
  return phase('structure', checks, issues)
}

async function staticPhase(root: string, expectedFiles: string[]): Promise<VerificationPhaseReport> {
  const files = await readProjectSources(root)
  if (!files.size) return phase('static', [{ name: 'Statik tutarlılık denetimi', status: 'skipped', detail: 'Denetlenecek kaynak dosya bulunamadı.' }])
  const issues = analyzeProjectFiles(files, { entryFiles: expectedFiles.filter((file) => !file.startsWith('/') && !file.includes('..')) })
  const errors = issues.filter((issue) => issue.severity === 'error').length
  return phase('static', [{
    name: `Import/bağımlılık/yol tutarlılığı (${files.size} dosya)`,
    status: errors ? 'failed' : 'passed',
    detail: errors ? `${errors} hata bulundu.` : undefined,
  }], issues)
}

export async function verifyProject(root: string, options: VerifyProjectOptions): Promise<ProjectVerification> {
  const phases: VerificationPhaseReport[] = []
  let projectRoot: string
  try {
    projectRoot = await fs.realpath(path.resolve(root))
    if (!(await fs.stat(projectRoot)).isDirectory()) throw new Error('Proje yolu bir klasör değil.')
  } catch (error) {
    phases.push(phase('structure', [{ name: 'Proje klasörü', status: 'failed', detail: error instanceof Error ? error.message : String(error) }]))
    return { ok: false, complete: false, phases }
  }

  const { stack } = options
  const notRun = (name: string, detail: string): VerificationCheck => ({ name, status: 'not-run', detail })
  phases.push(await structurePhase(projectRoot, options.expectedFiles ?? []))
  phases.push(await staticPhase(projectRoot, options.expectedFiles ?? []))

  const usesNpm = stack !== 'python-fastapi' && stack !== 'go' && stack !== 'rust'
  let depsReady = !usesNpm && stack !== 'python-fastapi'
  const installChecks: VerificationCheck[] = []
  if (stack === 'go' || stack === 'rust') {
    installChecks.push({ name: 'Bağımlılık kurulumu', status: 'skipped', detail: 'Bu yığın için ayrı kurulum adımı yok; bağımlılıklar build/test sırasında çözülür.' })
  } else if (options.install) {
    const command = stack === 'python-fastapi' ? 'python' : 'npm'
    const args = stack === 'python-fastapi' ? ['-m', 'pip', 'install', '-r', 'requirements.txt'] : ['install']
    const result = await runProcess(projectRoot, command, args, options.installTimeoutMs ?? 900_000)
    installChecks.push(ranCheck('Bağımlılık kurulumu', result))
    depsReady = result.ok
  } else {
    depsReady = usesNpm && await exists(path.join(projectRoot, 'node_modules'))
    installChecks.push(depsReady
      ? { name: 'Bağımlılık kurulumu', status: 'skipped', detail: 'node_modules zaten var; kurulum çalıştırılmadı.' }
      : notRun('Bağımlılık kurulumu', '--install verilmedi; bağımlılıklar kurulmadı.'))
  }
  phases.push(phase('install', installChecks))
  const installFailed = installChecks.some((check) => check.status === 'failed')

  // Build
  const buildChecks: VerificationCheck[] = []
  const scripts = usesNpm ? await readScripts(projectRoot) : undefined
  if (installFailed) {
    buildChecks.push(notRun('Build', 'Bağımlılık kurulumu başarısız olduğu için çalıştırılmadı.'))
  } else if (usesNpm && !scripts?.build) {
    buildChecks.push({ name: 'Build', status: 'skipped', detail: 'package.json içinde build betiği yok.' })
  } else if (usesNpm && !depsReady) {
    buildChecks.push(notRun('Build', 'Bağımlılıklar kurulu değil (--install gerekir).'))
  } else {
    const step = await buildStep(projectRoot, stack)
    if (!step) buildChecks.push({ name: 'Build', status: 'skipped', detail: 'Derlenecek kaynak bulunamadı.' })
    else buildChecks.push(ranCheck('Build', await runProcess(projectRoot, step.command, step.args, options.buildTimeoutMs ?? 600_000)))
  }
  phases.push(phase('build', buildChecks))

  // Test: yalnızca kullanıcı açıkça istediğinde (--verify)
  const testChecks: VerificationCheck[] = []
  if (!options.runTests) {
    testChecks.push(notRun('Testler', 'Testler yalnızca --verify ile çalıştırılır.'))
  } else if (installFailed) {
    testChecks.push(notRun('Testler', 'Bağımlılık kurulumu başarısız olduğu için çalıştırılmadı.'))
  } else if (usesNpm && !scripts?.test) {
    testChecks.push({ name: 'Testler', status: 'skipped', detail: 'package.json içinde test betiği yok.' })
  } else if ((usesNpm || stack === 'python-fastapi') && !depsReady) {
    testChecks.push(notRun('Testler', 'Bağımlılıklar kurulu değil (--install gerekir).'))
  } else {
    const command = stack === 'python-fastapi' ? 'python' : stack === 'go' ? 'go' : stack === 'rust' ? 'cargo' : 'npm'
    const args = stack === 'python-fastapi' ? ['-m', 'pytest'] : stack === 'go' || stack === 'rust' ? ['test', ...(stack === 'go' ? ['./...'] : [])] : ['test']
    testChecks.push(ranCheck('Testler', await runProcess(projectRoot, command, args, options.testTimeoutMs ?? 600_000)))
  }
  phases.push(phase('test', testChecks))

  const checks = phases.flatMap((item) => item.checks)
  return {
    ok: phases.every((item) => item.ok),
    complete: checks.every((check) => check.status === 'passed' || (check.status === 'skipped' && check.name === 'Bağımlılık kurulumu')),
    phases,
  }
}

export function formatVerificationReport(report: ProjectVerification): string[] {
  const lines: string[] = []
  for (const item of report.phases) {
    lines.push(`[${item.phase}] ${item.ok ? 'OK' : 'BAŞARISIZ'}`)
    for (const check of item.checks) lines.push(`  ${check.status.toUpperCase().padEnd(7)} ${check.name}${check.command ? ` (${check.command})` : ''}${check.detail ? ` — ${check.detail}` : ''}`)
    for (const issue of item.issues) lines.push(`  ${issue.severity === 'error' ? 'HATA   ' : 'UYARI  '} ${issue.code}: ${issue.message}`)
  }
  lines.push(report.ok ? (report.complete ? 'Sonuç: tüm adımlar çalıştı ve geçti.' : 'Sonuç: başarısız adım yok ama bazı adımlar çalıştırılmadı/atlandı (tam doğrulama değil).') : 'Sonuç: doğrulama başarısız.')
  return lines
}
