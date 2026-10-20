import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// Generated output is excluded; source, lockfiles and local configuration participate.
// Only the digest leaves this module. File contents and names are never journalled here.
const generated = new Set(['.git', '.codex-local', 'node_modules', '.gradle', '.idea', '.vscode', 'build', 'dist', 'release', 'out', 'target', '.next', 'coverage', '.pytest_cache', '__pycache__', 'test-results', 'playwright-report', '.cache', '.venv', 'venv', 'obj'])
export async function projectFingerprint(roots: (string | { path: string; recursive: boolean })[]): Promise<string> {
  const digest = createHash('sha256')
  let files = 0, bytes = 0, directories = 0
  const visit = async (absolute: string, relative: string, recursive: boolean, scope: string, depth = 0): Promise<void> => {
    if (++directories > 15_000 || depth > 80) throw new Error('Proje parmak izi klasör sınırını aştı.')
    const entries = (await fs.readdir(absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))
    for (const entry of entries) {
      if (entry.isDirectory() && generated.has(entry.name.toLowerCase())) continue
      const name = relative ? `${relative}/${entry.name}` : entry.name
      const file = path.join(absolute, entry.name)
      const info = await fs.lstat(file)
      if (info.isSymbolicLink()) throw new Error('Proje parmak izi sembolik bağlantı nedeniyle doğrulanamadı.')
      const resolved = await fs.realpath(file)
      const inside = path.relative(scope, resolved)
      if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) throw new Error('Proje parmak izi kapsam dışı yol nedeniyle doğrulanamadı.')
      if (info.isDirectory()) { if (recursive) await visit(file, name, true, scope, depth + 1); continue }
      if (!info.isFile()) throw new Error('Proje parmak izi özel dosya nedeniyle doğrulanamadı.')
      if (++files > 15_000 || info.size > 20_000_000 || (bytes += info.size) > 150_000_000) throw new Error('Proje parmak izi dosya/boyut sınırını aştı; doğrulama güncelliği kanıtlanamadı.')
      const handle = await fs.open(file, 'r')
      try {
        const before = await handle.stat()
        if (before.dev !== info.dev || before.ino !== info.ino || before.size !== info.size || before.mtimeMs !== info.mtimeMs) throw new Error('Parmak izi alınırken proje değişti.')
        // Bound allocation/read even if an untrusted process grows the file after stat.
        const content = Buffer.alloc(before.size + 1)
        let count = 0
        while (count < content.length) {
          const result = await handle.read(content, count, content.length - count, count)
          if (!result.bytesRead) break
          count += result.bytesRead
        }
        const after = await handle.stat()
        if (count !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Parmak izi alınırken proje değişti.')
        digest.update(JSON.stringify([name, count, createHash('sha256').update(content.subarray(0, count)).digest('hex')]))
      } finally { await handle.close() }
    }
  }
  for (const [index, input] of roots.entries()) {
    const root = await fs.realpath(typeof input === 'string' ? input : input.path)
    const recursive = typeof input === 'string' || input.recursive
    digest.update(JSON.stringify([index, root, recursive]))
    await visit(root, '', recursive, root)
  }
  return digest.digest('hex')
}
