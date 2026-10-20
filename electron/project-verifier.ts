import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type VerificationResult = {
  ok: boolean
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
}

export async function runVerification(root: string, command: string, args: string[]): Promise<VerificationResult> {
  try {
    const child = await execFileAsync(command, args, { cwd: root, maxBuffer: 1_000_000 })
    return {
      ok: true,
      command: [command, ...args].join(' '),
      stdout: String(child.stdout ?? ''),
      stderr: String(child.stderr ?? ''),
      exitCode: 0,
    }
  } catch (error: any) {
    const result = error && typeof error === 'object' && 'stdout' in error ? error : { stdout: '', stderr: '', code: 1 }
    return {
      ok: false,
      command: [command, ...args].join(' '),
      stdout: String((result as any).stdout ?? ''),
      stderr: String((result as any).stderr ?? ''),
      exitCode: typeof (result as any).code === 'number' ? (result as any).code : 1,
    }
  }
}

export async function verifyGeneratedProject(root: string, stack: string, install: boolean): Promise<{ ok: boolean; summary: string[]; results: VerificationResult[] }> {
  const summary: string[] = []
  const results: VerificationResult[] = []

  if (install) {
    const installResult = stack === 'python-fastapi'
      ? await runVerification(root, 'python', ['-m', 'pip', 'install', '-r', 'requirements.txt'])
      : await runVerification(root, 'npm', ['install'])
    results.push(installResult)
    summary.push(installResult.ok ? 'Bağımlılıklar başarıyla kuruldu.' : 'Bağımlılık kurulumu başarısız oldu.')
  }

  const buildCommand = stack === 'python-fastapi'
    ? ['python', '-m', 'py_compile', 'app.py']
    : ['npm', 'run', 'build']

  const buildResult = await runVerification(root, buildCommand[0], buildCommand.slice(1))
  results.push(buildResult)
  summary.push(buildResult.ok ? 'Build doğrulaması başarılı.' : 'Build doğrulaması başarısız.')

  return {
    ok: results.every((item) => item.ok),
    summary,
    results,
  }
}
