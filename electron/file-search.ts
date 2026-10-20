// Ultron File Discovery Engine: Türkçe arama ifadelerini ayrıştırır, dosya adı/uzantı/
// boyut/tarih filtreleriyle tarar, desteklenen biçimlerin içeriğinde metin arar ve
// yinelenen dosyaları bulur. Saf işlevler + enjekte edilebilir fs (test edilebilirlik).
// Yetki denetimi (hangi klasörde taranabilir) çağıran katman (main.ts) uygular.
import { promises as defaultFs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { buildTextSnippets, extractText } from './text-extract.ts'

export type FileSearchFsLite = {
  readdir: (p: string, options: { withFileTypes: true }) => Promise<Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean; isFile(): boolean }>>
  stat: (p: string) => Promise<{ size: number; mtimeMs: number }>
  readFile: (p: string) => Promise<Buffer>
}

export type SearchKind = 'document' | 'code' | 'data' | 'archive' | 'image' | 'video' | 'audio' | 'database' | 'package'

export type FileSearchQuery = {
  raw: string
  /** Dosya adında aranacak ifadeler ("adı X geçen", tırnaklı terimler). */
  nameTerms: string[]
  /** Dosya içeriğinde aranacak ifadeler ("içinde X geçen"). */
  contentTerms: string[]
  extensions: string[]
  kinds: SearchKind[]
  /** Klasör ipuçları: 'Downloads' | 'Desktop' | 'Documents' | 'Pictures' | 'Videos' | 'Music' */
  folderHints: string[]
  /** "bilgisayarımdaki..." → kapsam seçimi gerekir; çağıran katman kullanıcıya sorar. */
  wholeComputer: boolean
  modifiedWithin: 'day' | 'week' | 'month' | null
  sizeFilter: { op: 'gt' | 'lt'; bytes: number } | null
  sortBy: 'recent' | 'name' | 'size' | null
  recursive: boolean
  limit: number
  notices: string[]
}

export type SearchHit = {
  name: string
  /** Mutlak yol (kapsam kökü ile birleşmiş). */
  path: string
  /** Kapsam köküne göre göreli yol. */
  relativePath: string
  extension: string
  sizeBytes: number
  modifiedAt: string
  kind: SearchKind | 'other'
  score: number
  matchType: 'name' | 'content' | 'both'
  snippets: string[]
  extractNotice?: string
}

const kindByExtension = new Map<string, SearchKind>(Object.entries({
  '.pdf': 'document', '.docx': 'document', '.doc': 'document', '.pptx': 'document', '.ppt': 'document',
  '.odt': 'document', '.rtf': 'document', '.md': 'document', '.txt': 'document',
  '.py': 'code', '.js': 'code', '.mjs': 'code', '.cjs': 'code', '.ts': 'code', '.tsx': 'code', '.jsx': 'code',
  '.java': 'code', '.kt': 'code', '.kts': 'code', '.cs': 'code', '.c': 'code', '.h': 'code', '.cpp': 'code',
  '.hpp': 'code', '.go': 'code', '.rs': 'code', '.rb': 'code', '.php': 'code', '.swift': 'code', '.scala': 'code',
  '.gradle': 'code', '.gradle.kts': 'code', '.cmake': 'code', '.html': 'code', '.htm': 'code', '.css': 'code',
  '.scss': 'code', '.less': 'code', '.sql': 'code', '.sh': 'code', '.bat': 'code', '.ps1': 'code',
  '.json': 'data', '.csv': 'data', '.tsv': 'data', '.xml': 'data', '.yaml': 'data', '.yml': 'data', '.toml': 'data',
  '.ini': 'data', '.env': 'data', '.log': 'data', '.srt': 'data', '.vtt': 'data',
  '.zip': 'archive', '.rar': 'archive', '.7z': 'archive', '.tar': 'archive', '.gz': 'archive', '.jar': 'archive',
  '.ipa': 'archive',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.bmp': 'image',
  '.svg': 'image', '.ico': 'image', '.tif': 'image', '.tiff': 'image',
  '.mp4': 'video', '.avi': 'video', '.mkv': 'video', '.mov': 'video', '.webm': 'video', '.wmv': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.aac': 'audio',
  '.db': 'database', '.sqlite': 'database', '.sqlite3': 'database', '.mdb': 'database',
  '.apk': 'package', '.exe': 'package', '.msi': 'package', '.aab': 'package', '.deb': 'package', '.rpm': 'package',
}))

// Türkçe dosya türü ifadeleri → uzantı/hedef kümesi. Kalıp sınırları dönüştürülür:
// kelime sınırları korunmalı (örn. "java" ≠ "javascript").
const fileTypePatterns: Array<{ pattern: RegExp; extensions?: string[]; kinds?: SearchKind[] }> = [
  { pattern: /pdf(?![\p{L}\p{N}])/iu, extensions: ['.pdf'] },
  { pattern: /excel(?:li|le|de| Dosya|tablosu)?|xlsx|xls(?![\p{L}\p{N}])/iu, extensions: ['.xlsx', '.xls'] },
  { pattern: /word|docx|doc(?![\p{L}\p{N}])/iu, extensions: ['.docx', '.doc'] },
  { pattern: /python|\.py(?![\p{L}])/iu, extensions: ['.py'] },
  { pattern: /javascript|\.js(?![\p{L}\p{N}])/iu, extensions: ['.js', '.mjs'] },
  { pattern: /typescript|\.ts(?![\p{L}\p{N}])/iu, extensions: ['.ts', '.tsx'] },
  { pattern: /java(?![\p{L}\p{N}])/iu, extensions: ['.java'] },
  { pattern: /sunum|powerpoint|pptx|ppt(?![\p{L}\p{N}])/iu, extensions: ['.pptx', '.ppt'] },
  { pattern: /metin\s*dosya|\.txt(?![\p{L}\p{N}])/iu, extensions: ['.txt'] },
  { pattern: /(?<![\p{L}\p{N}])csv(?![\p{L}\p{N}])|tsv|tablo dosya/iu, extensions: ['.csv', '.tsv'] },
  { pattern: /(?<![\p{L}\p{N}])json(?![\p{L}\p{N}])/iu, extensions: ['.json'] },
  { pattern: /(?<![\p{L}\p{N}])xml(?![\p{L}\p{N}])/iu, extensions: ['.xml'] },
  { pattern: /(?<![\p{L}\p{N}])sql(?![\p{L}\p{N}])/iu, extensions: ['.sql'] },
  { pattern: /(?<![\p{L}\p{N}])html(?![\p{L}\p{N}])|web\s*sayfa/iu, extensions: ['.html', '.htm'] },
  { pattern: /markdown|\.md(?![\p{L}\p{N}])|md\s*dosya/iu, extensions: ['.md'] },
  { pattern: /log\s*dosy|\.log(?![\p{L}\p{N}])/iu, extensions: ['.log'] },
  { pattern: /apk(?![\p{L}\p{N}])/iu, extensions: ['.apk'] },
  { pattern: /jar(?![\p{L}\p{N}])/iu, extensions: ['.jar'] },
  { pattern: /exe(?![\p{L}\p{N}])|msi/iu, extensions: ['.exe', '.msi'] },
  { pattern: /resim|görsel|fotoğraf|image/iu, kinds: ['image'] },
  { pattern: /video/iu, kinds: ['video'] },
  { pattern: /müzik\s*dosya|audio/iu, kinds: ['audio'] },
  { pattern: /arşiv|sıkıştır[ıi]lm|zip\s*dosya|\.7z|\.rar/iu, kinds: ['archive'] },
  { pattern: /kod\s*dosya|kaynak\s*kod/iu, kinds: ['code'] },
  { pattern: /veritaban[ıi] dosya|sqlite|\.db(?![\p{L}\p{N}])/iu, kinds: ['database'] },
]

const folderHintPatterns: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /(?:[iİıI]ndirilen(?:ler|leri)|download)/iu, hint: 'Downloads' },
  { pattern: /masaüstü|desktop/iu, hint: 'Desktop' },
  { pattern: /belgeler|documents/iu, hint: 'Documents' },
  { pattern: /resim(?:ler|leri)|görseller|pictures/iu, hint: 'Pictures' },
  { pattern: /video(?:lar|ları)/iu, hint: 'Videos' },
  { pattern: /m[üu]z[iİı]ik(?:ler|leri)/iu, hint: 'Music' },
]

const sizePatterns: Array<{ pattern: RegExp; bytes: number }> = [
  { pattern: /çok\s*büyük|very\s*large/iu, bytes: 500 * 1024 * 1024 },
  { pattern: /büyük\b|large/iu, bytes: 50 * 1024 * 1024 },
]

const datePatterns: Array<{ pattern: RegExp; within: 'day' | 'week' | 'month' }> = [
  { pattern: /bugün(?:k[uü])?|today/iu, within: 'day' },
  { pattern: /d[üu]n(?:k[uü])?|son\s*7\s*gün|son\s*yedi\s*gün|bu\s*hafta|son\s*hafta|this\s*week/iu, within: 'week' },
  { pattern: /son\s*(?:30|otuz|31)\s*gün|bu\s*ay|son\s*ay/iu, within: 'month' },
]

// Ad arama kalıpları: «adı "X" geçen», «dosya adı "X"», «"X" adında dosya».
const nameTermPatterns: RegExp[] = [
  /ad[ıi]+\s*(?:geçen\s*)?["“']([^"”']{2,120})["“']/iu,
  /is(?:m)[iı]+\s*(?:geçen\s*)?["“']([^"”']{2,120})["“']/iu,
  /dosya ad[ıi]+n?\s*["“']([^"”']{2,120})["“']/iu,
  /["“']([^"”'\n]{2,120})["“']\s*(?:adında|isimli|adlı)\s*(?:dosya|k[üü]l)/iu,
]

// İçerik arama kalıpları: «içinde "X" geçen», «içinde X geçen», «içinde geçen X».
const contentTermPatterns: RegExp[] = [
  /için(?:de|deler|eri?nde|ğinde)\s*(?:geçen\s*|barındıran\s*|bulunduran\s*)?["“']([^"”'\n]{2,200})["“']/iu,
  /için(?:de|deler|eri?nde|ğinde)\s+([a-z0-9_.\-@]{2,200})\s+geç(?:en|iyor)/iu,
  /için(?:de|deler|eri?nde|ğinde)\s+(?:geçen|barındıran|bulunduran)\s+([a-z0-9_.\-@]{2,200})/iu,
]

const bigByte = 1024 * 1024

export function parseFileSearchRequest(request: string): FileSearchQuery {
  const text = request.trim()
  const notices: string[] = []
  const extensions = new Set<string>()
  const kinds = new Set<SearchKind>()
  for (const item of fileTypePatterns) {
    if (item.pattern.test(text)) {
      for (const extension of item.extensions ?? []) extensions.add(extension)
      for (const kind of item.kinds ?? []) kinds.add(kind)
    }
  }
  const folderHints = folderHintPatterns.filter((item) => item.pattern.test(text)).map((item) => item.hint)
  const wholeComputer = /bilgisayar[ıi]mdaki?|bilgisayardak[i]|t[üu]m\s*disk|b[üu]t[üu]n\s*disk/iu.test(text)
  let modifiedWithin: FileSearchQuery['modifiedWithin'] = null
  for (const item of datePatterns) {
    if (item.pattern.test(text)) { modifiedWithin = item.within; break }
  }
  let sizeFilter: FileSearchQuery['sizeFilter'] = null
  if (sizePatterns.some((item) => item.pattern.test(text))) {
    let bytes = 50 * bigByte
    for (const item of sizePatterns) {
      if (item.pattern.test(text)) { bytes = item.bytes; break }
    }
    sizeFilter = /k[üu]ç[üu]k\b|small/iu.test(text) ? { op: 'lt', bytes } : { op: 'gt', bytes }
  }
  const sortBy = /son\s*değiştirdi[ğg]im|en\s*yeni|recent/iu.test(text) ? 'recent' : /en\s*büyük/iu.test(text) ? 'size' : null
  const nameTerms: string[] = []
  for (const pattern of nameTermPatterns) {
    const match = pattern.exec(text)
    const term = match?.[1]?.trim()
    if (term && term.length >= 2) nameTerms.push(term)
  }
  const contentTerms: string[] = []
  for (const pattern of contentTermPatterns) {
    const match = pattern.exec(text)
    const term = match?.[1]?.trim()
    if (term && term.length >= 2) contentTerms.push(term)
  }
  const contentIntent = /için(?:de|deler|eri?nde|ğinde)/iu.test(text)
  if (contentIntent && contentTerms.length === 0) {
    notices.push('İçerik araması için «içinde "aramak istediğim" geçen» biçimini kullanın; şu an yalnızca ad/tür filtrelemesi yapılacak.')
  }
  return {
    raw: text,
    nameTerms,
    contentTerms,
    extensions: [...extensions],
    kinds: [...kinds],
    folderHints,
    wholeComputer,
    modifiedWithin,
    sizeFilter,
    sortBy,
    recursive: true,
    limit: 200,
    notices,
  }
}

const dayMs = 86_400_000
function withinCutoffMs(within: 'day' | 'week' | 'month'): number {
  if (within === 'day') return Date.now() - dayMs
  if (within === 'week') return Date.now() - 7 * dayMs
  return Date.now() - 30 * dayMs
}

export function requestMatchesExtensions(request: FileSearchQuery, extension: string): boolean {
  if (request.extensions.length === 0 && request.kinds.length === 0) return true
  const ext = extension.toLowerCase()
  if (request.extensions.includes(ext)) return true
  const kind = kindByExtension.get(ext)
  return Boolean(kind && request.kinds.includes(kind))
}

export type SearchableFileMeta = { name: string; sizeBytes: number; mtimeMs: number }

export function matchesFileMeta(meta: SearchableFileMeta, request: FileSearchQuery): boolean {
  if (!requestMatchesExtensions(request, path.extname(meta.name))) return false
  if (request.sizeFilter) {
    if (request.sizeFilter.op === 'gt' && meta.sizeBytes <= request.sizeFilter.bytes) return false
    if (request.sizeFilter.op === 'lt' && meta.sizeBytes >= request.sizeFilter.bytes) return false
  }
  if (request.modifiedWithin && meta.mtimeMs < withinCutoffMs(request.modifiedWithin)) return false
  if (request.nameTerms.length) {
    const lowerName = meta.name.toLocaleLowerCase('tr-TR')
    const allMatch = request.nameTerms.every((term) => lowerName.includes(term.toLocaleLowerCase('tr-TR')))
    if (!allMatch) return false
  }
  return true
}

export function scoreNameMatch(name: string, request: FileSearchQuery): number {
  if (!request.nameTerms.length) return 0
  const lowerName = name.toLocaleLowerCase('tr-TR')
  let score = 0
  for (const term of request.nameTerms) {
    const lowerTerm = term.toLocaleLowerCase('tr-TR')
    if (lowerName === lowerTerm) score += 6
    else if (lowerName.startsWith(lowerTerm)) score += 5
    else if (lowerName.includes(lowerTerm)) score += 3
  }
  return score
}

// Tarama seçenekleri: bellek ve süre koruması katı.
export type ScanOptions = {
  maxFiles: number
  maxDepth: number
  /** Metin aramasında tek dosyadan okunacak en fazla bayt. */
  maxReadBytes: number
  /** Toplam okunacak bayt tavanı (içerik araması). */
  maxTotalReadBytes: number
  excludedDirNames: Set<string>
}

export const defaultScanOptions: ScanOptions = {
  maxFiles: 150_000,
  maxDepth: 32,
  maxReadBytes: 24 * 1024 * 1024,
  maxTotalReadBytes: 96 * 1024 * 1024,
  excludedDirNames: new Set(['node_modules', '.git', 'dist', 'out', 'build', 'Build', 'Output', 'bin', 'obj',
    '__pycache__', '.venv', 'venv', '.gradle', '.idea', '.vs', '.vscode', 'coverage', 'target',
    '.cache', '.cargo', 'vendor', '.pnpm-store', '.yarn', 'site-packages', '$RECYCLE.BIN', 'System Volume Information']),
}

export type ScanResult = {
  root: string
  hits: SearchHit[]
  visitedFiles: number
  visitedDirs: number
  permissionDenied: number
  errors: number
  truncated: boolean
  readBytes: number
  durationMs: number
}

export async function scanDirectoryForQuery(
  root: string,
  request: FileSearchQuery,
  options: Partial<ScanOptions> = {},
  fs: FileSearchFsLite = defaultFs as unknown as FileSearchFsLite,
): Promise<ScanResult> {
  const config = { ...defaultScanOptions, ...options }
  const startedAt = Date.now()
  const hits: SearchHit[] = []
  const contentSearchable = request.contentTerms.length > 0
  let visitedFiles = 0
  let visitedDirs = 0
  let permissionDenied = 0
  let errors = 0
  let truncated = false
  let readBytes = 0

  const visit = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return
    if (depth > config.maxDepth) { truncated = true; return }
    visitedDirs++
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code ?? ''
      if (['EACCES', 'EPERM'].includes(code)) permissionDenied++
      else errors++
      return
    }
    for (const entry of entries) {
      if (truncated) return
      if (visitedFiles >= config.maxFiles) { truncated = true; return }
      const childPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (config.excludedDirNames.has(entry.name)) continue
        await visit(childPath, depth + 1)
        continue
      }
      if (entry.isSymbolicLink() || !entry.isFile()) continue
      visitedFiles++
      let stat
      try {
        stat = await fs.stat(childPath)
      } catch { errors++; continue }
      const meta: SearchableFileMeta = { name: entry.name, sizeBytes: stat.size, mtimeMs: stat.mtimeMs }
      if (!matchesFileMeta(meta, request)) continue
      const nameScore = scoreNameMatch(entry.name, request)
      if (!contentSearchable) {
        hits.push(buildSearchHit(childPath, root, meta, nameScore, [], undefined))
        if (hits.length >= request.limit) { truncated = true; return }
        continue
      }
      if (stat.size > config.maxReadBytes) continue
      if (readBytes + stat.size > config.maxTotalReadBytes) { truncated = true; return }
      let content: Buffer
      try {
        content = await fs.readFile(childPath)
        readBytes += stat.size
      } catch { errors++; continue }
      const extraction = extractText(content, entry.name)
      if (extraction.isBinary) continue
      const snippets: string[] = []
      let matched = false
      for (const term of request.contentTerms) {
        const found = buildTextSnippets(extraction.text, term)
        if (found.length) { matched = true; snippets.push(...found.slice(0, 3)) }
      }
      if (!matched) continue
      const combinedScore = nameScore * 2 + snippets.length
      hits.push(buildSearchHit(childPath, root, meta, combinedScore, snippets, extraction.notice))
      if (hits.length >= request.limit) { truncated = true; return }
    }
  }

  await visit(root, 0)
  if (request.sortBy === 'recent') hits.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
  else if (request.sortBy === 'size') hits.sort((a, b) => b.sizeBytes - a.sizeBytes)
  else hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return { root, hits, visitedFiles, visitedDirs, permissionDenied, errors, truncated, readBytes, durationMs: Date.now() - startedAt }
}

function relativeToRoot(root: string, absPath: string): string {
  try {
    const relative = path.relative(root, absPath)
    return relative.startsWith('..') ? absPath : relative.split(path.sep).join('/')
  } catch { return absPath }
}

function buildSearchHit(absPath: string, root: string, meta: SearchableFileMeta, score: number, snippets: string[], notice: string | undefined): SearchHit {
  const extension = path.extname(meta.name).toLowerCase()
  return {
    name: meta.name,
    path: absPath,
    relativePath: relativeToRoot(root, absPath),
    extension,
    sizeBytes: meta.sizeBytes,
    modifiedAt: new Date(meta.mtimeMs).toISOString(),
    kind: kindByExtension.get(extension) ?? 'other',
    score,
    matchType: snippets.length ? (score > 0 ? 'both' : 'content') : 'name',
    snippets,
    extractNotice: notice,
  }
}

// ---- Yinelenen dosya tespiti: boyut bucket → içerik SHA-256 ----
export type DuplicateGroup = {
  sizeBytes: number
  hash: string
  files: Array<{ path: string; relativePath: string; name: string; modifiedAt: string }>
}

export type DuplicateResult = {
  root: string
  groups: DuplicateGroup[]
  visitedFiles: number
  truncated: boolean
  skipped: number
  durationMs: number
}

export async function findDuplicateFiles(
  root: string,
  options: { minSizeBytes?: number; maxFiles?: number; maxHashedBytes?: number; maxHashFileSize?: number; fs?: FileSearchFsLite } = {},
): Promise<DuplicateResult> {
  const fs = options.fs ?? defaultFs as unknown as FileSearchFsLite
  const minSizeBytes = options.minSizeBytes ?? 4096
  const maxFiles = options.maxFiles ?? 60_000
  const maxHashedBytes = options.maxHashedBytes ?? 10 * 1024 * 1024 * 1024
  const maxHashFileSize = options.maxHashFileSize ?? 256 * 1024 * 1024
  const startedAt = Date.now()
  const files: Array<{ path: string; name: string; size: number; mtime: number }> = []
  let visitedFiles = 0
  let truncated = false
  let skipped = 0

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return
    if (depth > defaultScanOptions.maxDepth) { truncated = true; return }
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (truncated) return
      if (visitedFiles >= maxFiles) { truncated = true; return }
      const childPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (defaultScanOptions.excludedDirNames.has(entry.name)) continue
        await walk(childPath, depth + 1)
        continue
      }
      if (entry.isSymbolicLink() || !entry.isFile()) continue
      visitedFiles++
      try {
        const stat = await fs.stat(childPath)
        if (stat.size < minSizeBytes) continue
        files.push({ path: childPath, name: entry.name, size: stat.size, mtime: stat.mtimeMs })
      } catch { continue }
    }
  }
  await walk(root, 0)
  const buckets = new Map<number, Array<{ path: string; name: string; size: number; mtime: number }>>()
  for (const file of files) {
    const bucket = buckets.get(file.size) ?? []
    bucket.push(file)
    buckets.set(file.size, bucket)
  }
  // Yalnızca boyut çakışan gruplar hash edilir; toplam hashed bayt sınırı katıdır.
  const candidateBuckets = [...buckets.entries()].filter(([, bucket]) => bucket.length > 1).slice(0, 300)
  const groups: DuplicateGroup[] = []
  let hashedBytes = 0
  for (const [size, bucket] of candidateBuckets) {
    if (truncated) break
    if (size > maxHashFileSize) { skipped += bucket.length; continue }
    const byHash = new Map<string, Array<{ path: string; name: string; mtime: number; size: number }>>()
    for (const file of bucket) {
      if (hashedBytes + size > maxHashedBytes) { truncated = true; break }
      try {
        const content = await fs.readFile(file.path)
        hashedBytes += Math.min(size, content.length)
        const hash = createHash('sha256').update(content).digest('hex')
        byHash.set(hash, [...(byHash.get(hash) ?? []), file])
      } catch { continue }
    }
    for (const [hash, same] of byHash) {
      if (same.length <= 1) continue
      groups.push({
        sizeBytes: size,
        hash,
        files: same.map((file) => ({
          path: file.path,
          relativePath: relativeToRoot(root, file.path),
          name: file.name,
          modifiedAt: new Date(file.mtime).toISOString(),
        })),
      })
    }
  }
  groups.sort((a, b) => b.files.length - a.files.length || b.sizeBytes - a.sizeBytes)
  if (groups.length > 100) groups.length = 100
  return { root, groups, visitedFiles, truncated, skipped, durationMs: Date.now() - startedAt }
}

// ---- İndeks: kapsam kökü için dosya indeksi (isim/filtre aramasını hızlandırır) ----
export type FileIndexEntry = [name: string, relativePath: string, sizeBytes: number, mtimeMs: number]
export type FileIndex = { root: string; builtAt: string; entries: FileIndexEntry[]; truncated: boolean }

export async function buildFileIndex(root: string, options: { maxFiles?: number; maxDepth?: number; fs?: FileSearchFsLite } = {}): Promise<FileIndex> {
  const fs = options.fs ?? defaultFs as unknown as FileSearchFsLite
  const maxFiles = options.maxFiles ?? 40_000
  const maxDepth = options.maxDepth ?? defaultScanOptions.maxDepth
  const entries: FileIndexEntry[] = []
  let truncated = false
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return
    if (depth > maxDepth) { truncated = true; return }
    let list
    try { list = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of list) {
      if (truncated || entries.length >= maxFiles) { truncated = truncated || entries.length >= maxFiles; if (truncated) return }
      const childPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (defaultScanOptions.excludedDirNames.has(entry.name)) continue
        await walk(childPath, depth + 1)
        continue
      }
      if (entry.isSymbolicLink() || !entry.isFile()) continue
      try {
        const stat = await fs.stat(childPath)
        entries.push([entry.name, relativeToRoot(root, childPath), stat.size, Math.round(stat.mtimeMs)])
      } catch { continue }
    }
  }
  await walk(root, 0)
  return { root, builtAt: new Date().toISOString(), entries: entries.sort((a, b) => a[1].localeCompare(b[1])), truncated }
}

export type IndexDelta = { added: string[]; changed: string[]; removed: string[] }
export function diffFileIndex(previous: FileIndex | null, current: FileIndex): IndexDelta {
  const previousEntries = previous && previous.root === current.root ? previous.entries : []
  const previousMap = new Map(previousEntries.map((entry) => [entry[1], entry]))
  const currentMap = new Map(current.entries.map((entry) => [entry[1], entry]))
  const added: string[] = []
  const changed: string[] = []
  for (const [relativePath, entry] of currentMap) {
    const old = previousMap.get(relativePath)
    if (!old) added.push(relativePath)
    else if (old[2] !== entry[2] || old[3] !== entry[3]) changed.push(relativePath)
  }
  const removed = [...previousMap.keys()].filter((relativePath) => !currentMap.has(relativePath))
  return { added, changed, removed }
}

export function searchFileIndex(index: FileIndex, request: FileSearchQuery): SearchHit[] {
  const hits: SearchHit[] = []
  for (const [name, relativePath, sizeBytes, mtimeMs] of index.entries) {
    const meta: SearchableFileMeta = { name, sizeBytes, mtimeMs }
    if (!matchesFileMeta(meta, request)) continue
    const score = scoreNameMatch(name, request)
    const extension = path.extname(name).toLowerCase()
    hits.push({
      name,
      path: path.join(index.root, relativePath.split('/').join(path.sep)),
      relativePath,
      extension,
      sizeBytes,
      modifiedAt: new Date(mtimeMs).toISOString(),
      kind: kindByExtension.get(extension) ?? 'other',
      score: score > 0 ? score : 1,
      matchType: 'name',
      snippets: [],
    })
  }
  if (request.sortBy === 'recent') hits.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
  else if (request.sortBy === 'size') hits.sort((a, b) => b.sizeBytes - a.sizeBytes)
  else hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return hits.slice(0, request.limit)
}

export function formatSearchSummary(result: ScanResult, request: FileSearchQuery): string {
  const lines: string[] = []
  lines.push(`Arama ifadesi: ${request.raw || '(ya da boş)'}`)
  lines.push(`Kapsam kökü: ${result.root}`)
  lines.push(`Taranan: ${result.visitedFiles.toLocaleString('tr-TR')} dosya / ${result.visitedDirs.toLocaleString('tr-TR')} klasör · ${result.durationMs} ms`)
  if (result.hits.length >= request.limit) lines.push('Sonuç limiti doldu; alt sonuçlar dışlandı.')
  else if (result.truncated) lines.push('Sınır aşıldı; tarama erken kesildi.')
  if (result.permissionDenied > 0) lines.push(`Erişilemeyen klasör: ${result.permissionDenied}`)
  if (result.errors > 0) lines.push(`Okunamayan dosya: ${result.errors}`)
  return lines.join('\n')
}
