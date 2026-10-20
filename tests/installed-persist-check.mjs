import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

// Yeniden başlatılan kurulu Ultron'u doğrular: proje açık değilken sohbet geçmişi
// kullanıcı veri klasöründen geri yüklenmeli ve önceki oturumun mesajı arayüzde görünmeli.
const debugPort = process.env.INSTALLED_SMOKE_DEBUG_PORT || '9222'
const marker = process.env.INSTALLED_SMOKE_MARKER || ''

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
try {
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Yeniden başlatılan Ultron penceresi açılmalı')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.getWorkspace) && document.querySelector('.app-shell'), null, { timeout: 20_000 })

  assert.equal(await page.evaluate(() => window.kodAtolyesi.getProject()), null, 'Kalıcılık kontrolü proje açmadan çalışmalı')
  const workspace = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  assert.ok(Array.isArray(workspace.messages) && workspace.messages.length >= 2, `Yeniden başlatmada sohbet geçmişi kalıcı olmalı (${workspace.messages?.length ?? 0} mesaj)`)
  assert.ok(workspace.messages.some((message) => message.role === 'assistant' && message.content.trim().length > 5), 'Önceki oturumun asistan yanıtı geçmişte bulunmalı')
  if (marker) {
    assert.ok(workspace.messages.some((message) => message.role === 'user' && message.content.includes(marker)), 'Önceki oturumun işaretli mesajı geçmişte bulunmalı')
  }

  await page.waitForSelector('article.message.user', { timeout: 10_000 })
  const bubbles = await page.locator('article.message').count()
  assert.ok(bubbles >= 2, `Önceki oturum mesajları arayüzde görünmeli (${bubbles} balon)`)

  const screenshot = path.resolve('release', 'installed-persist.png')
  await fs.mkdir(path.dirname(screenshot), { recursive: true })
  await page.screenshot({ path: screenshot })
  console.log(`Sohbet geçmişi kalıcılık kontrolü geçti. Ekran görüntüsü: ${screenshot}`)
} finally {
  await browser.close().catch(() => undefined)
}
