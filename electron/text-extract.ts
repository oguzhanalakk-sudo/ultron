// Ultron text-extract: arama motoru için dosya içeriğinden metin çıkarır.
// Destekler: düz metin + kod (txt/md/json/csv/xml/html/css/...), PDF (basit metin
// akışları; en iyi çaba), .docx ve .xlsx (zip-lite ile XML'den). Desteklenmeyen
// biçimler açıkça bildirilir. Saf işlevler; disk erişimi yok.
import { inflateRawSync, inflateSync } from 'node:zlib'
import { ZipError, findZipEntry, findZipEntryBySuffix, readZipEntries } from './zip-lite.ts'

export type ExtractionResult = {
  text: string
  method: 'plain' | 'pdf' | 'docx' | 'xlsx' | 'xml-embedded'
  /** true ise içerik metin benzeri görünmüyor (ikili) ve aramanın dışında bırakılır. */
  isBinary: boolean
  notice?: string
}

export const textExtractLimits = {
  maxVisibleChars: 256_000, // arama için metin boyutu tavanı
  pdfMaxStreams: 400,
  pdfMaxInflate: 2 * 1024 * 1024,
}

export function isTextLikeExtension(extension: string): boolean {
  return /\.(txt|md|markdown|json|csv|tsv|xml|html|htm|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|java|kt|kts|gradle|gradle\.kts|c|h|cpp|hpp|cs|go|rs|rb|php|sql|sh|bat|ps1|psm1|yaml|yml|toml|ini|cfg|conf|properties|env|log|gitignore|dockerfile|srt|vtt)$/i.test(extension.startsWith('.') ? extension : `.${extension}`)
}

export function classifyExtension(fileNameOrExtension: string): 'text' | 'pdf' | 'docx' | 'xlsx' | 'doc' | 'xls' | 'binary' {
  // Girdi '.pdf' gibi uzantı ya da 'rapor.eski.doc' gibi tam dosya adı olabilir.
  const base = fileNameOrExtension.replace(/\\/g, '/').split('/').pop() ?? fileNameOrExtension
  const dotIndex = base.lastIndexOf('.')
  const candidate = dotIndex === -1 ? '' : base.slice(dotIndex).toLowerCase()
  if (isTextLikeExtension(candidate)) return 'text'
  if (candidate === '.pdf') return 'pdf'
  if (candidate === '.docx') return 'docx'
  if (candidate === '.xlsx') return 'xlsx'
  if (candidate === '.doc') return 'doc'
  if (candidate === '.xls') return 'xls'
  return 'binary'
}

function decodeMaybeUtf8(bytes: Buffer): string {
  const utf8 = bytes.toString('utf8')
  // U+FFFD oranı yüksekse latin1'e geri düş (ANSI metinler).
  const replacement = (utf8.match(/\uFFFD/g) ?? []).length
  if (replacement > 0 && replacement * 20 > utf8.length) return bytes.toString('latin1')
  return utf8
}

// Basit, en iyi çaba PDF metin çıkarıcı: FlateDecode/Store akışlarındaki
// BT...ET metin operatörlerini (Tj/TJ) toplayan hafif ayrıştırıcı.
// Tablo/çoklu-sütun düzeni, şifreli PDFs, Type3/CID dijitalleştirilmiş fontları
// mükemmel çözmez; bu durumda notice döner ve sonuç "kısmi" işaretlenir.
export function extractPdfText(buffer: Buffer): ExtractionResult {
  const latinBuffer = buffer.subarray(0, Math.min(buffer.length, 2 * 1024 * 1024)).toString('latin1')
  const streams: string[] = []
  const rawPattern = /stream\r?\n?([\s\S]*?)endstream/g
  let matchedStreams = 0
  let match: RegExpExecArray | null
  while ((match = rawPattern.exec(latinBuffer)) !== null) {
    matchedStreams++
    if (matchedStreams > textExtractLimits.pdfMaxStreams) { break }
    const rawStream = match[1]
    let decompressed: string | null = null
    try {
      const inflated = inflateRawSync(Buffer.from(rawStream, 'latin1'), { maxOutputLength: textExtractLimits.pdfMaxInflate })
      decompressed = inflated.toString('latin1')
    } catch {
      try {
        const wrapped = inflateSync(Buffer.from(rawStream, 'latin1'), { maxOutputLength: textExtractLimits.pdfMaxInflate })
        decompressed = wrapped.toString('latin1')
      } catch { decompressed = null }
    }
    if (decompressed && /\bBT\b/.test(decompressed)) streams.push(decompressed)
  }
  if (!streams.length) {
    // Başlıktan şifre/koruma kontrolü yap ve dürüst bir uyarı ver.
    const notice = /\/Encrypt\b/.test(latinBuffer)
      ? 'PDF şifreli/korumalı; metin çıkarılamadı.'
      : 'PDF metin katmanı bulunamadı (taranmış görüntü olabilir); içerik araması yapılmadı.'
    return { text: '', method: 'pdf', isBinary: true, notice }
  }
  const parts: string[] = []
  for (const stream of streams) {
    // Tj ve TJ öğelerinden metinleri topla; kaçış dizilerini nazikçe çöz.
    const textOps = stream.match(/\((?:[^()\\]|\\[\s\S])*\)/g) ?? []
    for (const op of textOps) {
      const inner = op
        .replace(/^E?\(/, '')
        .replace(/\)$/, '')
        .replace(/\\(\d{1,3})\b/g, (_unused, code: string) => String.fromCharCode(parseInt(code, 8)))
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\b|\\f|\\v/g, ' ')
      parts.push(inner)
    }
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, textExtractLimits.maxVisibleChars)
  const partial = matchedStreams > textExtractLimits.pdfMaxStreams
  return {
    text,
    method: 'pdf',
    isBinary: text.length === 0,
    notice: text.length === 0
      ? 'PDF metin operatörü çözülemedi; dosya başlığı ve adı araması kullanılabilir.'
      : partial
        ? 'PDF kısmi çözümlendi (basit metin katmanı; tablo/kolon düzeni korunmaz).'
        : undefined,
  }
}

export function extractDocxText(buffer: Buffer): ExtractionResult {
  try {
    const entries = readZipEntries(buffer, { maxEntries: 300, maxTotalUncompressed: 24 * 1024 * 1024, maxEntryUncompressed: 12 * 1024 * 1024 })
    const main = findZipEntry(entries, 'word/document.xml') ?? findZipEntryBySuffix(entries, 'word/document.xml')
    if (!main) return { text: '', method: 'docx', isBinary: true, notice: 'DOCX açıldı ama word/document.xml bulunamadı.' }
    const xml = main.content.toString('utf8')
    // Paragraf sınırlarını koru; satırlar yarı boşlukla ayrılır.
    const withBreaks = xml
      .replace(/<w:p\b[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\b[^>]*\/>/g, ' ')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<w:tc\b[^>]*>/g, ' ')
    const paragraphs = withBreaks
      .split('\n')
      .map((paragraph) => paragraph
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
      .map((paragraph) => paragraph.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
    const text = paragraphs.join('\n').slice(0, textExtractLimits.maxVisibleChars)
    return { text, method: 'docx', isBinary: text.length === 0, notice: text.length === 0 ? 'DOCX boş veya yalnızca biçim içeriyor.' : undefined }
  } catch (error) {
    return { text: '', method: 'docx', isBinary: true, notice: `DOCX okunamadı: ${error instanceof ZipError ? error.message : 'geçersiz arşiv'}.` }
  }
}

export function extractXlsxText(buffer: Buffer): ExtractionResult {
  try {
    const entries = readZipEntries(buffer, { maxEntries: 400, maxTotalUncompressed: 30 * 1024 * 1024, maxEntryUncompressed: 12 * 1024 * 1024 })
    const shared = findZipEntry(entries, 'xl/sharedStrings.xml')
      ?? findZipEntryBySuffix(entries, 'xl/sharedStrings.xml')
    const sharedStrings: string[] = []
    if (shared) {
      const text = shared.content.toString('utf8')
      // <t> öğelerini satır sınırlarıyla yakala
      const matches = text.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? []
      for (const item of matches) {
        sharedStrings.push(item
          .replace(/^<t(?:\s[^>]*)?>/, '')
          .replace(/<\/t>$/, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .trim())
      }
    }
    // Hücre sayıları ve formüller sheet xml'lerinden satır satır toplanır.
    const cellTexts: string[] = []
    const sheetEntries = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.path)).slice(0, 6)
    for (const sheet of sheetEntries) {
      const xml = sheet.content.toString('utf8')
      const cells = xml.match(/<c\b[^>]*>([\s\S]*?)<\/c>/g) ?? []
      for (const cell of cells) {
        const typeMatch = /t="([^"]*)"/.exec(cell)
        const inlineMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(cell)
        const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(cell)
        const type = typeMatch?.[1]
        if (type === 'inlineStr' && inlineMatch) cellTexts.push(inlineMatch[1])
        else if (valueMatch) {
          const rawValue = valueMatch[1].trim()
          if (type === 's') {
            const index = Number.parseInt(rawValue, 10)
            if (Number.isInteger(index) && index >= 0 && index < sharedStrings.length) cellTexts.push(sharedStrings[index])
            else cellTexts.push(`[paylaşılan metin #${index}]`)
          } else cellTexts.push(rawValue)
        }
      }
    }
    if (!cellTexts.length && !sharedStrings.length) {
      return { text: '', method: 'xlsx', isBinary: true, notice: 'XLSX açıldı ama okunabilir hücre verisi bulunmadı.' }
    }
    const lines: string[] = sharedStrings.slice(0, 4000)
    for (const cell of cellTexts.slice(0, 12_000)) {
      const value = cell.trim()
      if (value) lines.push(value)
    }
    const text = lines.join('\n').slice(0, textExtractLimits.maxVisibleChars)
    return { text, method: 'xlsx', isBinary: text.length === 0, notice: text.length === 0 ? 'XLSX hücreleri boş.' : undefined }
  } catch (error) {
    return { text: '', method: 'xlsx', isBinary: true, notice: `XLSX okunamadı: ${error instanceof ZipError ? error.message : 'geçersiz arşiv'}.` }
  }
}

export function extractText(buffer: Buffer, fileNameOrExtension: string): ExtractionResult {
  const kind = classifyExtension(fileNameOrExtension)
  switch (kind) {
    case 'text': {
      // UTF-8 BOM varsa at; NUL baytı görülürse ikili say.
      const start = buffer.subarray(0, 3)
      const trimmed = start[0] === 0xEF && start[1] === 0xBB && start[2] === 0xBF ? buffer.subarray(3) : buffer
      const hasNull = trimmed.subarray(0, Math.min(trimmed.length, 4096)).includes(0)
      if (hasNull) return { text: '', method: 'plain', isBinary: true, notice: 'Metin görünümünde değil ikili içerik; arama dışı bırakıldı.' }
      return { text: decodeMaybeUtf8(trimmed).slice(0, textExtractLimits.maxVisibleChars), method: 'plain', isBinary: false }
    }
    case 'pdf': return extractPdfText(buffer)
    case 'docx': return extractDocxText(buffer)
    case 'xlsx': return extractXlsxText(buffer)
    case 'doc': return { text: '', method: 'plain', isBinary: true, notice: '.doc (eski Word) bu sürümde okunamıyor; .docx ile arama yapılabilir.' }
    case 'xls': return { text: '', method: 'plain', isBinary: true, notice: '.xls (eski Excel) bu sürümde okunamıyor; .xlsx ile arama yapılabilir.' }
    default: return { text: '', method: 'plain', isBinary: true, notice: 'Ikili/bilinmeyen biçim; metin arama desteklenmiyor.' }
  }
}

// Arama metni desen kullanımına uygun kısaltma (bağlama cümleleri).
export function buildTextSnippets(text: string, query: string, contextChars = 90, maxSnippets = 5): string[] {
  if (!text || !query) return []
  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()
  const snippets: string[] = []
  let searchFrom = 0
  while (snippets.length < maxSnippets) {
    const found = haystack.indexOf(needle, searchFrom)
    if (found < 0) break
    const start = Math.max(0, found - contextChars)
    const end = Math.min(text.length, found + needle.length + contextChars)
    snippets.push(text.slice(start, end).replace(/\s+/g, ' ').trim())
    searchFrom = found + needle.length
  }
  return snippets
}
