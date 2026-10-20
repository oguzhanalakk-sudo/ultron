// Ultron kalıcı sohbet geçmişi: proje açık değilken sohbet mesajları kullanıcı veri
// klasöründe saklanır. Bu modül ağ erişimi ve dosya erişimi yapmaz; yalnızca saf
// doğrulama/veri işlemleri içerir.
import type { ChatMessage } from './shared.ts'

export const chatHistoryLimits = { total: 200, textLength: 40_000 }

// Geçmiş dosyasından okunan veya yazılacak mesajları doğrular: yalnızca kullanıcı ve
// asistan rollerini, boş olmayan metinleri kabul eder; içerik ve toplam sayı sınırını uygular.
export function sanitizeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  const messages: ChatMessage[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as { role?: unknown; content?: unknown }
    if (record.role !== 'user' && record.role !== 'assistant') continue
    if (typeof record.content !== 'string') continue
    const content = record.content.replace(/\u0000/g, '').slice(0, chatHistoryLimits.textLength).trim()
    if (!content) continue
    messages.push({ role: record.role, content })
  }
  return messages.slice(-chatHistoryLimits.total)
}
