import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { promisify } from 'node:util'

const spawnAsync = promisify(spawn)

export type VerificationReport = {
  ok: boolean
  checks: string[]
  outputs: string[]
}

export async function verifyProjectGeneration(root: string): Promise<VerificationReport> {
  const checks: string[] = []
  const outputs: string[] = []

  try {
    const entries = await fs.readdir(root)
    checks.push(`klasör girişi: ${entries.length}`)
    outputs.push(...entries)

    const hasPackage = await fs.stat(path.join(root, 'package.json')).then(() => true).catch(() => false)
    if (hasPackage) checks.push('package.json mevcut')
    else checks.push('package.json eksik')

    const hasReadme = await fs.stat(path.join(root, 'README.md')).then(() => true).catch(() => false)
    checks.push(hasReadme ? 'README mevcut' : 'README eksik')

    return {
      ok: hasPackage,
      checks,
      outputs,
    }
  } catch (error) {
    return {
      ok: false,
      checks: ['projeyi doğrulama sırasında hata oluştu'],
      outputs: [String(error)],
    }
  }
}

export async function installProjectDependencies(root: string, stack: string): Promise<{ ok: boolean; output: string[] }> {
  const output: string[] = []
  try {
    const cmd = stack === 'python-fastapi' ? 'python' : 'npm'
    const args = stack === 'python-fastapi' ? ['-m', 'pip', 'install', '-r', 'requirements.txt'] : ['install']

    const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })

    for await (const chunk of child.stdout ?? []) {
      output.push(String(chunk))
    }
    for await (const chunk of child.stderr ?? []) {
      output.push(String(chunk))
    }

    const exitCode = await new Promise<number>((resolve) => child.on('close', resolve))
    return { ok: exitCode === 0, output }
  } catch (error) {
    output.push(String(error))
    return { ok: false, output }
  }
}

export async function validateGeneratedBuild(root: string, stack: string): Promise<{ ok: boolean; output: string[] }> {
  const output: string[] = []
  try {
    const cmd = stack === 'python-fastapi' ? 'python' : 'npm'
    const args = stack === 'python-fastapi' ? ['-m', 'py_compile', 'app.py'] : ['run', 'build']
    const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })

    for await (const chunk of child.stdout ?? []) {
      output.push(String(chunk))
    }
    for await (const chunk of child.stderr ?? []) {
      output.push(String(chunk))
    }

    const exitCode = await new Promise<number>((resolve) => child.on('close', resolve))
    return { ok: exitCode === 0, output }
  } catch (error) {
    output.push(String(error))
    return { ok: false, output }
  }
}
