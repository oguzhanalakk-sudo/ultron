import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { analyzeWebProjectFiles, checkLocalWebUrl, sqliteWorkerScript, validateLocalWebUrl, validateSqliteReadQuery } from '../electron/web-build-tool.ts'

test('web project analyzer detects frontend, backend, database, ORM, migrations and checks', () => {
  const result = analyzeWebProjectFiles({
    'package.json': JSON.stringify({ dependencies: { react: 'x', vite: 'x', express: 'x', '@prisma/client': 'x' }, scripts: { test: 'vitest run', build: 'vite build' } }),
    'package-lock.json': '{}',
    'tsconfig.json': '{}',
    'src/api/users.ts': 'export const users = router.get("/users", auth)',
    'prisma/schema.prisma': 'datasource db { provider = "postgresql" }',
    'prisma/migrations/001_init/migration.sql': 'CREATE TABLE users(id INTEGER);',
    '.env.example': 'DATABASE_URL=',
    'Dockerfile': 'FROM node:22',
  })
  assert.deepEqual(result.frontend, ['React', 'Vite', 'TypeScript'])
  assert.deepEqual(result.backend, ['Express'])
  assert.deepEqual(result.databases, ['PostgreSQL'])
  assert.deepEqual(result.dataAccess, ['Prisma'])
  assert.equal(result.packageManagers.includes('npm'), true)
  assert.equal(result.migrationFiles.length, 1)
  assert.equal(result.apiFiles.length, 1)
  assert.equal(result.hasEnvironmentExample, true)
  assert.equal(result.hasDockerConfig, true)
  assert.equal(result.packageScripts.test, 'vitest run')
})

test('malformed package manifest does not prevent project analysis', () => {
  const result = analyzeWebProjectFiles({ 'package.json': '{invalid', 'index.html': '<main>Test</main>', 'server.py': 'from flask import Flask' })
  assert.ok(result.frontend.includes('HTML'))
  assert.ok(result.backend.includes('Flask'))
  assert.equal(result.packageScripts.test, undefined)
})

test('package manager and database dependencies are detected without lockfiles', () => {
  const result = analyzeWebProjectFiles({
    'package.json': JSON.stringify({
      packageManager: 'pnpm@9.12.0',
      dependencies: { pg: 'x', mysql2: 'x', mssql: 'x', 'better-sqlite3': 'x' },
      scripts: { build: 'tsc && vite build', lint: 'eslint .' },
    }),
  })
  assert.deepEqual(result.packageManagers, ['pnpm'])
  assert.deepEqual(result.databases, ['SQLite', 'PostgreSQL', 'MySQL', 'Microsoft SQL Server'])
  assert.ok(result.tests.includes('Üretim derleme betiği'))
  assert.ok(result.tests.includes('Lint/tip denetimi'))
  assert.match(result.recommendations.join('\n'), /test komutu algılanmadı/i)
})

test('web health URL accepts loopback only and rejects credentials and public hosts', () => {
  assert.equal(validateLocalWebUrl('http://localhost:3000/health').hostname, 'localhost')
  assert.equal(validateLocalWebUrl('http://127.0.0.2:5000/').hostname, '127.0.0.2')
  assert.throws(() => validateLocalWebUrl('http://example.com/health'), /yalnızca localhost/i)
  assert.throws(() => validateLocalWebUrl('http://user:pass@127.0.0.1:3000'), /kimlik bilgisi/i)
  assert.throws(() => validateLocalWebUrl('file:///C:/secret.txt'), /yalnızca localhost/i)
})

test('HTTP verifier reads a local response and refuses to follow redirects', async (context) => {
  const server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: 'http://example.com/' }).end(); return }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"ok"}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => server.close())
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const healthy = await checkLocalWebUrl(`${base}/health`)
  assert.equal(healthy.status, 200)
  assert.equal(healthy.body, '{"status":"ok"}')
  const redirect = await checkLocalWebUrl(`${base}/redirect`)
  assert.equal(redirect.status, 302)
  assert.equal(redirect.redirected, true)
})

test('HTTP verifier reports a stalled local service as a timeout', async (context) => {
  const server = createServer(() => { /* Keep the socket open to exercise AbortSignal timeout handling. */ })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  context.after(() => { server.closeAllConnections(); server.close() })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const result = await checkLocalWebUrl(`http://127.0.0.1:${address.port}/health`, 150)
  assert.equal(result.status, null)
  assert.match(result.error ?? '', /150 ms içinde yanıt vermedi/)
})

test('SQLite query validator allows read-only SELECT and blocks mutation or stacked SQL', () => {
  assert.equal(validateSqliteReadQuery('SELECT id FROM users;'), 'SELECT id FROM users')
  assert.equal(validateSqliteReadQuery('WITH active AS (SELECT 1) SELECT * FROM active'), 'WITH active AS (SELECT 1) SELECT * FROM active')
  assert.throws(() => validateSqliteReadQuery('DELETE FROM users'), /yalnızca SELECT/i)
  assert.throws(() => validateSqliteReadQuery('SELECT 1; DROP TABLE users'), /tek bir/i)
  assert.throws(() => validateSqliteReadQuery('SELECT load_extension("x")'), /özel SQLite/i)
})

test('SQLite worker migrates transactionally, inspects schema, hides row values, and snapshots existing data', async (context) => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
  if (spawnSync(python, ['--version'], { windowsHide: true, stdio: 'ignore' }).status !== 0) { context.skip('Python is unavailable.') ; return }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'kod-atolyesi-sqlite-'))
  context.after(() => rm(temporary, { recursive: true, force: true }))
  const database = path.join(temporary, 'db #1.sqlite3')
  const backup = path.join(temporary, 'backups', 'before migration.bak')
  const run = async (action: string, sql = '', backupPath?: string) => await new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(python, ['-c', sqliteWorkerScript, database, action], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) { reject(new Error(stderr)); return }
      try { resolve(JSON.parse(stdout.trim())) } catch (error) { reject(error) }
    })
    child.stdin.end(JSON.stringify({ sql, backup_path: backupPath }))
  })
  const first = await run('apply_migration', 'CREATE TABLE sample(id INTEGER PRIMARY KEY, label TEXT NOT NULL);\nINSERT INTO sample(label) VALUES (\'private\');\n')
  assert.equal(first.applied, true)
  assert.equal((await run('inspect')).integrity, 'ok')
  const query = await run('query', 'SELECT label FROM sample')
  assert.deepEqual(query.columns, ['label'])
  assert.equal(query.rowsMatchedAtMost, 1)
  assert.equal(query.valuesOmittedForPrivacy, true)
  await assert.rejects(run('apply_migration', 'DROP TABLE sample;\nTHIS IS INVALID;\n', backup))
  await stat(backup)
  const afterFailure = await run('inspect')
  assert.equal((afterFailure.tables as { name: string }[]).some((table) => table.name === 'sample'), true, 'failed migration must roll back its schema changes')
})
