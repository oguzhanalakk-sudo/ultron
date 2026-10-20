import { randomUUID } from 'node:crypto'
import { redactProviderSecrets } from './provider-secrets.ts'

export type ProviderToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
export type OpenAiStreamResult = { content: string; toolCalls: ProviderToolCall[]; finishReason: string }
type FetchLike = typeof fetch

type ToolAccumulator = { id: string; name: string; arguments: string }

function safeString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function toOpenAiMessages(messages: Record<string, unknown>[]) {
  return messages.map((message) => {
    const role = safeString(message.role) || 'user'
    if (role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: safeString(message.tool_call_id ?? message.id),
        name: safeString(message.name),
        content: safeString(message.content),
      }
    }
    if (role === 'assistant') {
      const result: Record<string, unknown> = { role: 'assistant', content: safeString(message.content) }
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : []
      if (calls.length) {
        result.tool_calls = calls.map((call, index) => {
          const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : {}
          return {
            id: safeString(call.id) || `call_${index}`,
            type: 'function',
            function: {
              name: safeString(fn.name),
              arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
            },
          }
        })
      }
      return result
    }
    return { role, content: safeString(message.content) }
  })
}

export function extractSseEvents(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  const events: string[] = []
  for (const block of parts) {
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) events.push(line.slice(5).trimStart())
    }
  }
  return { events, rest }
}

function providerHttpError(status: number, body: string, apiKey: string | null) {
  const detail = redactProviderSecrets(body.slice(0, 500), [apiKey]).trim()
  if (status === 401 || status === 403) return new Error(`OpenAI uyumlu sağlayıcı kimlik doğrulaması başarısız (HTTP ${status}). API anahtarını ve sağlayıcı izinlerini kontrol edin.${detail ? ` ${detail}` : ''}`)
  if (status === 404) return new Error(`OpenAI uyumlu sağlayıcı uç noktası veya modeli bulunamadı (HTTP 404). Adresi ve model adını kontrol edin.${detail ? ` ${detail}` : ''}`)
  if (status === 429) return new Error(`OpenAI uyumlu sağlayıcı hız/kota sınırına ulaştı (HTTP 429). Kısa bir süre sonra tekrar deneyin.${detail ? ` ${detail}` : ''}`)
  return new Error(`OpenAI uyumlu sağlayıcı isteği başarısız (HTTP ${status}).${detail ? ` ${detail}` : ''}`)
}

function accumulateEvent(state: { content: string; toolCalls: Record<number, ToolAccumulator>; finishReason: string; done: boolean }, raw: string, onDelta?: (piece: string) => void) {
  if (!raw) return
  if (raw === '[DONE]') { state.done = true; return }
  let event: Record<string, unknown>
  try { event = JSON.parse(raw) as Record<string, unknown> } catch { return }
  if (event.error) {
    const error = event.error
    const message = error && typeof error === 'object' && 'message' in error ? safeString((error as Record<string, unknown>).message) : safeString(error)
    throw new Error(`OpenAI uyumlu sağlayıcı akış hatası: ${message.slice(0, 300)}`)
  }
  const choices = Array.isArray(event.choices) ? event.choices as Array<Record<string, unknown>> : []
  const choice = choices[0]
  if (!choice) return
  const delta = choice.delta && typeof choice.delta === 'object' ? choice.delta as Record<string, unknown> : {}
  const piece = safeString(delta.content)
  if (piece) { state.content += piece; onDelta?.(piece) }
  const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls as Array<Record<string, unknown>> : []
  for (const call of calls) {
    const index = Number.isInteger(call.index) ? Number(call.index) : Object.keys(state.toolCalls).length
    const existing = state.toolCalls[index] ?? { id: '', name: '', arguments: '' }
    if (typeof call.id === 'string' && call.id) existing.id = call.id
    const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : {}
    if (typeof fn.name === 'string' && fn.name) {
      if (!existing.name) existing.name = fn.name
      else if (!existing.name.endsWith(fn.name)) existing.name += fn.name
    }
    if (typeof fn.arguments === 'string') existing.arguments += fn.arguments
    else if (fn.arguments && typeof fn.arguments === 'object') existing.arguments += JSON.stringify(fn.arguments)
    state.toolCalls[index] = existing
  }
  const finish = safeString(choice.finish_reason)
  if (finish) state.finishReason = finish
}

function finalizeToolCalls(state: Record<number, ToolAccumulator>): ProviderToolCall[] {
  return Object.entries(state)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([index, call]) => ({
      id: call.id || `call_${index}_${randomUUID().slice(0, 8)}`,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments || '{}' },
    }))
    .filter((call) => Boolean(call.function.name))
}

export async function streamOpenAiCompletion(input: {
  baseUrl: string
  model: string
  apiKey: string | null
  messages: Record<string, unknown>[]
  tools: unknown[]
  signal: AbortSignal
  onDelta?: (piece: string) => void
  onProgress?: () => void
  fetchImpl?: FetchLike
  temperature?: number
  maxTokens?: number
}): Promise<OpenAiStreamResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const url = `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`
  const body: Record<string, unknown> = {
    model: input.model,
    messages: toOpenAiMessages(input.messages),
    stream: true,
    temperature: input.temperature ?? 0.2,
  }
  if (input.tools.length) { body.tools = input.tools; body.tool_choice = 'auto' }
  if (input.maxTokens) body.max_tokens = input.maxTokens

  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    signal: input.signal,
    redirect: 'error',
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    throw providerHttpError(response.status, raw, input.apiKey)
  }
  input.onProgress?.()
  if (!response.body) throw new Error('OpenAI uyumlu sağlayıcı akış gövdesi döndürmedi.')

  // Bazı uyumlu sunucular stream isteğini yok sayıp tek JSON döndürür.
  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    const payload = await response.json() as Record<string, unknown>
    input.onProgress?.()
    const choices = Array.isArray(payload.choices) ? payload.choices as Array<Record<string, unknown>> : []
    const message = choices[0]?.message && typeof choices[0].message === 'object' ? choices[0].message as Record<string, unknown> : {}
    const content = safeString(message.content)
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : []
    const toolCalls = rawCalls.map((call, index) => {
      const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : {}
      return {
        id: safeString(call.id) || `call_${index}`,
        type: 'function' as const,
        function: { name: safeString(fn.name), arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}) },
      }
    }).filter((call) => Boolean(call.function.name))
    if (!content.trim() && !toolCalls.length) throw new Error('OpenAI uyumlu sağlayıcı boş veya geçersiz bir yanıt döndürdü.')
    if (content) input.onDelta?.(content)
    return { content, toolCalls, finishReason: safeString(choices[0]?.finish_reason) || 'stop' }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const state = { content: '', toolCalls: {} as Record<number, ToolAccumulator>, finishReason: 'stop', done: false }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      input.onProgress?.()
      buffer += decoder.decode(value, { stream: true })
      const extracted = extractSseEvents(buffer)
      buffer = extracted.rest
      for (const event of extracted.events) {
        accumulateEvent(state, event, input.onDelta)
        if (state.done) break
      }
      if (state.done) break
    }
    if (!state.done && buffer.trim()) {
      for (const line of buffer.replace(/\r\n/g, '\n').split('\n')) {
        if (line.startsWith('data:')) accumulateEvent(state, line.slice(5).trimStart(), input.onDelta)
        if (state.done) break
      }
    }
  } finally {
    if (state.done) await reader.cancel().catch(() => undefined)
  }
  const toolCalls = finalizeToolCalls(state.toolCalls)
  if (!state.content.trim() && !toolCalls.length) {
    throw new Error(`OpenAI uyumlu sağlayıcı boş veya geçersiz bir yanıt döndürdü (finish_reason: ${state.finishReason}).`)
  }
  return { content: state.content, toolCalls, finishReason: state.finishReason }
}

export async function fetchOpenAiModels(input: {
  baseUrl: string
  apiKey: string | null
  signal?: AbortSignal
  fetchImpl?: FetchLike
}): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`
  const response = await fetchImpl(`${input.baseUrl.replace(/\/+$/, '')}/models`, { headers, signal: input.signal, redirect: 'error' })
  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    throw providerHttpError(response.status, raw, input.apiKey)
  }
  const payload = await response.json() as Record<string, unknown>
  const data = Array.isArray(payload.data) ? payload.data as Array<Record<string, unknown>> : []
  return [...new Set(data.map((entry) => safeString(entry.id)).filter(Boolean))].sort((left, right) => left.localeCompare(right))
}
