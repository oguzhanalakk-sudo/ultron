export type CommandRisk = 'development' | 'package' | 'system' | 'destructive'
export type CommandPermission = {
  mode?: 'controlled' | 'advanced' | 'personal'
  commandMode: 'confirm' | 'automatic'
  allowPackageInstalls: boolean
  allowSystemChanges: boolean
}

const directExecutables = new Set([
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'git', 'node', 'python', 'python3', 'pytest', 'adb', 'java', 'javac',
  'dotnet', 'cargo', 'rustc', 'go', 'gcc', 'clang', 'mvn', 'mvnw.cmd', 'gradle', 'gradlew', 'gradlew.bat',
  'cmake', 'ninja', 'ctest', 'csc', 'msbuild', 'iscc', 'iscc.exe', 'cargo-tauri',
  'dir', 'type', 'findstr', 'where', 'pyinstaller', 'winget', 'choco', 'reg', 'sc', 'shutdown', 'del', 'erase', 'rmdir', 'taskkill',
])
const shellOperators = /[&|<>^%`\r\n!;]/

export function parseCommandLine(command: string) {
  const trimmed = command.trim()
  if (!trimmed || trimmed.length > 1000) throw new Error('Komut boş veya 1000 karakterden uzun.')
  if (shellOperators.test(trimmed) || /\$\(|\$\{|\\x00/i.test(trimmed)) throw new Error('Komut kabuk yönlendirmesi veya ifade genişletmesi içeriyor; bu biçim güvenli araç arayüzünde desteklenmiyor.')
  const tokens: string[] = []
  let token = ''
  let quoted = false
  let started = false
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index]
    if (char === '"') { quoted = !quoted; started = true; continue }
    if (/\s/.test(char) && !quoted) {
      if (started) { tokens.push(token); token = ''; started = false }
      continue
    }
    if (char === '\0') throw new Error('Komutta geçersiz karakter var.')
    token += char
    started = true
  }
  if (quoted) throw new Error('Komuttaki çift tırnak kapanmamış.')
  if (started) tokens.push(token)
  if (!tokens.length) throw new Error('Komut boş.')
  return tokens
}

export function classifyCommand(command: string): { risk: CommandRisk; executable: string; args: string[] } {
  const [rawExecutable, ...args] = parseCommandLine(command)
  const localRelative = rawExecutable.startsWith('.\\') || rawExecutable.startsWith('./')
  const normalizedPath = rawExecutable.replace(/^\.\\/, '').replace(/^\.\//, '').toLowerCase()
  const executableName = normalizedPath.split(/[\\/]/).pop() ?? normalizedPath
  if ((/[\\/]/.test(normalizedPath) && !localRelative) || !directExecutables.has(executableName)) throw new Error(`"${normalizedPath}" desteklenen geliştirme araçları arasında değil.`)

  const normalized = [executableName, ...args].join(' ').toLowerCase()
  const executable = localRelative ? rawExecutable : executableName
  const explicitPathEscape = args.some((argument) => {
    const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argument
    return /^(?:[a-z]:[\\/]|\\\\|\/(?:etc|home|root|users|private)\/)/i.test(value) || /(^|[\\/])\.\.(?:[\\/]|$)/.test(value)
  })
  if ((executable === 'powershell' || executable === 'pwsh') && /\b(remove-item|format-volume|clear-disk|restart-computer|stop-computer|set-executionpolicy)\b/i.test(normalized)) {
    return { risk: 'destructive', executable, args }
  }
  if (/^(git\s+(clean|reset\s+--hard|checkout\s+--\s|restore\s+--worktree)|npm\s+(uninstall|remove)|pnpm\s+(remove|uninstall)|yarn\s+remove|bun\s+remove|(?:del|erase|rmdir)\b)/.test(normalized)) {
    return { risk: 'destructive', executable, args }
  }
  if (/^git\s+(?:push|fetch|pull|clone|remote|submodule|worktree|commit|tag|branch|switch|checkout|merge|rebase|cherry-pick|revert|stash|reset)\b/.test(normalized)
    || /^node\s+(?:-e|--eval)(?:\s|$)/.test(normalized)
    || /^(?:python|python3)\s+-c(?:\s|$)/.test(normalized)
    || /^(?:python|python3)\s+-m\s+http\.server\b/.test(normalized)
    || /^java\s+-jar(?:\s|$)/.test(normalized)
    || /^adb\s+(?:install|uninstall|push|pull|shell|root|remount|reboot|tcpip|connect|disconnect|forward|reverse|sideload)\b/.test(normalized)
    || /^npx\b/.test(normalized) && !/^npx\s+--no-install(?:\s|$)/.test(normalized)
    || /^(?:npm|pnpm|yarn|bun)\s+exec\b/.test(normalized)
    || explicitPathEscape
    || /^(winget|choco|powershell|pwsh|reg|sc|shutdown|taskkill)\b/.test(executableName)
    || /^(?:npm|npx|pnpm|yarn|bun)\s+(?:run\s+)?(?:publish|link|unlink)\b/.test(normalized)) {
    return { risk: 'system', executable, args }
  }
  if (/^(?:npm|npx|pnpm|yarn|bun)\s+(?:install|i|add|update|upgrade)\b/.test(normalized)
    || /^(?:python|python3)\s+-m\s+pip\s+install\b/.test(normalized)
    || /^cargo\s+(?:install|update)\b/.test(normalized)
    || /^dotnet\s+tool\s+(?:install|update)\b/.test(normalized)
    || (/^(?:gradle|gradlew(?:\.bat)?)\s/.test(normalized) && !/\s--offline(?:\s|$)/.test(normalized))
    || /\s--refresh-dependencies(?:\s|$)/.test(normalized)) {
    return { risk: 'package', executable, args }
  }
  if (/\b(?:remove-item|remove-itemrecurse|format-volume|clear-disk|restart-computer|stop-computer|set-executionpolicy)\b/i.test(normalized)) {
    return { risk: 'system', executable, args }
  }
  return { risk: 'development', executable, args }
}

export function canRunAutomatically(permission: CommandPermission, risk: CommandRisk) {
  if (permission.commandMode !== 'automatic') return false
  // "Kişisel" profil, sahibinin açık tercihiyle bütün komut sınıflarını
  // onay kartı göstermeden çalıştırır. İşletim sisteminin kendi yetkileri
  // yine geçerlidir; uygulama yönetici yükseltmesi yapmaz.
  if (permission.mode === 'personal') return true
  if (risk === 'destructive') return false
  if (risk === 'package') return permission.allowPackageInstalls
  if (risk === 'system') return permission.allowSystemChanges
  return true
}

export function isSafePowerShellQuery(script: string) {
  const command = String.raw`(?:Get-Date|Get-Location|Get-Process|Get-Service|Get-Command|Get-ExecutionPolicy|Get-ComputerInfo)`
  const args = String.raw`(?:\s+[-\w=,.:/\\\s"']*)?`
  return new RegExp(String.raw`^\s*${command}${args}(?:\s*;\s*${command}${args})*\s*;?\s*$`, 'i').test(script.trim())
}
