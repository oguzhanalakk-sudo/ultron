// Bellek içi statik tutarlılık denetimi. Diske hiçbir şey yazmaz ve çalıştırmaz:
// yalnızca "yol -> içerik" haritası üzerinde import çözümleme, bağımlılık uyumu,
// dosya adı çakışması, entry/komut hedefleri ve yol güvenliği denetimi yapar.
// Aynı çözümleyici hem plan aşamasında (bellekteki plan) hem de doğrulama
// aşamasında (diskten okunan dosyalar) kullanılır.
import { builtinModules } from 'node:module'
import path from 'node:path'

export type PlanIssueSeverity = 'error' | 'warning'

export type PlanIssue = {
  severity: PlanIssueSeverity
  code: string
  message: string
  path?: string
}

export type FileMap = ReadonlyMap<string, string>

export type AnalysisOptions = {
  entryFiles?: readonly string[]
  commands?: { install?: string; build?: string; test?: string; run?: string }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/** Göreli proje yolunun güvenli olup olmadığını denetler; sorun varsa açıklama döner. */
export function relativePathProblem(value: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return 'Yol boş.'
  if (value.includes('\0')) return 'Yol NUL karakteri içeriyor.'
  if (value.includes('\\')) return 'Yol ters eğik çizgi içeriyor; "/" kullanılmalı.'
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return 'Mutlak yol reddedildi.'
  if (value.endsWith('/')) return 'Yol bir dosya adıyla bitmeli.'
  for (const segment of value.split('/')) {
    if (segment === '..') return 'Yol proje kapsamı dışına çıkıyor (..).'
    if (segment === '.' || segment === '') return 'Yol boş veya "." bölümü içeriyor.'
    if (/[. ]$/.test(segment) || WINDOWS_RESERVED.test(segment) || /[<>:"|?*]/.test(segment)) return `Yol bölümü Windows'ta geçersiz: ${segment}`
  }
  return undefined
}

const error = (code: string, message: string, filePath?: string): PlanIssue => ({ severity: 'error', code, message, ...(filePath ? { path: filePath } : {}) })
const warning = (code: string, message: string, filePath?: string): PlanIssue => ({ severity: 'warning', code, message, ...(filePath ? { path: filePath } : {}) })

// ---------------------------------------------------------------- manifestler

/** Yalnızca söz dizimini denetleyen küçük TOML doğrulayıcısı (değerleri yorumlamaz). */
export function tomlProblem(text: string): string | undefined {
  const lines = text.split(/\r?\n/)
  let depth = 0
  let multiline = ''
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]
    if (multiline) {
      if (line.includes(multiline)) multiline = ''
      continue
    }
    line = line.replace(/^\s+/, '')
    if (!line || line.startsWith('#')) continue
    if (depth === 0) {
      if (/^\[\[?[^\]]+\]\]?\s*(#.*)?$/.test(line)) continue
      const match = /^([A-Za-z0-9_.\-"']+)\s*=\s*(.*)$/.exec(line)
      if (!match) return `Satır ${index + 1}: geçersiz TOML söz dizimi.`
      const value = match[2].trim()
      const tripleQuote = /^("""|''')/.exec(value)
      if (tripleQuote) {
        if (!value.slice(3).includes(tripleQuote[1])) multiline = tripleQuote[1]
        continue
      }
      if (!value) return `Satır ${index + 1}: değer eksik.`
      if (/^["']/.test(value)) {
        const quote = value[0]
        const end = value.indexOf(quote, 1)
        if (end < 0) return `Satır ${index + 1}: kapatılmamış metin.`
        continue
      }
    }
    for (const char of line.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '').replace(/#.*$/, '')) {
      if (char === '[' || char === '{') depth += 1
      else if (char === ']' || char === '}') depth -= 1
    }
    if (depth < 0) return `Satır ${index + 1}: dengesiz parantez.`
  }
  if (depth !== 0) return 'Kapatılmamış dizi veya tablo.'
  return multiline ? 'Kapatılmamış çok satırlı metin.' : undefined
}

const REQUIREMENT_LINE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[^\]]+\])?\s*((===|==|>=|<=|~=|!=|>|<)\s*[^;#\s,<>=!~]+(\s*,\s*(===|==|>=|<=|~=|!=|>|<)\s*[^;#\s,<>=!~]+)*)?\s*(;[^#]*)?(#.*)?$/

type PackageJson = {
  main?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function parsePackageJson(content: string): PackageJson | undefined {
  try {
    const parsed: unknown = JSON.parse(content)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as PackageJson : undefined
  } catch {
    return undefined
  }
}

function normalizeDistribution(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

export type DependencySummary = {
  npm: string[]
  python: string[]
  go: string[]
  rust: string[]
}

/** Python bağımlılık adlarını requirements*.txt ve pyproject.toml dosyalarından toplar. */
function pythonRequirements(files: FileMap): Set<string> | undefined {
  const names = new Set<string>()
  let found = false
  for (const [file, content] of files) {
    const base = path.posix.basename(file)
    if (/^requirements[\w.-]*\.txt$/.test(base)) {
      found = true
      for (const raw of content.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#') || line.startsWith('-')) continue
        const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line)
        if (match) names.add(normalizeDistribution(match[1]))
      }
    } else if (base === 'pyproject.toml') {
      found = true
      for (const block of content.matchAll(/dependencies\s*=\s*\[([\s\S]*?)\]/g)) {
        for (const item of block[1].matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)/g)) names.add(normalizeDistribution(item[1]))
      }
    }
  }
  return found ? names : undefined
}

function goModule(files: FileMap): { module?: string; requires: string[] } {
  const content = files.get('go.mod')
  if (content === undefined) return { requires: [] }
  const module = /^module\s+(\S+)/m.exec(content)?.[1]
  const requires: string[] = []
  for (const block of content.matchAll(/^require\s*\(([\s\S]*?)\)/gm)) {
    for (const line of block[1].split(/\r?\n/)) {
      const name = /^\s*(\S+)\s+v\S+/.exec(line)?.[1]
      if (name) requires.push(name)
    }
  }
  for (const line of content.matchAll(/^require\s+(\S+)\s+v\S+/gm)) requires.push(line[1])
  return { module, requires }
}

function cargoDependencies(content: string): Set<string> {
  const names = new Set<string>()
  let section = ''
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header) {
      section = header[1].trim()
      const table = /^(?:[\w-]+\.)?(?:dev-|build-)?dependencies\.([\w-]+)$/.exec(section)
      if (table) names.add(table[1].replace(/-/g, '_'))
      continue
    }
    if (/^(?:[\w."-]+\.)?(?:dev-|build-)?dependencies$/.test(section)) {
      const name = /^([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1]
      if (name) names.add(name.replace(/-/g, '_'))
    }
  }
  return names
}

export function collectDependencies(files: FileMap): DependencySummary {
  const npm = new Set<string>()
  for (const [file, content] of files) {
    if (path.posix.basename(file) !== 'package.json') continue
    const pkg = parsePackageJson(content)
    for (const group of [pkg?.dependencies, pkg?.devDependencies, pkg?.peerDependencies, pkg?.optionalDependencies]) {
      for (const name of Object.keys(group ?? {})) npm.add(name)
    }
  }
  const cargo = new Set<string>()
  for (const [file, content] of files) if (path.posix.basename(file) === 'Cargo.toml') for (const name of cargoDependencies(content)) cargo.add(name)
  return {
    npm: [...npm].sort(),
    python: [...(pythonRequirements(files) ?? [])].sort(),
    go: goModule(files).requires.sort(),
    rust: [...cargo].sort(),
  }
}

function checkManifests(files: FileMap): PlanIssue[] {
  const issues: PlanIssue[] = []
  for (const [file, content] of files) {
    const base = path.posix.basename(file)
    if (base === 'package.json') {
      const pkg = parsePackageJson(content)
      if (!pkg) {
        issues.push(error('invalid-manifest', 'package.json geçerli bir JSON nesnesi değil.', file))
        continue
      }
      const dir = path.posix.dirname(file)
      const main = typeof pkg.main === 'string' ? path.posix.normalize(path.posix.join(dir, pkg.main)) : undefined
      if (main && !/^(?:\.\/)?(?:out|dist|build)\//.test(pkg.main ?? '') && !files.has(main)) {
        issues.push(error('missing-target', `package.json "main" alanı olmayan dosyaya işaret ediyor: ${pkg.main}`, file))
      }
    } else if (base === 'Cargo.toml' || base === 'pyproject.toml') {
      const problem = tomlProblem(content)
      if (problem) issues.push(error('invalid-manifest', `${base} geçersiz: ${problem}`, file))
      else if (base === 'Cargo.toml' && !/^\[(package|workspace)\]/m.test(content)) issues.push(error('invalid-manifest', 'Cargo.toml [package] veya [workspace] bölümü içermiyor.', file))
    } else if (base === 'go.mod') {
      if (!/^module\s+\S+/m.test(content)) issues.push(error('invalid-manifest', 'go.mod "module" satırı içermiyor.', file))
      if (!/^go\s+\d/m.test(content)) issues.push(error('invalid-manifest', 'go.mod "go" sürüm satırı içermiyor.', file))
    } else if (/^requirements[\w.-]*\.txt$/.test(base)) {
      content.split(/\r?\n/).forEach((raw, index) => {
        const line = raw.trim()
        if (line && !line.startsWith('#') && !line.startsWith('-') && !REQUIREMENT_LINE.test(line)) {
          issues.push(error('invalid-manifest', `requirements satır ${index + 1} geçersiz: ${line}`, file))
        }
      })
    }
  }
  return issues
}

// ---------------------------------------------------------------- JS / TS

const JS_FILE = /\.(?:[cm]?[jt]sx?)$/
const JS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css']
const BUILTINS = new Set(builtinModules)

function jsSpecifiers(content: string): Array<{ spec: string; clause?: string }> {
  const found: Array<{ spec: string; clause?: string }> = []
  for (const match of content.matchAll(/^[ \t]*(?:import|export)\b([^'";]*?)\bfrom\s*['"]([^'"\n]+)['"]/gm)) found.push({ spec: match[2], clause: match[1] })
  for (const match of content.matchAll(/^[ \t]*import\s*['"]([^'"\n]+)['"]/gm)) found.push({ spec: match[1] })
  for (const match of content.matchAll(/\b(?:require|import)\(\s*['"]([^'"\n]+)['"]\s*\)/g)) found.push({ spec: match[1] })
  return found
}

function resolveJs(files: FileMap, base: string): string | undefined {
  const candidates = [base, ...JS_EXTENSIONS.map((ext) => base + ext)]
  const stripped = base.replace(/\.(?:[cm]?js|jsx)$/, '')
  if (stripped !== base) candidates.push(stripped + '.ts', stripped + '.tsx', stripped + '.mts', stripped + '.cts')
  candidates.push(...JS_EXTENSIONS.map((ext) => `${base}/index${ext}`))
  return candidates.find((candidate) => files.has(candidate))
}

function jsExports(content: string): { names: Set<string>; hasDefault: boolean; opaque: boolean } {
  const names = new Set<string>()
  let hasDefault = /\bexport\s+default\b/.test(content)
  const opaque = /\bexport\s*\*/.test(content) || /\bmodule\.exports\b|\bexports\.\w+\s*=/.test(content)
  for (const match of content.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|class|abstract\s+class|const|let|var|interface|type|enum)\s+(\w+)/g)) names.add(match[1])
  for (const match of content.matchAll(/\bexport\s*(?:type\s*)?\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const piece = part.trim().replace(/^type\s+/, '')
      if (!piece) continue
      const alias = /\bas\s+(\w+)$/.exec(piece)?.[1] ?? piece
      if (alias === 'default') hasDefault = true
      else names.add(alias)
    }
  }
  return { names, hasDefault, opaque }
}

function importedNames(clause: string): { defaultName?: string; names: string[] } {
  const names: string[] = []
  const braces = /\{([^}]*)\}/.exec(clause)
  if (braces) {
    for (const part of braces[1].split(',')) {
      const piece = part.trim().replace(/^type\s+/, '')
      if (piece) names.push(piece.split(/\s+as\s+/)[0].trim())
    }
  }
  const head = clause.replace(/\{[^}]*\}/, '').replace(/^\s*type\s+/, '').split(',')[0]?.trim()
  const defaultName = head && /^\w+$/.test(head) ? head : undefined
  return { defaultName, names }
}

function packageName(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function ancestorDirs(file: string): string[] {
  const dirs: string[] = []
  let dir = path.posix.dirname(file)
  while (true) {
    dirs.push(dir === '.' ? '' : dir)
    if (dir === '.' || dir === '') break
    dir = path.posix.dirname(dir)
  }
  return dirs
}

function declaredNpmPackages(files: FileMap, file: string): Set<string> | undefined {
  let found = false
  const names = new Set<string>()
  for (const dir of ancestorDirs(file)) {
    const content = files.get(dir ? `${dir}/package.json` : 'package.json')
    if (content === undefined) continue
    found = true
    const pkg = parsePackageJson(content)
    for (const group of [pkg?.dependencies, pkg?.devDependencies, pkg?.peerDependencies, pkg?.optionalDependencies]) {
      for (const name of Object.keys(group ?? {})) names.add(name)
    }
  }
  return found ? names : undefined
}

function checkJs(files: FileMap): PlanIssue[] {
  const issues: PlanIssue[] = []
  for (const [file, content] of files) {
    if (!JS_FILE.test(file)) continue
    const declared = declaredNpmPackages(files, file)
    for (const { spec, clause } of jsSpecifiers(content)) {
      if (spec.startsWith('.')) {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))
        if (base.startsWith('..')) {
          issues.push(error('import-outside-project', `Import proje dışına çıkıyor: ${spec}`, file))
          continue
        }
        const target = resolveJs(files, base)
        if (!target) {
          issues.push(error('unresolved-import', `Import çözümlenemedi: ${spec}`, file))
          continue
        }
        if (clause && JS_FILE.test(target) && !/^\s*\*/.test(clause)) {
          const exported = jsExports(files.get(target) ?? '')
          if (exported.opaque) continue
          const { defaultName, names } = importedNames(clause)
          if (defaultName && !exported.hasDefault) issues.push(error('unresolved-export', `${spec} dosyasında default export yok.`, file))
          for (const name of names) {
            if (!exported.names.has(name)) issues.push(error('unresolved-export', `${spec} dosyasında "${name}" dışa aktarımı yok.`, file))
          }
        }
        continue
      }
      if (/^(?:\/|https?:|data:|virtual:|~|@\/|#)/.test(spec)) continue
      if (spec.startsWith('node:') || BUILTINS.has(spec.split('/')[0]) || BUILTINS.has(spec)) continue
      if (!declared) continue
      const name = packageName(spec)
      if (!declared.has(name)) issues.push(error('missing-dependency', `"${name}" import ediliyor ama package.json bağımlılıklarında yok.`, file))
    }
  }
  return issues
}

// ---------------------------------------------------------------- Python

const PY_STDLIB = new Set(['__future__', 'abc', 'argparse', 'ast', 'asyncio', 'base64', 'collections', 'contextlib', 'contextvars', 'copy', 'csv', 'dataclasses', 'datetime', 'decimal', 'enum', 'functools', 'glob', 'hashlib', 'heapq', 'http', 'importlib', 'inspect', 'io', 'itertools', 'json', 'logging', 'math', 'multiprocessing', 'operator', 'os', 'pathlib', 'pickle', 'platform', 'queue', 'random', 're', 'secrets', 'shutil', 'signal', 'socket', 'sqlite3', 'ssl', 'string', 'struct', 'subprocess', 'sys', 'tempfile', 'textwrap', 'threading', 'time', 'traceback', 'types', 'typing', 'unittest', 'urllib', 'uuid', 'warnings', 'weakref', 'zipfile', 'zoneinfo', 'pprint', 'bisect', 'codecs', 'statistics', 'selectors', 'shlex', 'getpass', 'gzip', 'tarfile', 'html', 'xml', 'email', 'smtplib', 'calendar', 'locale', 'fnmatch', 'difflib', 'tomllib', 'concurrent', 'configparser', 'binascii', 'atexit', 'errno', 'ctypes', 'unicodedata', 'sched', 'numbers', 'fractions', 'array', 'bz2', 'lzma', 'zlib', 'mimetypes', 'webbrowser', 'pdb', 'timeit', 'cProfile', 'gc', 'builtins'])
const PY_IMPORT_ALIASES: Record<string, string[]> = {
  yaml: ['pyyaml'], PIL: ['pillow'], jwt: ['pyjwt'], dotenv: ['python-dotenv'], jose: ['python-jose'], multipart: ['python-multipart'],
  bs4: ['beautifulsoup4'], sklearn: ['scikit-learn'], cv2: ['opencv-python'], attr: ['attrs'], dateutil: ['python-dateutil'],
}
const PY_IMPLIED: Record<string, string[]> = {
  fastapi: ['starlette', 'pydantic', 'typing-extensions', 'anyio'],
  uvicorn: ['click', 'h11'],
  pytest: ['pluggy', 'iniconfig'],
  sqlalchemy: ['typing-extensions'],
  pydantic: ['typing-extensions', 'annotated-types'],
}

function blankPythonStrings(content: string): string {
  return content.replace(/("""|''')[\s\S]*?\1/g, (block) => block.replace(/[^\n]/g, ' '))
}

type PyImport = { level: number; module: string; names: string[]; indented: boolean }

function pythonImports(content: string): PyImport[] {
  const text = blankPythonStrings(content)
  const result: PyImport[] = []
  for (const match of text.matchAll(/^([ \t]*)from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm)) {
    const names = match[4].replace(/[()]/g, ' ').replace(/#.*$/gm, '').split(',').map((part) => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
    result.push({ level: match[2].length, module: match[3], names, indented: match[1].length > 0 })
  }
  for (const match of text.matchAll(/^([ \t]*)import[ \t]+([^\n#]+)/gm)) {
    for (const part of match[2].split(',')) {
      const module = part.trim().split(/\s+as\s+/)[0].trim()
      if (/^[\w.]+$/.test(module)) result.push({ level: 0, module, names: [], indented: match[1].length > 0 })
    }
  }
  return result
}

function pythonDefines(content: string, name: string): boolean {
  const text = blankPythonStrings(content)
  if (/^\s*from\s+\S+\s+import\s+\*/m.test(text)) return true
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\s*(?:async\\s+def|def|class)\\s+${escaped}\\b|^\\s*${escaped}\\s*(?::[^=\\n]+)?=|^\\s*(?:from\\s+\\S+\\s+)?import\\s+[^\\n]*\\b${escaped}\\b|^\\s*from\\s+\\S+\\s+import\\s+[^\\n]*\\b${escaped}\\b|__all__[^\\n]*['"]${escaped}['"]`, 'm').test(text)
}

function pyModuleFile(files: FileMap, parts: string[]): string | undefined {
  const base = parts.join('/')
  if (!base) return files.has('__init__.py') ? '__init__.py' : undefined
  return [`${base}.py`, `${base}/__init__.py`].find((candidate) => files.has(candidate))
}

function pyPackageExists(files: FileMap, parts: string[]): boolean {
  const prefix = parts.join('/') + '/'
  for (const file of files.keys()) if (file.startsWith(prefix) && file.endsWith('.py')) return true
  return false
}

function pyIsLocalTop(files: FileMap, top: string): boolean {
  return files.has(`${top}.py`) || pyPackageExists(files, [top])
}

function checkPython(files: FileMap): PlanIssue[] {
  const issues: PlanIssue[] = []
  const requirements = pythonRequirements(files)
  let reportedManifest = false
  for (const [file, content] of files) {
    if (!file.endsWith('.py')) continue
    for (const item of pythonImports(content)) {
      let parts = item.module ? item.module.split('.') : []
      if (item.level > 0) {
        const dir = path.posix.dirname(file).split('/').filter((part) => part && part !== '.')
        const up = item.level - 1
        if (up > dir.length) {
          issues.push(error('import-outside-project', `Göreli import proje dışına çıkıyor: ${'.'.repeat(item.level)}${item.module}`, file))
          continue
        }
        parts = [...dir.slice(0, dir.length - up), ...parts]
      } else {
        const top = parts[0]
        if (!top || PY_STDLIB.has(top)) continue
        if (!pyIsLocalTop(files, top)) {
          if (requirements === undefined) {
            if (!reportedManifest) issues.push(warning('missing-manifest', 'Python bağımlılık dosyası (requirements.txt / pyproject.toml) yok; üçüncü taraf importlar doğrulanamadı.', file))
            reportedManifest = true
            continue
          }
          const candidates = [normalizeDistribution(top), ...(PY_IMPORT_ALIASES[top] ?? [])]
          const satisfied = candidates.some((candidate) => requirements.has(candidate))
            || [...requirements].some((dist) => (PY_IMPLIED[dist] ?? []).includes(normalizeDistribution(top)))
          if (!satisfied) {
            const issue = item.indented ? warning : error
            issues.push(issue('missing-dependency', `"${top}" import ediliyor ama bağımlılık dosyalarında yok.`, file))
          }
          continue
        }
      }
      const moduleFile = pyModuleFile(files, parts)
      if (!moduleFile && !pyPackageExists(files, parts)) {
        issues.push(error('unresolved-import', `Modül çözümlenemedi: ${'.'.repeat(item.level)}${item.module}`, file))
        continue
      }
      for (const name of item.names) {
        if (name === '*') continue
        const submodule = pyModuleFile(files, [...parts, name]) ?? (pyPackageExists(files, [...parts, name]) ? 'namespace' : undefined)
        if (submodule) continue
        if (moduleFile && pythonDefines(files.get(moduleFile) ?? '', name)) continue
        issues.push(error('unresolved-import', `"${name}" adı ${'.'.repeat(item.level)}${item.module || parts.join('.')} modülünde bulunamadı.`, file))
      }
    }
  }
  return issues
}

// ---------------------------------------------------------------- Go

function checkGo(files: FileMap): PlanIssue[] {
  const issues: PlanIssue[] = []
  const goFiles = [...files.keys()].filter((file) => file.endsWith('.go'))
  if (!goFiles.length) return issues
  const { module, requires } = goModule(files)
  if (!files.has('go.mod')) issues.push(error('missing-manifest', 'Go dosyaları var ama go.mod yok.'))
  const packages = new Map<string, Set<string>>()
  for (const file of goFiles) {
    const content = files.get(file) ?? ''
    const clean = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const pkg = /^package\s+(\w+)/m.exec(clean)?.[1]
    if (!pkg) issues.push(error('invalid-source', 'Go dosyasında package bildirimi yok.', file))
    else {
      const dir = path.posix.dirname(file)
      const set = packages.get(dir) ?? new Set<string>()
      set.add(pkg.replace(/_test$/, ''))
      packages.set(dir, set)
    }
    const imports: string[] = []
    for (const block of clean.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) for (const item of block[1].matchAll(/"([^"]+)"/g)) imports.push(item[1])
    for (const single of clean.matchAll(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) imports.push(single[1])
    for (const spec of imports) {
      if (module && (spec === module || spec.startsWith(`${module}/`))) {
        const dir = spec === module ? '.' : spec.slice(module.length + 1)
        const exists = goFiles.some((candidate) => path.posix.dirname(candidate) === dir && !candidate.endsWith('_test.go'))
        if (!exists) issues.push(error('unresolved-import', `Yerel Go paketi çözümlenemedi: ${spec}`, file))
      } else if (spec.split('/')[0].includes('.')) {
        if (!requires.some((req) => spec === req || spec.startsWith(`${req}/`))) issues.push(error('missing-dependency', `"${spec}" import ediliyor ama go.mod require listesinde yok.`, file))
      }
    }
  }
  for (const [dir, names] of packages) {
    if (names.size > 1) issues.push(error('package-mismatch', `Aynı klasörde birden fazla Go paketi var (${[...names].join(', ')}).`, dir))
  }
  return issues
}

// ---------------------------------------------------------------- Rust

const RUST_BUILTIN_CRATES = new Set(['crate', 'self', 'super', 'std', 'core', 'alloc', 'proc_macro', 'test'])

function rustModuleDir(file: string): string {
  const base = path.posix.basename(file)
  const dir = path.posix.dirname(file)
  return ['main.rs', 'lib.rs', 'mod.rs'].includes(base) ? dir : `${dir}/${base.replace(/\.rs$/, '')}`
}

function checkRust(files: FileMap): PlanIssue[] {
  const issues: PlanIssue[] = []
  const rustFiles = [...files.keys()].filter((file) => file.endsWith('.rs'))
  if (!rustFiles.length) return issues
  const manifest = files.get('Cargo.toml')
  if (manifest === undefined) issues.push(error('missing-manifest', 'Rust dosyaları var ama Cargo.toml yok.'))
  const dependencies = manifest === undefined ? new Set<string>() : cargoDependencies(manifest)
  const roots = ['src/main.rs', 'src/lib.rs'].filter((root) => files.has(root))
  const rootMods = new Set<string>()
  for (const root of roots) for (const match of (files.get(root) ?? '').matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)/gm)) rootMods.add(match[1])
  const reachable = new Set<string>(roots)
  for (const file of rustFiles) {
    const content = (files.get(file) ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const declared = new Set<string>()
    for (const match of content.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*([;{])/gm)) {
      declared.add(match[1])
      if (match[2] !== ';') continue
      const dir = rustModuleDir(file)
      const target = [`${dir}/${match[1]}.rs`, `${dir}/${match[1]}/mod.rs`].find((candidate) => files.has(candidate))
      if (!target) issues.push(error('unresolved-import', `"mod ${match[1]};" için dosya bulunamadı (${dir}/${match[1]}.rs).`, file))
      else reachable.add(target)
    }
    for (const match of content.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+(?:::)?(\w+)(?:::(\w+))?/gm)) {
      const [, first, second] = match
      if (first === 'crate') {
        if (second && roots.length && !rootMods.has(second) && !roots.some((root) => new RegExp(`^\\s*(?:pub\\s+)?(?:fn|struct|enum|type|const|static|use)\\s+${second}\\b`, 'm').test(files.get(root) ?? ''))) {
          issues.push(error('unresolved-import', `crate::${second} kök dosyada tanımlı değil.`, file))
        }
        continue
      }
      if (RUST_BUILTIN_CRATES.has(first) || declared.has(first) || rootMods.has(first)) continue
      if (manifest !== undefined && !dependencies.has(first)) issues.push(error('missing-dependency', `"${first}" crate'i kullanılıyor ama Cargo.toml bağımlılıklarında yok.`, file))
    }
  }
  for (const file of rustFiles) {
    if (file.startsWith('src/bin/') || file === 'src/build.rs') continue
    if (file.startsWith('src/') && !reachable.has(file)) issues.push(warning('orphan-module', 'Dosya hiçbir mod bildirimiyle bağlanmamış.', file))
  }
  return issues
}

// ------------------------------------------------------- komutlar ve entry

const SCRIPT_BIN_PACKAGES: Record<string, string> = {
  vite: 'vite', next: 'next', tsc: 'typescript', 'electron-vite': 'electron-vite', concurrently: 'concurrently',
  vitest: 'vitest', tsx: 'tsx', electron: 'electron', eslint: 'eslint',
}
const NODE_RUNNERS = new Set(['node', 'tsx', 'ts-node', 'nodemon'])

function splitCommands(command: string): string[][] {
  return command.split(/\s*(?:&&|\|\||;)\s*/).map((part) => part.trim().split(/\s+/).map((token) => token.replace(/^["']|["']$/g, '')).filter(Boolean)).filter((tokens) => tokens.length)
}

function checkCommand(files: FileMap, command: string, origin: string, cwd: string, issues: PlanIssue[]): void {
  const prefix = cwd ? `${cwd}/` : ''
  const packageContent = files.get(`${prefix}package.json`)
  const scripts = packageContent ? parsePackageJson(packageContent)?.scripts ?? {} : undefined
  const declared = declaredNpmPackages(files, `${prefix}package.json`)
  for (const tokens of splitCommands(command)) {
    const [bin, ...rest] = tokens
    if (bin === 'npm') {
      const verb = rest[0]
      const script = verb === 'run' || verb === 'run-script' ? rest[1] : ['start', 'test'].includes(verb) ? verb : undefined
      const workspace = rest.some((token) => token === '--workspace' || token === '-w' || token.startsWith('--workspace='))
      if (script && !workspace) {
        if (!scripts) issues.push(error('missing-script', `${origin}: "${command}" için package.json yok.`, origin))
        else if (!(script in scripts)) issues.push(error('missing-script', `${origin}: package.json içinde "${script}" betiği yok.`, origin))
      }
      continue
    }
    if (NODE_RUNNERS.has(bin)) {
      const target = rest.find((token) => !token.startsWith('-') && /\.(?:[cm]?[jt]sx?)$/.test(token))
      if (target && !files.has(path.posix.normalize(path.posix.join(cwd || '.', target)))) issues.push(error('missing-target', `${origin}: komut olmayan dosyaya işaret ediyor: ${target}`, origin))
    } else if (bin === 'uvicorn') {
      const target = rest.find((token) => /^[\w.]+:\w+$/.test(token))
      if (target) {
        const [moduleName, variable] = target.split(':')
        const moduleFile = pyModuleFile(files, moduleName.split('.'))
        if (!moduleFile) issues.push(error('missing-target', `${origin}: uvicorn modülü bulunamadı: ${moduleName}`, origin))
        else if (!pythonDefines(files.get(moduleFile) ?? '', variable)) issues.push(error('missing-target', `${origin}: ${moduleFile} içinde "${variable}" tanımlı değil.`, origin))
      }
    } else if (bin === 'python' || bin === 'python3') {
      if (rest[0] !== '-m' && rest[0] && rest[0].endsWith('.py') && !files.has(rest[0])) issues.push(error('missing-target', `${origin}: komut olmayan dosyaya işaret ediyor: ${rest[0]}`, origin))
      if (rest[0] === '-m' && rest[1] && !['pip', 'pytest', 'compileall', 'py_compile', 'venv', 'uvicorn', 'unittest'].includes(rest[1]) && !pyModuleFile(files, rest[1].split('.'))) {
        issues.push(error('missing-target', `${origin}: python modülü bulunamadı: ${rest[1]}`, origin))
      }
    } else if (bin === 'go') {
      if (!files.has('go.mod')) issues.push(error('missing-manifest', `${origin}: go komutu için go.mod yok.`, origin))
      if (rest[0] === 'run' && rest[1]?.startsWith('./')) {
        const dir = path.posix.normalize(rest[1])
        if (!([...files.keys()].some((file) => file.endsWith('.go') && path.posix.dirname(file) === (dir === '.' ? '.' : dir)))) issues.push(error('missing-target', `${origin}: Go paket klasörü bulunamadı: ${rest[1]}`, origin))
      }
    } else if (bin === 'cargo' && !files.has('Cargo.toml')) {
      issues.push(error('missing-manifest', `${origin}: cargo komutu için Cargo.toml yok.`, origin))
    }
    const owner = SCRIPT_BIN_PACKAGES[bin]
    if (owner && declared && !declared.has(owner)) issues.push(error('missing-script-dependency', `${origin}: "${bin}" komutu için "${owner}" bağımlılığı yok.`, origin))
    for (const token of tokens) {
      const ref = /^npm:([\w:-]+)$/.exec(token)?.[1]
      if (ref && scripts && !(ref in scripts)) issues.push(error('missing-script', `${origin}: "${ref}" betiği package.json içinde yok.`, origin))
    }
  }
}

function checkScripts(files: FileMap): PlanIssue[] {
  const issues: PlanIssue[] = []
  for (const [file, content] of files) {
    if (path.posix.basename(file) !== 'package.json') continue
    const dir = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file)
    for (const [name, script] of Object.entries(parsePackageJson(content)?.scripts ?? {})) {
      if (typeof script === 'string') checkCommand(files, script, `${file}#scripts.${name}`, dir, issues)
    }
  }
  return issues
}

// ------------------------------------------------------------------- girdi

export function checkPlannedPaths(paths: readonly string[]): PlanIssue[] {
  const issues: PlanIssue[] = []
  const seen = new Map<string, string>()
  const all = new Set<string>()
  for (const file of paths) {
    const problem = relativePathProblem(file)
    if (problem) {
      issues.push(error('unsafe-path', `${problem} (${file})`, file))
      continue
    }
    const key = file.toLowerCase()
    const previous = seen.get(key)
    if (previous !== undefined) issues.push(error('duplicate-path', previous === file ? `Dosya birden fazla kez planlanmış: ${file}` : `Dosya adları büyük/küçük harf farkıyla çakışıyor: ${previous} / ${file}`, file))
    else seen.set(key, file)
    all.add(file)
  }
  for (const file of all) {
    const parts = file.split('/')
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/')
      if (all.has(parent)) issues.push(error('path-conflict', `"${parent}" hem dosya hem klasör olarak planlanmış.`, file))
    }
  }
  return issues
}

/** Dosya haritasının bütününü (yollar, manifestler, importlar, komutlar) denetler. */
export function analyzeProjectFiles(files: FileMap, options: AnalysisOptions = {}): PlanIssue[] {
  const issues = checkPlannedPaths([...files.keys()])
  if (issues.some((issue) => issue.code === 'unsafe-path')) return issues
  issues.push(...checkManifests(files), ...checkJs(files), ...checkPython(files), ...checkGo(files), ...checkRust(files), ...checkScripts(files))
  for (const entry of options.entryFiles ?? []) {
    if (!files.has(entry)) issues.push(error('missing-entry', `Entry dosyası planda/projede yok: ${entry}`, entry))
  }
  for (const [kind, command] of Object.entries(options.commands ?? {})) {
    if (command) checkCommand(files, command, `komut:${kind}`, '', issues)
  }
  return issues
}
