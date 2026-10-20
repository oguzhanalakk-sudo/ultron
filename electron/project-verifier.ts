import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
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

function allowedCommand(command: string, args: string[]): boolean {
  const joined = [command, ...args].join(' ')
  return joined === 'npm install'
    || joined === 'npm run build'
    || joined === 'python -m pip install -r requirements.txt'
    || joined === 'python -m py_compile app.py'
    || joined === 'go test ./...'
    || joined === 'cargo check'
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
  const command = stack === 'python-fastapi' ? 'python' : stack === 'go' ? 'go' : stack === 'rust' ? 'cargo' : 'npm'
  const args = stack === 'python-fastapi'
    ? ['-m', 'py_compile', 'app.py']
    : stack === 'go'
      ? ['test', './...']
      : stack === 'rust'
        ? ['check']
        : ['run', 'build']
  const result = await runProcess(root, command, args, 600_000)
  return { ok: result.ok, output: [result.command, result.stdout, result.stderr].filter(Boolean) }
}

export async function verifyGeneratedProject(
  root: string,
  stack: ProjectStack,
  install: boolean,
  expectedFiles: string[] = [],
): Promise<{ ok: boolean; summary: string[]; results: VerificationResult[] }> {
  const summary: string[] = []
  const results: VerificationResult[] = []
  const structure = await verifyProjectGeneration(root, expectedFiles)
  summary.push(structure.ok ? 'Dosya yapısı doğrulandı.' : 'Dosya yapısı doğrulanamadı.')
  if (!structure.ok) return { ok: false, summary, results }

  if (install) {
    if (stack === 'go' || stack === 'rust') {
      summary.push('Bağımlılıklar build sırasında çözülecek.')
    } else {
      const command = stack === 'python-fastapi' ? 'python' : 'npm'
      const args = stack === 'python-fastapi' ? ['-m', 'pip', 'install', '-r', 'requirements.txt'] : ['install']
      const installResult = await runProcess(root, command, args, 900_000)
      results.push(installResult)
      summary.push(installResult.ok ? 'Bağımlılıklar başarıyla kuruldu.' : 'Bağımlılık kurulumu başarısız oldu.')
    }
  }

  const command = stack === 'python-fastapi' ? 'python' : stack === 'go' ? 'go' : stack === 'rust' ? 'cargo' : 'npm'
  const args = stack === 'python-fastapi'
    ? ['-m', 'py_compile', 'app.py']
    : stack === 'go'
      ? ['test', './...']
      : stack === 'rust'
        ? ['check']
        : ['run', 'build']
  const buildResult = await runProcess(root, command, args, 600_000)
  results.push(buildResult)
  summary.push(buildResult.ok ? 'Build doğrulaması başarılı.' : 'Build doğrulaması başarısız.')
  return { ok: structure.ok && results.every((result) => result.ok), summary, results }
}
