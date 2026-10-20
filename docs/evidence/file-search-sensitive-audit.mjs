// Denetim kanıtı: yalnızca sahte değerlerle çalışır; gerçek secret veya kullanıcı verisi içermez.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFileSearchRequest, scanDirectoryForQuery } from 'file:///C:/Users/user/Desktop/codexx/electron/file-search.ts'

const root = await mkdtemp(path.join(tmpdir(), 'ultron-audit-search-'))
try {
  await writeFile(path.join(root, '.env'), 'API_TOKEN=FAKE_AUDIT_SECRET\n', 'utf8')
  await mkdir(path.join(root, '.codex-local'), { recursive: true })
  await writeFile(path.join(root, '.codex-local', 'tasks.json'), '{"note":"TASK_INTERNAL_SECRET"}\n', 'utf8')
  await writeFile(path.join(root, 'app.js'), 'console.log("normal")\n', 'utf8')

  for (const queryText of ['içinde FAKE_AUDIT_SECRET geçen dosyalar', 'içinde TASK_INTERNAL_SECRET geçen dosyalar']) {
    const request = parseFileSearchRequest(queryText)
    const result = await scanDirectoryForQuery(root, request)
    console.log(JSON.stringify({ queryText, hits: result.hits.map((hit) => ({ relativePath: hit.relativePath, snippets: hit.snippets })) }, null, 2))
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
