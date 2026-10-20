// Ajan dosya düzenleme/okuma çekirdeği: toleranslı yama eşleştirme, satır aralıklı
// okuma ve dosya satır sonu stilini koruma. Saf fonksiyonlar — birim testlidir.

export type PatchStrategy = 'exact' | 'normalized' | 'trimmed'

export interface PatchRange {
  start: number
  end: number
}

export interface PatchMatchResult {
  strategy: PatchStrategy
  ranges: PatchRange[]
}

export interface PatchApplySuccess {
  ok: true
  content: string
  strategy: PatchStrategy
  replacements: number
}

export interface PatchApplyFailure {
  ok: false
  error: string
}

export type PatchApplyResult = PatchApplySuccess | PatchApplyFailure

interface NormalizedContent {
  text: string
  /** Normalize edilmiş metindeki karakterin orijinal içerikteki konumu. \r içermeyen metinde null. */
  map: number[] | null
  sourceLength: number
}

function normalizeContent(content: string): NormalizedContent {
  if (!content.includes('\r')) return { text: content, map: null, sourceLength: content.length }
  const chars: string[] = []
  const map: number[] = []
  for (let index = 0; index < content.length; index++) {
    if (content[index] === '\r') continue
    chars.push(content[index])
    map.push(index)
  }
  return { text: chars.join(''), map, sourceLength: content.length }
}

function mapToOriginal(normalized: NormalizedContent, index: number): number {
  if (!normalized.map) return index
  return index >= normalized.map.length ? normalized.sourceLength : normalized.map[index]
}

function collectRanges(content: string, needle: string): PatchRange[] {
  const ranges: PatchRange[] = []
  if (!needle.length) return ranges
  let from = 0
  while (from <= content.length - needle.length) {
    const index = content.indexOf(needle, from)
    if (index === -1) break
    ranges.push({ start: index, end: index + needle.length })
    from = index + needle.length
  }
  return ranges
}

interface LineSpan {
  start: number
  end: number
  trimmed: string
}

/** Normalize edilmiş (\n) metinde satır aralıklarını ve trimEnd edilmiş içeriklerini çıkarır. */
function lineSpans(normalizedText: string): LineSpan[] {
  const spans: LineSpan[] = []
  let start = 0
  while (start <= normalizedText.length) {
    const newline = normalizedText.indexOf('\n', start)
    const end = newline === -1 ? normalizedText.length : newline
    spans.push({ start, end, trimmed: normalizedText.slice(start, end).replace(/[ \t]+$/, '') })
    if (newline === -1) break
    start = newline + 1
  }
  return spans
}

/**
 * old_text için dosyada eşleşme arar. Sıra: birebir → satır sonu (CRLF/LF) toleranslı →
 * satır sonu boşluk (trailing whitespace) toleranslı. İlk başarılı stratejinin tüm
 * eşleşmeleri döner; hiçbiri yoksa boş liste.
 */
export function findPatchMatches(content: string, oldText: string): PatchMatchResult {
  const exact = collectRanges(content, oldText)
  if (exact.length) return { strategy: 'exact', ranges: exact }

  const normalized = normalizeContent(content)
  const normalizedOld = oldText.replace(/\r\n?/g, '\n')

  const normalizedRanges: PatchRange[] = []
  for (const range of collectRanges(normalized.text, normalizedOld)) {
    normalizedRanges.push({
      start: mapToOriginal(normalized, range.start),
      end: mapToOriginal(normalized, range.end - 1) + 1,
    })
  }
  if (normalizedRanges.length) return { strategy: 'normalized', ranges: normalizedRanges }

  // Satır sonu boşluk toleransı: old_text'in satırları trimEnd ile karşılaştırılır.
  const oldTrimmedSuffix = normalizedOld.endsWith('\n') ? normalizedOld.slice(0, -1) : normalizedOld
  const oldLines = oldTrimmedSuffix.split('\n').map((line) => line.replace(/[ \t]+$/, ''))
  if (!oldTrimmedSuffix.trim().length) return { strategy: 'trimmed', ranges: [] }
  const spans = lineSpans(normalized.text)
  const trimmedRanges: PatchRange[] = []
  for (let index = 0; index + oldLines.length <= spans.length; index++) {
    let matched = true
    for (let offset = 0; offset < oldLines.length; offset++) {
      if (spans[index + offset].trimmed !== oldLines[offset]) { matched = false; break }
    }
    if (!matched) continue
    trimmedRanges.push({
      start: mapToOriginal(normalized, spans[index].start),
      end: mapToOriginal(normalized, spans[index + oldLines.length - 1].end - 1) + 1,
    })
  }
  return { strategy: 'trimmed', ranges: trimmedRanges }
}

/** Dosyanın baskın satır sonu stilini döndürür (\r\n veya \n). */
export function dominantLineEnding(content: string): '\r\n' | '\n' {
  const crlf = (content.match(/\r\n/g) ?? []).length
  const lf = (content.match(/\n/g) ?? []).length - crlf
  return crlf > 0 && crlf >= lf ? '\r\n' : '\n'
}

/** Yeni metni dosyanın baskın satır sonu stiline uydurur. */
export function alignLineEndings(content: string, text: string): string {
  const target = dominantLineEnding(content)
  const unified = text.replace(/\r\n?/g, '\n')
  return target === '\r\n' ? unified.replace(/\n/g, '\r\n') : unified
}

/**
 * old_text → new_text yamasını uygular. replaceAll değilse eşleşme tek olmalıdır.
 * Yeni metin dosyanın satır sonu stiline uydurulur; başarısızlıkta açıklayıcı hata döner.
 */
export function applyPatchToContent(content: string, oldText: string, newText: string, replaceAll = false): PatchApplyResult {
  if (!oldText.length) return { ok: false, error: 'old_text boş olamaz; değiştirilecek metni read_file çıktısından birebir kopyalayın.' }
  const matches = findPatchMatches(content, oldText)
  if (!matches.ranges.length) {
    return { ok: false, error: 'old_text dosyada birebir veya satır sonu/boşluk toleransıyla bulunamadı. Metni read_file çıktısından aynen kopyalayın veya daha kısa ve tekil bir bölüm seçin.' }
  }
  if (!replaceAll && matches.ranges.length > 1) {
    return { ok: false, error: `Değiştirilecek metin dosyada ${matches.ranges.length} kez bulundu; tek ve kesin bir eşleşme gerekli. Tümünü değiştirmek için replace_all=true kullanın.` }
  }
  const chosen = replaceAll ? matches.ranges : matches.ranges.slice(0, 1)
  const replacement = alignLineEndings(content, newText)
  let result = content
  for (let index = chosen.length - 1; index >= 0; index--) {
    result = result.slice(0, chosen[index].start) + replacement + result.slice(chosen[index].end)
  }
  return { ok: true, content: result, strategy: matches.strategy, replacements: chosen.length }
}

export interface PagedContent {
  text: string
  totalLines: number
  startLine: number
  endLine: number
  truncated: boolean
}

/**
 * İçeriği 1 tabanlı satır aralığıyla sayfalar. offset verilmezse baştan başlar;
 * limit verilmezse 400 satır döner. Aralık dışı offset boş metin döndürür.
 */
export function paginateContent(content: string, offset?: number, limit?: number): PagedContent {
  const lines = content.split(/\r?\n/)
  const totalLines = lines.length
  const start = Math.max(1, Math.floor(offset ?? 1) || 1)
  const count = Math.max(1, Math.min(2_000, Math.floor(limit ?? 400) || 400))
  if (start > totalLines) return { text: '', totalLines, startLine: start, endLine: start, truncated: false }
  const sliced = lines.slice(start - 1, start - 1 + count)
  return {
    text: sliced.join('\n'),
    totalLines,
    startLine: start,
    endLine: start + sliced.length - 1,
    truncated: start - 1 + sliced.length < totalLines,
  }
}
