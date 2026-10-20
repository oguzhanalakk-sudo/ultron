export type GitOperationAction = 'status' | 'log' | 'diff' | 'rev-parse' | 'switch' | 'add' | 'commit' | 'revert' | 'push' | 'remote'

const allowedActions = new Set<GitOperationAction>(['status', 'log', 'diff', 'rev-parse', 'switch', 'add', 'commit', 'revert', 'push', 'remote'])

/** Git komutları shell olmadan çalıştırılmadan önce ortak argüman denetimi. */
export function validateGitArguments(args: string[]): { ok: boolean; reason?: string; action?: GitOperationAction } {
  if (!Array.isArray(args) || args.length === 0) return { ok: false, reason: 'Git argümanları boş.' }
  const action = args[0] as GitOperationAction
  if (!allowedActions.has(action)) return { ok: false, reason: `Git eylemi izinli değil: ${args[0]}` }
  if (args.some((arg) => typeof arg !== 'string' || arg.length > 500 || /[\u0000\r\n]/.test(arg))) return { ok: false, reason: 'Git argümanında geçersiz karakter veya uzunluk var.' }
  if (args.some((arg) => /^(?:--exec-path|--upload-pack|--receive-pack)=/i.test(arg))) return { ok: false, reason: 'Git üzerinden yardımcı yürütücü değiştirme reddedildi.' }
  if (action === 'push' && args.some((arg) => /^--force(?:-with-lease)?$/i.test(arg))) return { ok: false, reason: 'Force push reddedildi.' }
  if (action === 'commit' && args.some((arg) => /^--amend$/i.test(arg))) return { ok: false, reason: 'Commit geçmişini değiştiren amend reddedildi.' }
  if (action === 'revert' && args.some((arg) => /^--no-edit$/i.test(arg) === false && arg.startsWith('--'))) return { ok: false, reason: 'Bilinmeyen revert seçeneği reddedildi.' }
  return { ok: true, action }
}

export function validateRepoTarget(owner: unknown, repo: unknown): { ok: boolean; reason?: string } {
  if (typeof owner !== 'string' || typeof repo !== 'string' || !owner || !repo) return { ok: false, reason: 'owner/repo gerekli.' }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(owner) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(repo)) return { ok: false, reason: 'Geçersiz GitHub depo adı.' }
  return { ok: true }
}
