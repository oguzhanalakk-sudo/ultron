export type AgentStage = 'analyzing' | 'planning' | 'awaiting_approval' | 'executing' | 'evaluating' | 'correcting' | 'testing' | 'finalizing' | 'paused' | 'interrupted' | 'blocked' | 'completed' | 'failed' | 'cancelled'
export type AgentErrorCategory = 'syntax' | 'build' | 'runtime' | 'dependency' | 'configuration' | 'permission' | 'filesystem' | 'network' | 'test' | 'resources' | 'unknown'
export type AgentErrorAnalysis = {
  category: AgentErrorCategory
  message: string
  stage: AgentStage
  tool?: string
  exitCode?: number
  retryable: boolean
  nextAction: string
}

export type AgentLimits = {
  maxDurationMs: number
  maxModelTurns: number
  maxToolCalls: number
  maxToolCallsPerTurn: number
  maxCorrectionAttempts: number
  maxToolArgumentsPerTurn: number
  maxToolOutputChars: number
  maxContextChars: number
}

export const DEFAULT_AGENT_LIMITS: Readonly<AgentLimits> = Object.freeze({
  maxDurationMs: 30 * 60 * 1000,
  // Yerel modeller aynı görevi küçük araç adımlarıyla çözebildiği için önceki
  // 24/48 bütçesi normal düzeltme akışlarını gereksiz biçimde kesebiliyordu.
  maxModelTurns: 96,
  maxToolCalls: 256,
  maxToolCallsPerTurn: 8,
  maxCorrectionAttempts: Number.MAX_SAFE_INTEGER,
  maxToolArgumentsPerTurn: 160_000,
  maxToolOutputChars: 12_000,
  // Yerel model bağlamı 16k token (yaklaşık 50-60k karakter). Araç şemaları ~6.8k token
  // ve sistem istemi ~2k token tuttuğu için sohbet zinciri ~24k karakterle sınırlanır;
  // aksi halde Ollama istemi sessizce kırpar ve boş/geçersiz yanıt üretir.
  maxContextChars: 24_000,
})

export class AgentLimitError extends Error {
  readonly limit: 'duration' | 'tool-calls' | 'tool-batch' | 'tool-arguments' | 'corrections'
  constructor(message: string, limit: 'duration' | 'tool-calls' | 'tool-batch' | 'tool-arguments' | 'corrections') {
    super(message)
    this.name = 'AgentLimitError'
    this.limit = limit
  }
}

export function analyzeAgentError(input: { message: string; stage: AgentStage; tool?: string; exitCode?: number }): AgentErrorAnalysis {
  const message = input.message.slice(0, 1_000)
  const text = `${input.tool ?? ''} ${message}`.toLocaleLowerCase('en-US')
  let category: AgentErrorCategory = 'unknown'
  let nextAction = 'İlgili kaynakları ve son araç çıktısını incele; nedeni doğrulamadan aynı işlemi tekrarlama.'
  if (/permission|access is denied|eacces|eperm|yetki|izin reddedildi|onaylanmadı|reddetti|işlem kullanıcı tarafından iptal edildi/.test(text)) {
    category = 'permission'; nextAction = 'Kullanıcı izninin kapsamını kontrol et; reddedilen işlemi otomatik tekrarlama.'
  } else if (/out of memory|heap|resource exhausted|no space left|kaynak yetersiz|bellek/.test(text)) {
    category = 'resources'; nextAction = 'İşlem boyutunu küçült veya kaynak tüketen süreçleri incele; sınırı aşan derlemeyi tekrarlama.'
  } else if (/timed? ?out|timeout|aborted|süre sınır/.test(text)) {
    category = 'resources'; nextAction = 'Süre sınırını ve çalışan süreci kontrol et; daha küçük bir adım deneyip gerekirse kullanıcıya bildir.'
  } else if (/cannot find module|module not found|module_not_found|modulenotfounderror|no module named|importerror|no matching distribution|could not resolve|dependency|package|paket bulunamadı|bağımlılık/.test(text)) {
    category = 'dependency'; nextAction = 'Manifest ve kurulu bağımlılıkları karşılaştır; paket kurmadan önce onay gereksinimini denetle.'
  } else if (/\benotfound\b|\beconn(?:refused|reset|aborted)?\b|fetch failed|network error|dns lookup|socket hang up|ağ bağlantısı|bağlantı hatası/.test(text)) {
    category = 'network'; nextAction = 'Ağ uç noktasını ve sağlayıcı bağlantısını doğrula; çevrimdışı alternatif varsa kullan.'
  } else if (/test failed|tests? failed|assertion|test başarısız|test hatası/.test(text)) {
    category = 'test'; nextAction = 'Başarısız testin beklenen ve gerçek değerlerini incele; düzeltmeden sonra ilgili testi yeniden çalıştır.'
  } else if (/syntaxerror|parse error|unexpected token|unterminated|indentationerror|sözdizimi/.test(text)) {
    category = 'syntax'; nextAction = 'Hata satırındaki sözdizimini ve yakındaki değişikliği incele; dar kapsamlı bir düzeltme yap.'
  } else if (/gradle|build failed|compilation failed|cannot find symbol|compiler|derleme/.test(text)) {
    category = 'build'; nextAction = 'Derleyici çıktısındaki ilk kök hatayı ve ilgili kaynak/yapılandırmayı incele; derlemeyi doğrulamadan başarılı sayma.'
  } else if (/enoent|not found|no such file|file system|dosya bulunamadı|yol bulunamadı/.test(text)) {
    category = 'filesystem'; nextAction = 'Seçili proje kapsamını ve güncel dosya ağacını yeniden kontrol et.'
  } else if (/config|configuration|invalid value|geçersiz yapılandırma/.test(text)) {
    category = 'configuration'; nextAction = 'Etkin yapılandırma dosyasını ve kullandığı araç sürümünü doğrula.'
  } else if (/exception|traceback|runtime|uncaught|nameerror|attributeerror|unboundlocal|çalışma zamanı/.test(text)) {
    category = 'runtime'; nextAction = 'Yığın izini ilgili fonksiyon ve son değişiklikle eşleştir; hata yolunu hedefleyen bir kontrol ekle.'
  }
  return { category, message, stage: input.stage, tool: input.tool, exitCode: input.exitCode, retryable: !['permission', 'resources'].includes(category), nextAction }
}

export class AgentOrchestrator {
  private toolCalls = 0
  private correctionAttempts = 0
  private failedToolCalls = 0
  private readonly repeatedFailures = new Map<string, number>()
  readonly limits: Readonly<AgentLimits>
  private readonly now: () => number
  private readonly startedAt: number
  constructor(limits: Readonly<AgentLimits> = DEFAULT_AGENT_LIMITS, now: () => number = Date.now, startedAt?: number) {
    this.limits = limits
    this.now = now
    this.startedAt = startedAt ?? now()
  }

  get snapshot() { return { toolCalls: this.toolCalls, correctionAttempts: this.correctionAttempts, maxToolCalls: this.limits.maxToolCalls, maxCorrectionAttempts: this.limits.maxCorrectionAttempts } }

  reserveToolBatch(count: number, argumentCharacters: number) {
    if (this.now() - this.startedAt >= this.limits.maxDurationMs) throw new AgentLimitError('Görev süre sınırını aştı.', 'duration')
    if (!Number.isInteger(count) || count < 0 || count > this.limits.maxToolCallsPerTurn) throw new AgentLimitError(`Bir model yanıtında en fazla ${this.limits.maxToolCallsPerTurn} araç çağrısı çalıştırılabilir.`, 'tool-batch')
    if (argumentCharacters > this.limits.maxToolArgumentsPerTurn) throw new AgentLimitError('Bir model yanıtının toplam araç parametresi boyut sınırını aştı.', 'tool-arguments')
    if (this.toolCalls + count > this.limits.maxToolCalls) throw new AgentLimitError(`Görev en fazla ${this.limits.maxToolCalls} araç çağrısıyla sınırlandırıldı.`, 'tool-calls')
    this.toolCalls += count
  }

  recordToolFailure(signature: string) {
    this.failedToolCalls += 1
    if (this.failedToolCalls > 1) this.correctionAttempts += 1
    const repeated = (this.repeatedFailures.get(signature) ?? 0) + 1
    this.repeatedFailures.set(signature, repeated)
    return {
      correctionAttempts: this.correctionAttempts,
      // Hata sayısı görev ilerleme bilgisidir; modeli birden fazla farklı hata
      // gördüğü için durdurmaz. Araç ve süre bütçeleri bağımsız olarak korunur.
      shouldBlock: false,
      reason: undefined,
    }
  }

  recordToolSuccess() { return this.snapshot }

  limitOutput(output: string) {
    if (output.length <= this.limits.maxToolOutputChars) return output
    const omitted = output.length - this.limits.maxToolOutputChars
    const marker = `\n… çıktı ${omitted} karakter kısaltıldı …`
    return `${output.slice(0, Math.max(0, this.limits.maxToolOutputChars - marker.length))}${marker}`
  }
}

// Yerel model bağlamını karakter sayısıyla değil, gerçek pencere ve araç şeması
// maliyetiyle bütçeler. Türkçe metin ve JSON şeması farklı token yoğunluğuna sahiptir;
// muhafazakâr oranlar Ollama'nın istemi sessizce kırpmasını önlemeyi amaçlar.
export function computeAgentContextBudget(input: {
  contextWindow: number
  toolSchemaCharacters: number
  reservedOutputTokens?: number
  minCharacters?: number
}) {
  const contextWindow = Math.max(4_096, Math.floor(input.contextWindow))
  const toolSchemaCharacters = Math.max(0, Math.floor(input.toolSchemaCharacters))
  const reservedOutputTokens = Math.max(512, Math.floor(input.reservedOutputTokens ?? 3_072))
  const minCharacters = Math.max(2_000, Math.floor(input.minCharacters ?? 6_000))
  const toolTokens = Math.ceil(toolSchemaCharacters / 3)
  const promptTokens = Math.max(1_024, contextWindow - reservedOutputTokens)
  const availableTokens = Math.max(1_024, promptTokens - toolTokens)
  const characters = Math.floor(availableTokens * 2)
  return Math.max(minCharacters, Math.min(DEFAULT_AGENT_LIMITS.maxContextChars, characters))
}

// Model üst üste araç çağrısı üretmezse görev tur sınırına kadar dönmemeli. Açık plan
// adımları veya tamamlanmamış doğrulama (başarısız/eskimiş kontrol, çalıştırılmamış
// kabul testi) varken boş turlar birikirse gerçek dosya/test işi korunarak görev
// mevcut kanıtlarla sonlandırılır.
export function shouldStopForIdleTurns(idleTurns: number, pendingSteps: number, maxIdleTurns = 3, hasIncompleteVerification = false) {
  return (pendingSteps > 0 || hasIncompleteVerification) && idleTurns >= Math.max(1, Math.floor(maxIdleTurns))
}

export function compactAgentContext(messages: Record<string, unknown>[], maxCharacters: number) {
  const size = (message: Record<string, unknown>) => JSON.stringify(message).length
  if (messages.reduce((total, message) => total + size(message), 0) <= maxCharacters) return messages
  const toolCallIndices = messages.reduce<number[]>((indices, message, position) => {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) indices.push(position)
    return indices
  }, [])
  const latestToolCall = toolCallIndices.at(-1) ?? -1
  const firstKeptToolCall = toolCallIndices.length > 4 ? toolCallIndices.at(-4)! : toolCallIndices[0] ?? -1
  const system = messages[0]
  const conversationEnd = firstKeptToolCall >= 0 ? toolCallIndices[0] : messages.length
  const priorConversation = messages.slice(1, conversationEnd).filter((message) => ['user', 'assistant'].includes(String(message.role)) && !Array.isArray(message.tool_calls)).slice(-4)
  const activeToolTurn = firstKeptToolCall >= 0 ? messages.slice(firstKeptToolCall) : []
  for (const callIndex of toolCallIndices.filter((index) => index < latestToolCall && index >= firstKeptToolCall)) {
    const end = toolCallIndices.find((index) => index > callIndex) ?? latestToolCall
    for (const message of messages.slice(callIndex + 1, end)) {
      if (message.role === 'tool' && typeof message.content === 'string' && message.content.length > 1_200) message.content = `${message.content.slice(0, 1_100)}\n… eski araç çıktısı kısaltıldı; gerekirse aracı yeniden çağır …`
    }
  }
  for (const callIndex of toolCallIndices.filter((index) => index < latestToolCall && index >= firstKeptToolCall)) {
    const calls = messages[callIndex].tool_calls as { function?: { arguments?: string } }[]
    for (const call of calls) if (call.function) call.function.arguments = '{}'
  }
  const assemble = () => [system, ...priorConversation, ...activeToolTurn].filter((message): message is Record<string, unknown> => Boolean(message))
  let compacted = assemble()
  while (priorConversation.length && compacted.reduce((total, message) => total + size(message), 0) > maxCharacters) {
    priorConversation.shift()
    compacted = assemble()
  }
  if (compacted.reduce((total, message) => total + size(message), 0) > maxCharacters) {
    for (const message of compacted) {
      if (message.role !== 'tool' || typeof message.content !== 'string') continue
      const current = compacted.reduce((total, item) => total + size(item), 0)
      if (current <= maxCharacters) break
      const excess = current - maxCharacters
      const marker = '\n… araç çıktısı bağlam sınırı nedeniyle kısaltıldı …'
      message.content = `${message.content.slice(0, Math.max(0, message.content.length - excess - marker.length))}${marker}`
    }
  }
  return compacted
}

