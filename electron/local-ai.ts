// Ultron yerel AI çekirdeği: model kataloğu, donanım uyumu, güvenli yerel işlemler.
// Bu modül ağ erişimi yapmaz; yalnızca ana sürecin topladığı yerel verileri yorumlar.
import type { LocalHardware, LocalModelFit, LocalModelInfo, LocalRecommendation, LoadedLocalModel } from './shared'

const GIGABYTE = 1024 ** 3

export function isValidLocalModelReference(value: string) {
  const model = value.trim()
  if (!model || model.length > 120) return false
  if (model.startsWith('/') || model.startsWith('.') || model.includes('..')) return false
  if (/[\s\r\n\u0000]/.test(model)) return false
  return /^[A-Za-z0-9][A-Za-z0-9._:\/-]*$/.test(model)
}

function toNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function toText(value: unknown, max = 120) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= max ? text : text ? text.slice(0, max) : null
}

export function parseOllamaTags(value: unknown): LocalModelInfo[] {
  const models = (value as { models?: unknown[] } | null | undefined)?.models
  if (!Array.isArray(models)) return []
  const parsed: LocalModelInfo[] = []
  for (const entry of models) {
    const record = entry as Record<string, unknown>
    const name = toText(record?.name ?? record?.model)
    if (!name) continue
    const details = (record?.details ?? {}) as Record<string, unknown>
    parsed.push({
      name,
      sizeBytes: toNumber(record?.size) ?? 0,
      digest: toText(record?.digest, 96),
      modifiedAt: toText(record?.modified_at, 64),
      family: toText(details?.family, 40),
      parameterSize: toText(details?.parameter_size, 40),
      quantization: toText(details?.quantization_level, 40),
    })
  }
  return parsed.sort((left, right) => left.name.localeCompare(right.name, 'tr'))
}

export function parseOllamaPs(value: unknown): LoadedLocalModel[] {
  const models = (value as { models?: unknown[] } | null | undefined)?.models
  if (!Array.isArray(models)) return []
  const parsed: LoadedLocalModel[] = []
  for (const entry of models) {
    const record = entry as Record<string, unknown>
    const name = toText(record?.name ?? record?.model)
    if (!name) continue
    parsed.push({ name, sizeBytes: toNumber(record?.size) ?? 0, sizeVramBytes: toNumber(record?.size_vram) ?? 0, expiresAt: toText(record?.expires_at, 64) })
  }
  return parsed
}

export function formatByteSize(bytes: number | null | undefined) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return 'bilinmiyor'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < GIGABYTE) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  return `${(bytes / GIGABYTE).toFixed(1)} GB`
}

// Modelin gerçek boyutunu temel alan muhafazakâr bellek tahmini.
// Ağırlıklar, bağlam önbelleği ve çalışma alanı için %15 pay eklenir.
export function estimateModelFit(model: Pick<LocalModelInfo, 'sizeBytes' | 'parameterSize'>, hardware: Pick<LocalHardware, 'gpuMemoryBytes' | 'memoryTotalBytes' | 'memoryFreeBytes'>): LocalModelFit {
  const size = model.sizeBytes > 0 ? model.sizeBytes : 0
  if (!size) return { level: 'unknown', label: 'Boyut bilinmiyor', detail: 'Model dosya boyutu okunamadı; uyum tahmini yapılamıyor.', requiredBytes: 0 }
  const requiredBytes = Math.round(size * 1.15)
  const gpu = hardware.gpuMemoryBytes ?? 0
  if (gpu > 0 && gpu >= requiredBytes * 1.05) {
    return { level: 'gpu', label: 'GPU üzerinde çalışır', detail: `Yaklaşık ${formatByteSize(requiredBytes)} GPU belleği gerekir; ${formatByteSize(gpu)} VRAM yeterli.`, requiredBytes }
  }
  if (gpu > 0 && gpu >= requiredBytes * 0.55) {
    const gpuShare = Math.round((gpu / requiredBytes) * 100)
    return { level: 'partial', label: 'Kısmen GPU, kısmen CPU', detail: `Tahmini %${gpuShare} katman GPU'da, kalanı CPU'da çalışır; hız GPU'ya göre daha düşük olur.`, requiredBytes }
  }
  if (hardware.memoryFreeBytes >= requiredBytes * 1.1) {
    return { level: 'cpu', label: 'CPU üzerinde çalışır', detail: `Yaklaşık ${formatByteSize(requiredBytes)} RAM gerekir; boş bellek yeterli, ancak kod üretimi GPU'ya göre yavaş olur.`, requiredBytes }
  }
  if (hardware.memoryTotalBytes >= requiredBytes) {
    return { level: 'cpu', label: 'CPU üzerinde sınırda çalışır', detail: `Yaklaşık ${formatByteSize(requiredBytes)} RAM gerekir; boş bellek sınırda olduğundan başka uygulamaları kapatın.`, requiredBytes }
  }
  return { level: 'too-large', label: 'Bu donanım için çok büyük', detail: `Yaklaşık ${formatByteSize(requiredBytes)} bellek gerekir; ${formatByteSize(hardware.memoryTotalBytes)} toplam RAM yetersiz. Daha küçük bir sürüm seçin.`, requiredBytes }
}

export function recommendLocalModels(hardware: Pick<LocalHardware, 'gpuMemoryBytes' | 'memoryTotalBytes' | 'memoryFreeBytes'>): LocalRecommendation[] {
  const gpu = hardware.gpuMemoryBytes ?? 0
  const ram = hardware.memoryTotalBytes
  const recommendations: LocalRecommendation[] = []
  if (gpu >= 7 * GIGABYTE || ram >= 14 * GIGABYTE) {
    recommendations.push({ name: 'qwen2.5-coder:7b', reason: 'Kod üretiminde güçlü, 7B sınıfı yerel kodlama modeli.', sizeHint: '~4.7 GB indirme' })
    recommendations.push({ name: 'qwen3:8b', reason: 'Genel akıl yürütme ve Türkçe görevlerde dengeli 8B model.', sizeHint: '~5.2 GB indirme' })
  }
  if (gpu >= 4.5 * GIGABYTE || ram >= 10 * GIGABYTE) {
    recommendations.push({ name: 'qwen2.5-coder:7b-instruct-q4_K_M', reason: '4 bit sürüm; 6 GB VRAM ile GPU üzerinde çalışabilir.', sizeHint: '~4.4 GB indirme' })
    recommendations.push({ name: 'llama3.2:3b', reason: 'Daha az bellekle hızlı yanıt veren küçük genel model.', sizeHint: '~2.0 GB indirme' })
  }
  if (gpu >= 2.5 * GIGABYTE || ram >= 7.5 * GIGABYTE) {
    recommendations.push({ name: 'qwen2.5-coder:3b', reason: 'Düşük VRAM ve RAM için kod odaklı küçük model.', sizeHint: '~1.9 GB indirme' })
  }
  if (!recommendations.length) {
    recommendations.push({ name: 'qwen2.5-coder:1.5b', reason: 'Sınırlı donanımda çalışabilecek en küçük kod odaklı sürüm.', sizeHint: '~1.0 GB indirme' })
    recommendations.push({ name: 'llama3.2:1b', reason: 'Çok düşük bellekle çalışan küçük genel model.', sizeHint: '~1.3 GB indirme' })
  }
  return recommendations
}

export function summarizeHardware(hardware: LocalHardware) {
  const gpu = hardware.gpu ? `${hardware.gpu}${hardware.gpuMemoryBytes ? ` (${formatByteSize(hardware.gpuMemoryBytes)} VRAM)` : ''}` : 'Ayrık GPU bulunamadı'
  return [
    `İşletim sistemi: ${hardware.os} (${hardware.architecture})`,
    `İşlemci: ${hardware.cpu} · ${hardware.cpuCores} mantıksal çekirdek`,
    `Bellek: ${formatByteSize(hardware.memoryTotalBytes)} toplam, ${formatByteSize(hardware.memoryFreeBytes)} boş`,
    `Ekran kartı: ${gpu}`,
    `Disk: ${formatByteSize(hardware.diskFreeBytes)} boş${hardware.diskTotalBytes ? ` / ${formatByteSize(hardware.diskTotalBytes)}` : ''}`,
  ].join('\n')
}

const mathPattern = /^[\d+\-*/%^().\s]+$/

// Basit dört işlem, yüzde ve kuvvet ifadelerini güvenli özyinelemeli çözümleyiciyle hesaplar.
// eval/Function kullanılmaz; yalnızca sayı ve operatör kabul edilir.
export function evaluateMathExpression(expression: string): { ok: true; value: number; formatted: string } | { ok: false; error: string } {
  const source = expression.trim()
  if (!source || source.length > 200) return { ok: false, error: 'İfade boş veya 200 karakterden uzun.' }
  if (!mathPattern.test(source)) return { ok: false, error: 'Yalnızca sayı ve + - * / % ^ ( ) işleçleri kullanılabilir.' }
  let index = 0
  const skip = () => { while (index < source.length && source[index] === ' ') index++ }
  const peek = () => { skip(); return source[index] }
  const parseExpression = (): number => {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const operator = source[index]; index++
      const right = parseTerm()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }
  const parseTerm = (): number => {
    let value = parsePower()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const operator = source[index]; index++
      const right = parsePower()
      if ((operator === '/' || operator === '%') && right === 0) throw new Error('Sıfıra bölme tanımsızdır.')
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right
    }
    return value
  }
  const parsePower = (): number => {
    const base = parseUnary()
    if (peek() === '^') { index++; return base ** parsePower() }
    return base
  }
  const parseUnary = (): number => {
    const token = peek()
    if (token === '-') { index++; return -parseUnary() }
    if (token === '+') { index++; return parseUnary() }
    return parsePrimary()
  }
  const parsePrimary = (): number => {
    if (peek() === '(') {
      index++
      const value = parseExpression()
      if (peek() !== ')') throw new Error('Kapanmamış parantez var.')
      index++
      return value
    }
    const match = /^\d+(?:\.\d+)?/.exec(source.slice(index))
    if (!match) throw new Error('İfade beklenen yerde sayı içermiyor.')
    index += match[0].length
    return Number(match[0])
  }
  try {
    const value = parseExpression()
    skip()
    if (index !== source.length) return { ok: false, error: 'İfade beklenmeyen bir karakterle bitiyor.' }
    if (!Number.isFinite(value)) return { ok: false, error: 'Sonuç sonlu bir sayı değil.' }
    const formatted = Number.isInteger(value) ? String(value) : value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
    return { ok: true, value, formatted }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

export function formatJsonDocument(text: string): { ok: true; formatted: string; summary: string } | { ok: false; error: string } {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return { ok: false, error: 'JSON belgesi { veya [ ile başlamalı.' }
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch (error) { return { ok: false, error: `Geçersiz JSON: ${(error as Error).message}` } }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'JSON kökü nesne veya dizi olmalı.' }
  const summary = Array.isArray(parsed) ? `Dizi · ${parsed.length} öğe` : `Nesne · ${Object.keys(parsed as Record<string, unknown>).length} alan`
  return { ok: true, formatted: JSON.stringify(parsed, null, 2), summary }
}

const mathRequestPattern = /^(?:hesapla|calculate|compute|kaç\s*(?:yapar|eder)|sonuç)\s*[::]?\s*(.+)$/i
const pureMathPattern = /^[\d\s+\-*/%^().]+$/
const jsonRequestPattern = /^(?:json|json'u|jsonu|json belgesini)\s*(?:doğrula|düzenle|biçimlendir|formatla|kontrol et)\s*[::]?\s*(\{[\s\S]*\}|\[[\s\S]*\])$/i
const fileListPattern = /(?:dosyaları|dosyaları|dosya listesini|proje dosyalarını)\s*(?:listele|göster)|^list files$|^ls$/i
const systemStatusPattern = /(?:sistem durumu|donanım bilgisi|donanımı göster|yerel model durumu|hardware info|system status)/i
const timePattern = /^(?:saat kaç|tarih ne|bugün günlerden ne)\??$/i

export type LocalAnswerContext = { files?: string[]; hardware?: LocalHardware | null; selectedModel?: string; modelReady?: boolean }

export function answerLocally(request: string, context: LocalAnswerContext): { handled: boolean; title?: string; content?: string } {
  const text = request.trim()
  if (!text || text.length > 500) return { handled: false }
  const mathMatch = mathRequestPattern.exec(text)
  const candidate = mathMatch?.[1]?.trim() ?? (pureMathPattern.test(text) && /\d/.test(text) && /[+\-*/%^]/.test(text) ? text : null)
  if (candidate && candidate.length <= 200) {
    const result = evaluateMathExpression(candidate)
    if (result.ok) return { handled: true, title: 'Yerel hesaplama', content: `**${candidate} = ${result.formatted}**\n\nBu sonuç yerel hesaplayıcıyla üretildi; dil modeli çağrılmadı.` }
    if (mathMatch) return { handled: true, title: 'Yerel hesaplama', content: `İfade hesaplanamadı: ${result.error}` }
  }
  const jsonMatch = jsonRequestPattern.exec(text)
  if (jsonMatch?.[1]) {
    const result = formatJsonDocument(jsonMatch[1])
    return result.ok
      ? { handled: true, title: 'Yerel JSON doğrulama', content: `JSON geçerli (${result.summary}).\n\n\`\`\`json\n${result.formatted.slice(0, 4_000)}\n\`\`\`` }
      : { handled: true, title: 'Yerel JSON doğrulama', content: `JSON doğrulanamadı: ${result.error}` }
  }
  if (fileListPattern.test(text)) {
    const files = context.files ?? []
    return files.length
      ? { handled: true, title: 'Yerel dosya listesi', content: `Proje kökündeki ${files.length} kayıt:\n\n${files.slice(0, 80).map((item) => `- ${item}`).join('\n')}${files.length > 80 ? `\n\n… ve ${files.length - 80} kayıt daha.` : ''}` }
      : { handled: true, title: 'Yerel dosya listesi', content: 'Proje klasörü açılmadığı için listelenecek dosya yok.' }
  }
  if (systemStatusPattern.test(text)) {
    if (context.hardware) return { handled: true, title: 'Yerel sistem durumu', content: `**Donanım**\n\n${summarizeHardware(context.hardware)}\n\n**Seçili model:** ${context.selectedModel ?? 'bilinmiyor'}${context.modelReady === false ? ' (Ollama şu anda yanıt vermiyor)' : ''}` }
    return { handled: false }
  }
  if (timePattern.test(text)) {
    const now = new Date()
    return { handled: true, title: 'Yerel saat', content: `Yerel saat: **${now.toLocaleTimeString('tr-TR')}** · ${now.toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}` }
  }
  return { handled: false }
}

// Ollama NDJSON akışının son satırındaki gerçek ölçüm alanlarını okur.
export function parseOllamaMetrics(event: unknown) {
  const record = (event ?? {}) as Record<string, unknown>
  const evalCount = toNumber(record.eval_count)
  const evalDuration = toNumber(record.eval_duration)
  const promptCount = toNumber(record.prompt_eval_count)
  const totalDuration = toNumber(record.total_duration)
  return {
    evaluatedTokens: evalCount,
    promptTokens: promptCount,
    totalDurationMs: totalDuration ? Math.round(totalDuration / 1_000_000) : null,
    tokensPerSecond: evalCount && evalDuration ? Number((evalCount / (evalDuration / 1_000_000_000)).toFixed(2)) : null,
  }
}
