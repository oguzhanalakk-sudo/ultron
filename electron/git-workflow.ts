// Git dal adı ve commit mesajı doğrulaması. Komutlar main.ts içinde execFile ile
// argüman dizisi olarak çalıştırılır; kabuk kullanılmaz, force-push/amend/merge yoktur.
export function normalizeGitBranchName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name.length < 3 || name.length > 80) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return null
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return null
  if (name.endsWith('/') || name.endsWith('.')) return null
  const parts = name.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))) return null
  if (name === 'HEAD' || name === 'master' || name === 'main') return null
  return name
}

export function normalizeGitCommitMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const message = value.replace(/\s+/g, ' ').trim()
  if (message.length < 4 || message.length > 200) return null
  if (/[\u0000-\u001f\u007f]/.test(message)) return null
  return message
}

export function taskBranchName(taskId: unknown): string | null {
  if (typeof taskId !== 'string') return null
  const slug = taskId.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (slug.length < 3) return null
  return normalizeGitBranchName(`ultron/${slug}`)
}
