import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

// Kurulu Ultron uygulamasını proje açmadan doğrular: arayüz açılışı, doğal sohbet,
// "hatırla" komutu, Hafıza paneli ve ses aracı durumu. Gerçek yerel model gerekir.
const debugPort = process.env.INSTALLED_SMOKE_DEBUG_PORT || '9222'
const runId = `kurulum-${Date.now().toString(36)}`

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
try {
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Kurulu Ultron penceresi açılmalı')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.sendMessage), null, { timeout: 20_000 })
  await page.waitForFunction(() => document.querySelector('.app-shell'), null, { timeout: 20_000 })

  assert.equal(await page.evaluate(() => window.kodAtolyesi.getProject()), null, 'Kurulu uygulama kontrolü proje açmadan başlatılmalı')
  assert.equal(await page.getByText('Ultron', { exact: true }).first().isVisible(), true, 'Uygulama arayüzü görünmeli')

  // Sohbet girdisi ana sütunda; sağ paneldeki metin alanlarıyla karışmaması için daraltılmış seçici kullanılır.
  const chatInput = page.locator('.main-column textarea')
  await chatInput.fill('Merhaba Ultron, kısaca nasılsın?')
  await chatInput.press('Enter')
  await page.waitForFunction(() => {
    const bodies = [...document.querySelectorAll('article.message.assistant .markdown-body')]
    return bodies.some((body) => (body.textContent ?? '').trim().length > 5)
  }, null, { timeout: 240_000 })
  const reply = await page.evaluate(() => [...document.querySelectorAll('article.message.assistant .markdown-body')]
    .map((body) => body.textContent ?? '')
    .filter((text) => text.trim().length > 5)
    .at(-1) ?? '')
  assert.ok(reply.trim().length > 5, `Proje açmadan sohbet yanıtı alınmalı: ${reply.slice(0, 160)}`)
  assert.equal(/Bağlantı hatası|Sohbet yanıtı başarısız|Önce proje|proje klasörü açın/i.test(reply), false, `Sohbet gerçek model yanıtı olmalı: ${reply.slice(0, 200)}`)

  await chatInput.fill(`Şunu hatırla: kurulu uygulama hafıza kontrolü ${runId}.`)
  await chatInput.press('Enter')
  let memoryEntries = []
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    memoryEntries = (await page.evaluate(() => window.kodAtolyesi.getUserMemory())).entries
    if (memoryEntries.some((entry) => entry.text.includes(runId))) break
    await page.waitForTimeout(500)
  }
  const entries = memoryEntries.filter((entry) => entry.text.includes(runId))
  if (!entries.length) {
    const assistantTexts = await page.evaluate(() => [...document.querySelectorAll('article.message.assistant .markdown-body')].map((body) => (body.textContent ?? '').slice(0, 200)))
    console.log(JSON.stringify({ memoryEntries: memoryEntries.map((entry) => ({ kind: entry.kind, text: entry.text.slice(0, 120) })), assistantTexts }, null, 2))
  }
  assert.ok(entries.length > 0, 'Açık "hatırla" komutu kurulu uygulamada hafızaya yazılmalı')

  await page.locator('.right-tabs button', { hasText: 'Hafıza' }).click()
  await page.waitForSelector('.memory-panel', { timeout: 10_000 })
  assert.equal(await page.locator('.memory-panel').count(), 1, 'Hafıza paneli proje açmadan erişilebilmeli')
  await page.locator('.memory-panel').getByText(runId, { exact: false }).first().waitFor({ state: 'visible', timeout: 10_000 })
  assert.ok(await page.locator('.memory-panel').getByText(runId, { exact: false }).count() > 0, 'Hafıza kaydı panelde görünmeli')

  const screenshot = path.resolve('release', 'installed-smoke.png')
  await fs.mkdir(path.dirname(screenshot), { recursive: true })
  await page.screenshot({ path: screenshot })

  for (const entry of entries) await page.evaluate((id) => window.kodAtolyesi.deleteUserMemory(id), entry.id)
  const afterCleanup = await page.evaluate(() => window.kodAtolyesi.getUserMemory())
  assert.equal(afterCleanup.entries.some((entry) => entry.text.includes(runId)), false, 'Test hafıza kaydı temizlenebilmeli')

  const voice = await page.evaluate(() => window.kodAtolyesi.getVoiceStatus())
  assert.equal(typeof voice.available, 'boolean', 'Ses durumu raporlanmalı')
  assert.ok(Array.isArray(voice.speechToText) && Array.isArray(voice.textToSpeech), 'Ses araç denetimleri listelenmeli')
  assert.ok(voice.note.length > 10, 'Ses durumu açıklaması bulunmalı')

  // Yeniden başlatma kalıcılık işareti: bu mesaj uygulama kapanıp açıldıktan sonra
  // ikinci kontrol betiğinde sohbet geçmişinde aranır.
  const marker = process.env.INSTALLED_SMOKE_MARKER
  if (marker) {
    const before = await page.locator('article.message.assistant .markdown-body').count()
    await chatInput.fill(`Selam, kalıcılık işareti ${marker}.`)
    await chatInput.press('Enter')
    await page.waitForFunction((previous) => document.querySelectorAll('article.message.assistant .markdown-body').length > previous, before, { timeout: 240_000 })
    await page.waitForFunction(() => {
      const input = document.querySelector('.main-column textarea')
      return Boolean(input) && !input.disabled
    }, null, { timeout: 240_000 })
  }

  console.log(`Kurulu uygulama kontrolü geçti. Ekran görüntüsü: ${screenshot}`)
} finally {
  await browser.close().catch(() => undefined)
}
