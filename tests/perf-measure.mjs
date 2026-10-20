import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { conversationContextLimits, trimConversationContext } from '../electron/conversation.ts'

// Kurulu Ultron üzerinde gerçek performans ölçümleri: başlatma süresi, sohbet ilk
// parça/tam yanıt gecikmesi, yerel model metrikleri ve kontrollü bağlam kazancı.
// Sayılar uydurulmaz; yalnızca ölçülen değerler PERF-RESULT satırı olarak yazılır.
const debugPort = process.env.PERF_DEBUG_PORT || '9222'
const launchAt = Number(process.env.PERF_LAUNCH_AT || 0)
const results = { measuredAt: new Date().toISOString(), startupMs: null, connectToShellMs: null, chatFirstChunkMs: null, chatCompleteMs: null, model: {}, context: {} }

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
try {
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Perf ölçümü için Ultron penceresi açılmalı')
  const connectAt = Date.now()
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.getLocalAIStatus) && document.querySelector('.app-shell'), null, { timeout: 120_000 })
  const shellAt = Date.now()
  results.startupMs = launchAt ? shellAt - launchAt : null
  results.connectToShellMs = shellAt - connectAt

  await page.locator('textarea').fill('Merhaba! Tek cümleyle kendini tanıtır mısın?')
  const sendAt = Date.now()
  await page.locator('textarea').press('Enter')
  await page.waitForFunction(() => [...document.querySelectorAll('article.message.assistant .markdown-body')].some((body) => (body.textContent ?? '').trim().length > 0), null, { timeout: 300_000 })
  results.chatFirstChunkMs = Date.now() - sendAt
  await page.waitForFunction(() => !document.querySelector('textarea')?.disabled, null, { timeout: 300_000 })
  results.chatCompleteMs = Date.now() - sendAt

  const status = await page.evaluate(() => window.kodAtolyesi.getLocalAIStatus())
  if (status?.stats) {
    results.model = {
      selected: status.selectedModel,
      lastDurationMs: status.stats.lastDurationMs,
      lastTokensPerSecond: status.stats.lastTokensPerSecond,
      lastEvaluatedTokens: status.stats.lastEvaluatedTokens,
      requests: status.stats.requests,
    }
  }

  // Temsili uzun geçmiş: eski kural (son 20 mesaj) ile yeni kontrollü bağlam bütçesi karşılaştırması.
  const longHistory = Array.from({ length: 300 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Kayıt ${index}: ` + 'veri satırı '.repeat(360),
  }))
  const oldRulePayload = JSON.stringify(longHistory.slice(-20))
  const trimmed = trimConversationContext(longHistory)
  const newRulePayload = JSON.stringify(trimmed)
  results.context = {
    historyMessages: longHistory.length,
    oldRulePayloadBytes: Buffer.byteLength(oldRulePayload, 'utf8'),
    newRulePayloadBytes: Buffer.byteLength(newRulePayload, 'utf8'),
    keptMessages: trimmed.length,
    maxMessages: conversationContextLimits.maxMessages,
    maxChars: conversationContextLimits.maxChars,
  }
  console.log('PERF-RESULT ' + JSON.stringify(results))
} finally {
  await browser.close().catch(() => undefined)
}
