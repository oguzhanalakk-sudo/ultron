import net from 'node:net'
import type { WebProjectAnalysis } from './shared'
export const sqliteWorkerScript = `import json, os, sqlite3, sys
from urllib.parse import quote
db_path, action = sys.argv[1], sys.argv[2]
request = json.loads(sys.stdin.read() or '{}')
sql = request.get('sql', '')
backup_path = request.get('backup_path')
exists = os.path.isfile(db_path)
if action != 'apply_migration' and not exists:
    print(json.dumps({'exists': False, 'database': os.path.basename(db_path)}))
    raise SystemExit(0)
if action == 'inspect' or action == 'query':
    uri_path = quote(os.path.abspath(db_path).replace(os.sep, '/'), safe='/:')
    connection = sqlite3.connect('file:' + uri_path + '?mode=ro', uri=True, timeout=5)
else:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=5)
try:
    connection.execute('PRAGMA busy_timeout=5000')
    if action == 'inspect':
        integrity = connection.execute('PRAGMA integrity_check').fetchone()[0]
        tables = []
        for name, ddl in connection.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
            columns = [row[1] for row in connection.execute('PRAGMA table_info("' + name.replace('"', '""') + '")')]
            tables.append({'name': name, 'columns': columns, 'hasSchema': bool(ddl)})
        print(json.dumps({'exists': True, 'sqliteVersion': sqlite3.sqlite_version, 'integrity': integrity, 'tables': tables}))
    elif action == 'query':
        cursor = connection.execute(sql)
        if cursor.description is None:
            raise RuntimeError('Sorgu satır döndürmedi veya yalnızca SELECT/WITH değil.')
        columns = [column[0] for column in cursor.description]
        count = 0
        while count < 10000:
            batch = cursor.fetchmany(min(100, 10000 - count))
            count += len(batch)
            if len(batch) < 100:
                break
        print(json.dumps({'columns': columns[:100], 'rowsMatchedAtMost': count, 'rowLimit': 10000, 'valuesOmittedForPrivacy': True}))
    elif action == 'apply_migration':
        if exists:
            os.makedirs(os.path.dirname(backup_path), exist_ok=True)
            backup = sqlite3.connect(backup_path, timeout=5)
            try:
                connection.backup(backup)
                backup.commit()
            finally:
                backup.close()
        connection.execute('BEGIN IMMEDIATE')
        pending = ''
        for line in sql.splitlines(True):
            pending += line
            if sqlite3.complete_statement(pending):
                statement = pending.strip()
                pending = ''
                if statement:
                    connection.execute(statement)
        if pending.strip():
            raise RuntimeError('Migration sonlandırılmamış SQL ifadesi içeriyor.')
        connection.commit()
        integrity = connection.execute('PRAGMA integrity_check').fetchone()[0]
        print(json.dumps({'applied': True, 'backup': backup_path if exists else None, 'integrity': integrity}))
    else:
        raise RuntimeError('Bilinmeyen SQLite işlemi.')
finally:
    connection.close()
`

export function analyzeWebProjectFiles(files: Record<string, string>): WebProjectAnalysis {
  const paths = Object.keys(files).map((file) => file.replace(/\\/g, '/').replace(/^\.\//, ''))
  const all = `${paths.join('\n')}\n${Object.entries(files).map(([file, content]) => `${file}\n${content.slice(0, 500_000)}`).join('\n')}`.toLowerCase()
  const has = (pattern: RegExp) => pattern.test(all)
  const dependencies: Record<string, string> = {}
  const scripts: Record<string, string> = {}
  const declaredPackageManagers: string[] = []
  for (const [file, content] of Object.entries(files)) {
    if (!/(^|\/)package\.json$/i.test(file.replace(/\\/g, '/'))) continue
    try {
      const parsed = JSON.parse(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string>; packageManager?: string }
      Object.assign(dependencies, parsed.dependencies, parsed.devDependencies)
      Object.assign(scripts, parsed.scripts)
      const manager = parsed.packageManager?.split('@')[0]
      if (manager === 'npm' || manager === 'pnpm' || manager === 'yarn' || manager === 'bun') declaredPackageManagers.push(manager === 'yarn' ? 'Yarn' : manager)
    } catch { /* A malformed manifest remains visible through the raw file list and source scanner. */ }
  }

  const frontend: string[] = []
  const backend: string[] = []
  const databases: string[] = []
  const dataAccess: string[] = []
  const packageManagers: string[] = []
  const tests: string[] = []
  const add = (list: string[], value: string) => { if (!list.includes(value)) list.push(value) }

  if (has(/(^|[\s"'/{])next([@\s"'/:]|$)/) || dependencies.next) add(frontend, 'Next.js')
  if (dependencies.react || has(/react\.dom|react\/jsx/)) add(frontend, 'React')
  if (dependencies.vue || has(/\.vue\b/)) add(frontend, 'Vue')
  if (dependencies.svelte || has(/\.svelte\b/)) add(frontend, 'Svelte')
  if (dependencies.vite || has(/vite\.config\./)) add(frontend, 'Vite')
  if (has(/\.tsx?\b|typescript|tsconfig\.json/)) add(frontend, 'TypeScript')
  if (has(/\.jsx?\b|javascript/)) add(frontend, 'JavaScript')
  if (has(/\.html\b|index\.html/)) add(frontend, 'HTML')
  if (has(/\.css\b|\.scss\b|\.sass\b|tailwind/)) add(frontend, 'CSS')

  if (dependencies.express) add(backend, 'Express')
  if (dependencies['@nestjs/core']) add(backend, 'NestJS')
  if (paths.some((file) => /(^|\/)(?:pyproject\.toml|requirements[^/]*\.txt|setup\.py)$/.test(file.toLowerCase())) || paths.some((file) => /\.py$/i.test(file))) {
    if (has(/fastapi/)) add(backend, 'FastAPI')
    if (has(/flask/)) add(backend, 'Flask')
    if (has(/django/)) add(backend, 'Django')
    if (!backend.some((value) => ['FastAPI', 'Flask', 'Django'].includes(value))) add(backend, 'Python')
  }
  if (paths.some((file) => /\.csproj$|\.sln$/i.test(file))) add(backend, 'ASP.NET Core')
  if (paths.some((file) => /(^|\/)(?:server|api|backend)\.[cm]?[jt]sx?$/.test(file.toLowerCase())) && !backend.length) add(backend, 'Node.js')

  if (has(/sqlite|\.db\b|\.sqlite3?\b/) || dependencies.sqlite3 || dependencies['better-sqlite3']) add(databases, 'SQLite')
  if (has(/postgres(?:ql)?|pg\.pool|postgresql:\/\//) || dependencies.pg || dependencies.postgres) add(databases, 'PostgreSQL')
  if (has(/mysql|mariadb/) || dependencies.mysql || dependencies.mysql2) add(databases, 'MySQL')
  if (has(/sqlserver|mssql|microsoft\.entityframeworkcore\.sqlserver/) || dependencies.mssql) add(databases, 'Microsoft SQL Server')
  if (has(/sqlalchemy/)) add(dataAccess, 'SQLAlchemy')
  if (has(/entityframeworkcore|dbcontext/)) add(dataAccess, 'Entity Framework Core')
  if (dependencies['@prisma/client'] || paths.some((file) => /(^|\/)prisma\/schema\.prisma$/.test(file.toLowerCase()))) add(dataAccess, 'Prisma')

  for (const manager of declaredPackageManagers) add(packageManagers, manager)
  if (paths.some((file) => /(^|\/)package-lock\.json$/.test(file.toLowerCase()))) add(packageManagers, 'npm')
  if (paths.some((file) => /(^|\/)pnpm-lock\.yaml$/.test(file.toLowerCase()))) add(packageManagers, 'pnpm')
  if (paths.some((file) => /(^|\/)yarn\.lock$/.test(file.toLowerCase()))) add(packageManagers, 'Yarn')
  if (paths.some((file) => /(^|\/)bun\.lockb?$/.test(file.toLowerCase()))) add(packageManagers, 'Bun')
  if (paths.some((file) => /(^|\/)(?:pyproject\.toml|requirements[^/]*\.txt)$/.test(file.toLowerCase()))) add(packageManagers, 'Python/pip')
  if (paths.some((file) => /\.csproj$|\.sln$/i.test(file))) add(packageManagers, '.NET')

  if (scripts.test || scripts['test:unit'] || scripts['test:e2e'] || has(/pytest|unittest|vitest|jest|playwright/)) add(tests, 'Test komutu veya yapılandırması')
  if (scripts.build || scripts['build:prod']) add(tests, 'Üretim derleme betiği')
  if (scripts.lint || scripts.typecheck) add(tests, 'Lint/tip denetimi')

  const apiFiles = paths.filter((file) => /(^|\/)(?:api|routes?|controllers?|endpoints?)(\/|\.|$)/i.test(file)).slice(0, 100)
  const migrationFiles = paths.filter((file) => /(^|\/)(?:migrations?|alembic|prisma\/migrations)(\/|\.|$)/i.test(file)).slice(0, 100)
  const hasEnvironmentExample = paths.some((file) => /(^|\/)(?:\.env\.example|\.env\.sample|\.env\.template|appsettings\.example\.json)$/i.test(file))
  const hasDockerConfig = paths.some((file) => /(^|\/)(?:dockerfile|docker-compose(?:\.[^/]+)?\.ya?ml)$/i.test(file))
  const hasAuthSignals = has(/(?:passport|nextauth|authjs|oauth|openid|jwt|bcrypt|argon2|login|logout|passwordhash|authorize|authorization|session)/)
  const recommendations: string[] = []
  const hasTestSignal = Boolean(scripts.test || scripts['test:unit'] || scripts['test:e2e'] || has(/pytest|unittest|vitest|jest|playwright/))
  if (!hasTestSignal) recommendations.push('Projede test komutu algılanmadı; build veya lint betiği test başarısı değildir. Uygun bir test ekle ve sonucu ayrıca raporla.')
  if (databases.length && !migrationFiles.length) recommendations.push('Veritabanı kullanılıyor ancak migration dosyası algılanmadı; mevcut şemayı ve veriyi incelemeden yıkıcı şema değişikliği yapma.')
  if (hasAuthSignals) recommendations.push('Kimlik doğrulama işaretleri algılandı; kimlik doğrulama ve kaynak yetkilendirmesini ayrı doğrula, hassas bilgileri test günlüklerine yazma.')
  if (!hasEnvironmentExample && /process\.env|os\.environ|configurationmanager/.test(all)) recommendations.push('Ortam değişkeni kullanımı var, güvenli sır içermeyen bir .env.example veya yapılandırma belgesi eklenmesi yararlı olur.')
  if (hasDockerConfig) recommendations.push('Docker yapılandırması var; Docker gerektiren komutları çalıştırmadan önce yerel motorun kullanılabilirliğini denetle.')

  return { filesScanned: paths.length, frontend, backend, databases, dataAccess, packageManagers, tests, apiFiles, migrationFiles, hasAuthSignals, hasEnvironmentExample, hasDockerConfig, packageScripts: scripts, recommendations }
}

export function validateLocalWebUrl(value: string): URL {
  if (value.length > 2048) throw new Error('HTTP kontrol URL’si çok uzun.')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Geçerli tam HTTP URL’si belirtin, örnek: http://127.0.0.1:3000/health') }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback = hostname === 'localhost' || hostname === '::1' || (net.isIPv4(hostname) && Number(hostname.split('.')[0]) === 127)
  if (!['http:', 'https:'].includes(url.protocol) || !loopback || url.username || url.password) throw new Error('Web sağlık kontrolü kimlik bilgisi içermeyen yalnızca localhost/loopback HTTP(S) URL’lerini kabul eder.')
  return url
}

export async function checkLocalWebUrl(value: string, timeoutMs = 5_000) {
  const url = validateLocalWebUrl(value)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15_000) throw new Error('HTTP zaman aşımı 100–15000 ms arasında olmalı.')
  const started = Date.now()
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json, text/plain, text/html;q=0.9, */*;q=0.5' } })
    let body = ''
    if (response.body && response.status !== 204 && response.status !== 304) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let size = 0
      while (size < 8_192) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = value.subarray(0, 8_192 - size)
        size += chunk.byteLength
        body += decoder.decode(chunk, { stream: size < 8_192 })
        if (chunk.byteLength !== value.byteLength) { await reader.cancel(); break }
      }
      await reader.cancel().catch(() => undefined)
    }
    return { url: url.toString(), method: 'GET', status: response.status, ok: response.ok, redirected: response.status >= 300 && response.status < 400, contentType: response.headers.get('content-type'), elapsedMs: Date.now() - started, body: body.slice(0, 8_192) }
  } catch (error) {
    return { url: url.toString(), method: 'GET', status: null, ok: false, redirected: false, contentType: null, elapsedMs: Date.now() - started, body: '', error: (error as Error).name === 'TimeoutError' ? `Yerel HTTP isteği ${timeoutMs} ms içinde yanıt vermedi.` : (error as Error).message }
  }
}

export function validateSqliteReadQuery(sql: string) {
  const normalized = sql.trim()
  if (!normalized || normalized.length > 5_000) throw new Error('SQLite sorgusu boş veya 5000 karakterden uzun.')
  if (/[;\u0000]/.test(normalized.replace(/;\s*$/, ''))) throw new Error('Yalnızca tek bir salt okunur SQLite sorgusu desteklenir.')
  if (!/^(?:select|with)\b/i.test(normalized)) throw new Error('SQLite query işlemi yalnızca SELECT veya WITH sorgusu çalıştırır.')
  if (/\b(?:attach|detach|pragma|insert|update|delete|replace|create|drop|alter|vacuum|reindex|load_extension)\b/i.test(normalized)) throw new Error('Sorguda salt okunur olmayan veya özel SQLite komutu algılandı.')
  return normalized.replace(/;\s*$/, '')
}
