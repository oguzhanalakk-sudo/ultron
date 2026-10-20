// Ultron zip-lite: bağımlılıksız, sınırlı, salt okunur ZIP okuyucu.
// Excel (.xlsx) / Word (.docx) metin çıkarma ve yerel eklenti paketi (.zip)
// kurulumu için kullanılır. zlib.deflateRawSync yeterlidir; SeekableStream/Şifreli
// kulvarlar açıkça reddedilir. Bellek sınırları katıdır (zip bomb koruması).
import { inflateRawSync, inflateSync } from 'node:zlib'

export class ZipError extends Error {
  readonly reason: 'format' | 'unsupported' | 'limit' | 'traversal' | 'empty'
  constructor(message: string, reason: 'format' | 'unsupported' | 'limit' | 'traversal' | 'empty') {
    super(message)
    this.name = 'ZipError'
    this.reason = reason
  }
}

export type ZipEntry = {
  /** ZIP içindeki tam yol (klasör girdileri hariç). Slayt yol normalizasyonu yapılmıştır. */
  path: string
  /** Sıkıştırılmamış boyut (bayt). */
  size: number
  /** Yeniden yapılandırılmış içerik. */
  content: Buffer
}

export type ZipLimits = {
  /** Okunabilecek en fazla girdi sayısı. */
  maxEntries: number
  /** Toplam açılmamış veri sınırı (bayt). */
  maxTotalUncompressed: number
  /** Tek bir girdi için en fazla açılmamış boyut (bayt). */
  maxEntryUncompressed: number
  /** ZIP toplam sıkıştırılmış boyut sınırı (bayt). */
  maxArchiveSize: number
}

export const defaultZipLimits: ZipLimits = {
  maxEntries: 400,
  maxTotalUncompressed: 60 * 1024 * 1024,
  maxEntryUncompressed: 16 * 1024 * 1024,
  maxArchiveSize: 80 * 1024 * 1024,
}

function readUInt16(buffer: Buffer, offset: number) { return buffer.readUInt16LE(offset) }
function readUInt32(buffer: Buffer, offset: number) { return buffer.readUInt32LE(offset) }

// Yol güvenliği: "..", mutlak yol, sürücü harfi red (zip-slip koruması). Arka slaş
// Windows rüzgârı olabilir → '/' ile normalize edilir.
export function safeZipPath(entryPath: string): string | null {
  const normalized = entryPath.replace(/\\/g, '/')
  if (!normalized || normalized.endsWith('/')) return null
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/') || normalized.includes('..')) return null
  const segments = normalized.split('/').filter((segment) => segment.length > 0 && segment !== '.')
  if (!segments.length) return null
  return segments.join('/')
}

export function readZipEntries(input: Buffer, limits: Partial<ZipLimits> = {}): ZipEntry[] {
  const config = { ...defaultZipLimits, ...limits }
  if (input.length < 22) throw new ZipError('ZIP verisi çok küçük.', 'format')
  if (input.length > config.maxArchiveSize) throw new ZipError(`ZIP arşivi sınırı aşıyor (${input.length} bayt).`, 'limit')
  // EOCD imzasını sondan ara (ön yorum olabilir).
  let eocdOffset = -1
  const scanStart = Math.max(0, input.length - 66_000)
  for (let offset = input.length - 22; offset >= scanStart; offset--) {
    if (readUInt32(input, offset) === 0x06054b50) { eocdOffset = offset; break }
  }
  if (eocdOffset < 0) throw new ZipError('Geçerli ZIP kapanış kaydı bulunamadı.', 'format')
  const entryCount = readUInt16(input, eocdOffset + 10)
  const cdSize = readUInt32(input, eocdOffset + 12)
  const cdOffset = readUInt32(input, eocdOffset + 16)
  if (entryCount === 0) throw new ZipError('ZIP arşivi boş.', 'empty')
  if (entryCount > config.maxEntries) throw new ZipError(`Girdi sayısı sınırı aşıyor (${entryCount}).`, 'limit')
  if (entryCount > 0 || cdSize > 0 || cdOffset > 0) {
    if (cdOffset + cdSize > input.length) throw new ZipError('ZIP merkez kataloğu dosya dışına taşıyor.', 'format')
  }
  if (readUInt16(input, eocdOffset + 4) !== 0 || readUInt16(input, eocdOffset + 6) !== 0 ||
    cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF || entryCount === 0xFFFF) {
    throw new ZipError('ZIP64 veya çok parçalı arşivler bu sürümde desteklenmiyor.', 'unsupported')
  }

  const totalSeen = new Set<string>()
  let totalUncompressed = 0
  const out: ZipEntry[] = []
  let cursor = cdOffset
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 4 > input.length) throw new ZipError('Merkez kataloğun sonu beklenmedik.', 'format')
    if (readUInt32(input, cursor) !== 0x02014b50) throw new ZipError('Merkez katalog girdisi geçersiz.', 'format')
    const flags = readUInt16(input, cursor + 8)
    const method = readUInt16(input, cursor + 10)
    const compressedSize = readUInt32(input, cursor + 20)
    const uncompressedSize = readUInt32(input, cursor + 24)
    const nameLength = readUInt16(input, cursor + 28)
    const extraLength = readUInt16(input, cursor + 30)
    const commentLength = readUInt16(input, cursor + 32)
    const localOffset = readUInt32(input, cursor + 42)
    if (nameLength > 1024 || extraLength > 2048 || commentLength > 2048) throw new ZipError('ZIP girdi alanı sınırı aşılıyor.', 'limit')
    const rawName = input.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength
    if ((flags & 0x1) !== 0) throw new ZipError('Şifreli ZIP girdisi desteklenmiyor.', 'unsupported')
    if ((flags & 0x2000) !== 0) throw new ZipError('Güçlendirilmiş sıkıştırma (Deflate64/BZip2) desteklenmiyor.', 'unsupported')
    const safePath = safeZipPath(rawName)
    if (!safePath) continue
    if (totalSeen.has(safePath)) continue
    if (compressedSize > input.length) throw new ZipError('Girdi sıkıştırılmış boyutu arşivden büyük.', 'format')
    totalSeen.add(safePath)
    if (method !== 0 && method !== 8) throw new ZipError(`Desteklenmeyen sıkıştırma yöntemi: ${method} (girdi: ${safePath}).`, 'unsupported')

    // Yerel başlıktan gerçek name+extra uzunluğu okunur; veri ordan başlar.
    if (localOffset + 30 > input.length || readUInt32(input, localOffset) !== 0x04034b50) throw new ZipError(`Yerel başlık geçersiz: ${safePath}.`, 'format')
    const localNameLength = readUInt16(input, localOffset + 26)
    const localExtraLength = readUInt16(input, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart + compressedSize > input.length) throw new ZipError(`Girdi verisi arşiv dışına taşıyor: ${safePath}.`, 'format')
    if (uncompressedSize > config.maxEntryUncompressed) throw new ZipError(`Girdi boyutu sınırı aşıyor: ${safePath}.`, 'limit')
    totalUncompressed += uncompressedSize
    if (totalUncompressed > config.maxTotalUncompressed) throw new ZipError('Toplam açılmamış boyut sınırı aşıldı.', 'limit')
    const compressed = input.subarray(dataStart, dataStart + compressedSize)
    let content: Buffer
    if (method === 0) content = Buffer.from(compressed)
    else {
      try { content = inflateRawSync(compressed, { maxOutputLength: config.maxEntryUncompressed }) }
      catch {
        // Nadir paketleyiciler zlib gömülü yazma kullanır; tek deneme geri düşüşü.
        try {
          content = inflateSync(compressed, { maxOutputLength: config.maxEntryUncompressed })
        } catch { throw new ZipError(`ZIP girdisi açılamadı: ${safePath}.`, 'format') }
      }
    }
    out.push({ path: safePath, size: uncompressedSize, content })
  }
  return out
}

export function findZipEntry(entries: ZipEntry[], pathExpression: string): ZipEntry | null {
  const lower = pathExpression.toLowerCase()
  return entries.find((entry) => entry.path.toLowerCase() === lower) ?? null
}

// Girdileri klasör bazlı eşleştirme (örn. xl/worksheets/sheet1.xml).
export function findZipEntryBySuffix(entries: ZipEntry[], suffix: string): ZipEntry | null {
  const lower = suffix.toLowerCase()
  return entries.find((entry) => entry.path.toLowerCase().endsWith(lower)) ?? null
}
