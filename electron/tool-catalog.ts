export type ToolKind = 'terminal' | 'git' | 'github' | 'filesystem' | 'package-manager' | 'compiler' | 'linter' | 'formatter' | 'test' | 'debugger' | 'build-system' | 'log-analysis' | 'container'
export type ToolRisk = 'none' | 'low' | 'medium' | 'high' | 'critical'

export type ToolDefinition = {
  name: string
  kind: ToolKind
  risk: ToolRisk
  description: string
  versionCheck: string[]
  installHint?: string
  allowedForAutoRun?: boolean
}

export type ToolAvailability = { name: string; available: boolean; path: string | null; version: string | null; reason?: string }
export type ToolVersionRunner = (command: string[]) => Promise<{ ok: boolean; path?: string | null; stdout: string; stderr: string }>

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  git: { name: 'git', kind: 'git', risk: 'low', description: 'Git depo işlemleri', versionCheck: ['git', '--version'], installHint: 'Git for Windows kurulumu gerekir.', allowedForAutoRun: true },
  gh: { name: 'gh', kind: 'github', risk: 'medium', description: 'GitHub CLI', versionCheck: ['gh', '--version'], installHint: 'GitHub CLI kurulumu gerekir.' },
  node: { name: 'node', kind: 'package-manager', risk: 'low', description: 'Node.js çalışma zamanı', versionCheck: ['node', '--version'], allowedForAutoRun: true },
  npm: { name: 'npm', kind: 'package-manager', risk: 'low', description: 'Node paket yöneticisi', versionCheck: ['npm', '--version'], allowedForAutoRun: true },
  pnpm: { name: 'pnpm', kind: 'package-manager', risk: 'low', description: 'pnpm paket yöneticisi', versionCheck: ['pnpm', '--version'], allowedForAutoRun: true },
  yarn: { name: 'yarn', kind: 'package-manager', risk: 'low', description: 'Yarn paket yöneticisi', versionCheck: ['yarn', '--version'], allowedForAutoRun: true },
  python: { name: 'python', kind: 'compiler', risk: 'low', description: 'Python çalışma zamanı', versionCheck: ['python', '--version'], allowedForAutoRun: true },
  pytest: { name: 'pytest', kind: 'test', risk: 'low', description: 'Python test çalıştırıcısı', versionCheck: ['pytest', '--version'], allowedForAutoRun: true },
  tsc: { name: 'tsc', kind: 'compiler', risk: 'low', description: 'TypeScript derleyicisi', versionCheck: ['tsc', '--version'], allowedForAutoRun: true },
  eslint: { name: 'eslint', kind: 'linter', risk: 'low', description: 'ESLint', versionCheck: ['eslint', '--version'], allowedForAutoRun: true },
  prettier: { name: 'prettier', kind: 'formatter', risk: 'low', description: 'Prettier', versionCheck: ['prettier', '--version'], allowedForAutoRun: true },
  vite: { name: 'vite', kind: 'build-system', risk: 'low', description: 'Vite derleme aracı', versionCheck: ['vite', '--version'], allowedForAutoRun: true },
  dotnet: { name: 'dotnet', kind: 'compiler', risk: 'low', description: '.NET SDK', versionCheck: ['dotnet', '--version'], allowedForAutoRun: true },
  cargo: { name: 'cargo', kind: 'compiler', risk: 'low', description: 'Rust araç zinciri', versionCheck: ['cargo', '--version'], allowedForAutoRun: true },
  docker: { name: 'docker', kind: 'container', risk: 'medium', description: 'Docker çalışma zamanı', versionCheck: ['docker', '--version'] },
  powershell: { name: 'powershell', kind: 'terminal', risk: 'low', description: 'PowerShell', versionCheck: ['powershell', '-NoProfile', '-Command', '$PSVersionTable.PSVersion'], allowedForAutoRun: true },
}

export function toolRiskLevel(tool: string): ToolRisk { return TOOL_DEFINITIONS[tool]?.risk ?? 'medium' }

export function isInsideProjectRoot(targetPath: string, projectRoot: string): boolean {
  const relative = pathRelative(projectRoot, targetPath)
  return relative === '' || (!relative.startsWith('..') && !relative.startsWith('/'))
}

function pathRelative(root: string, target: string) {
  const normalize = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLocaleLowerCase('en-US')
  const rootValue = normalize(root)
  const targetValue = normalize(target)
  if (targetValue === rootValue) return ''
  return targetValue.startsWith(`${rootValue}/`) ? targetValue.slice(rootValue.length + 1) : `../${targetValue}`
}

export function validateCommandSafety(input: string, projectRoot: string): { ok: boolean; reason?: string } {
  const command = String(input ?? '').trim()
  if (!command) return { ok: false, reason: 'Komut boş.' }
  if (!projectRoot.trim() || !isInsideProjectRoot(projectRoot, projectRoot)) return { ok: false, reason: 'Geçersiz proje kökü.' }
  if (/(^|[\s;])(?:sudo|su|shutdown|reboot|mkfs|dd)\b|rm\s+-rf\s+\/|(?:curl|wget)\s+.*\|\s*(?:bash|sh)\b|powershell\s+.*-EncodedCommand/i.test(command)) return { ok: false, reason: 'Tehlikeli komut kalıbı reddedildi.' }
  if (/[;&|`$()]/.test(command)) return { ok: false, reason: 'Shell kontrol karakterleri kullanılamaz.' }
  return { ok: true }
}

export async function detectToolAvailability(name: string, runVersion: ToolVersionRunner): Promise<ToolAvailability> {
  const definition = TOOL_DEFINITIONS[name]
  if (!definition) return { name, available: false, path: null, version: null, reason: 'Araç tanımı bulunamadı.' }
  const result = await runVersion(definition.versionCheck)
  if (result.ok) return { name, available: true, path: result.path ?? definition.versionCheck[0], version: result.stdout.trim() || null }
  return { name, available: false, path: null, version: null, reason: definition.installHint ?? 'Araç kurulu değil.' }
}
