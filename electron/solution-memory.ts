// Yerel çözüm hafızası: çözülmüş/başarısız sorun kayıtları; saf çekirdek.
// Kalıcılık main.ts tarafında createJsonStore ile 'solution-memory.json' dosyasında sürümlenir.
// Model ağırlıkları değiştirilmez; yerel bilgi birikimi sağlar. Birim testleri: tests/solution-memory.test.ts

export type SolutionRecord = {
  id: string
  createdAt: string
  problem: string
  errorMessage: string | null
  cause: string | null
  solution: string | null
  outcome: 'solved' | 'partial' | 'failed'
  verifiedBy: string | null
  undoNote: string | null
  sources: string[]
  environmentNote: string
}

export type SolutionMemoryFile = {
  version: number
  records: SolutionRecord[]
}

export const solutionMemoryLimits = {
  maxRecords: 200,
  maxProblemChars: 500,
  maxMessageChars: 400,
  maxFieldChars: 800,
  maxSources: 6,
}

function clamp(value: unknown, maxChars: number): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxChars)
}

export function sanitizeSolutionRecord(input: unknown, fallbackId?: string): SolutionRecord | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Record<string, unknown>
  const outcomeRaw = String(source.outcome ?? '').toLowerCase()
  const outcome: SolutionRecord['outcome'] = outcomeRaw === 'solved' ? 'solved' : outcomeRaw === 'failed' ? 'failed' : 'partial'
  const sources = (Array.isArray(source.sources) ? source.sources : [])
    .filter((item): item is string => typeof item === 'string')
    .filter((item) => /^https?:\/\/\S+$/iu.test(item.trim()))
    .map((item) => item.trim())
    .slice(0, solutionMemoryLimits.maxSources)
  const record: SolutionRecord = {
    id: clamp(source.id ?? fallbackId, 40) || `solutions-${String(source.createdAt ?? '').slice(0, 10)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    createdAt: clamp(source.createdAt, 30) || new Date().toISOString(),
    problem: clamp(source.problem, solutionMemoryLimits.maxProblemChars),
    errorMessage: clamp(source.errorMessage, solutionMemoryLimits.maxMessageChars) || null,
    cause: clamp(source.cause, solutionMemoryLimits.maxFieldChars) || null,
    solution: clamp(source.solution, solutionMemoryLimits.maxFieldChars) || null,
    outcome,
    verifiedBy: clamp(source.verifiedBy, solutionMemoryLimits.maxFieldChars) || null,
    undoNote: clamp(source.undoNote, 300) || null,
    sources,
    environmentNote: clamp(source.environmentNote, 200),
  }
  if (!record.problem) return null
  return record
}

export function limitSolutionRecords(records: SolutionRecord[]): SolutionRecord[] {
  return (records ?? []).slice(-solutionMemoryLimits.maxRecords)
}

function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}]+/giu, ' ')
    .split(' ')
    .filter((token) => token.length >= 3)
}

// Geçmiş çözüm yeterliliği: sorguyla gerçek ilişki (ortak iş anlamlı simgelere göre puan).
export function searchSolutionRecords(records: SolutionRecord[], request: string, limit = 4): Array<{ record: SolutionRecord; score: number }> {
  const queryTokens = new Set(tokenize(request))
  if (queryTokens.size === 0) return []
  const scored = (records ?? []).map((record) => {
    const corpus = [record.problem, record.errorMessage ?? '', record.cause ?? ''].join(' ')
    const corpusTokens = tokenize(corpus)
    if (!corpusTokens.length) return { record, score: 0 }
    const overlap = corpusTokens.reduce((total, token) => total + (queryTokens.has(token) ? 1 : 0), 0)
    const uniqueCorpusTokens = new Set(corpusTokens).size
    const coverage = overlap / uniqueCorpusTokens
    const outcomeBonus = record.outcome === 'solved' ? 0.25 : record.outcome === 'failed' ? 0.05 : 0.15
    const verifiedBonus = record.verifiedBy ? 0.15 : 0
    return { record, score: Number((coverage * 0.7 + outcomeBonus + verifiedBonus).toFixed(3)) }
  })
    .filter((item) => item.record.problem && item.score > 0.15)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
  return scored
}

// Modelin bağlamına sığar biçimde geçmiş çözüm önerisini metinleştirir; uygulanma sorumluluğu aractadır.
export function formatSolutionMemoryForModel(scored: Array<{ record: SolutionRecord; score: number }>): string | null {
  if (!scored.length) return null
  const lines = scored.map((item, index) => {
    const record = item.record
    const outcomeText = record.outcome === 'solved' ? 'doğrulanmış çözüm' : record.outcome === 'failed' ? 'BAŞARISIZ DENEME (tekrar deneme)' : 'kısmen işe yaramış'
    return [
      `${index + 1}) ${record.problem.slice(0, 160)} — [${outcomeText}, puan ${item.score}]`,
      `   Hata: ${record.errorMessage ? record.errorMessage.slice(0, 200) : 'kayıt yok'}`,
      `   Neden: ${record.cause ? record.cause.slice(0, 220) : 'belirsiz'}`,
      `   Çözüm: ${record.solution ? record.solution.slice(0, 260) : 'kayıt yok'}`,
      record.undoNote ? `   Geri alma: ${record.undoNote.slice(0, 160)}` : '',
      record.sources.length ? `   Kaynaklar: ${record.sources.join(' ')}` : '',
      `   Bu kaydı KÖRÜ KÖRÜNE UYULMAZ: sürüm/ortam uyumunu kontrol et, gerekirse doğrula.`,
    ].filter(Boolean).join('\n')
  })
  return `Yerel çözüm hafızasındaki yakınsak kayıtlar (otomatik plana eklenmez; ortam uyumu doğrulandıkça değerlendirilir):\n${lines.join('\n')}`
}

// Kayıt tamamlama aracı için JSON sense: eksik anahtar null kurallarıyla tip güvenli döner.
export function buildAutorecordPayload(input: { problem: string; errorMessage?: string | null; cause?: string | null; solution?: string | null; outcome?: string | null; verifiedBy?: string | null; undoNote?: string | null; sources?: unknown; environmentNote?: string | null }, id: string): SolutionRecord | null {
  return sanitizeSolutionRecord({
    id,
    createdAt: new Date().toISOString(),
    problem: input.problem,
    errorMessage: input.errorMessage ?? null,
    cause: input.cause ?? null,
    solution: input.solution ?? null,
    outcome: input.outcome ?? 'partial',
    verifiedBy: input.verifiedBy ?? null,
    undoNote: input.undoNote ?? null,
    sources: Array.isArray(input.sources) ? input.sources : [],
    environmentNote: input.environmentNote ?? '',
  }, id)
}
