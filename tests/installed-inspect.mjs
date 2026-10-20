import { chromium } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'

// Kurulu Ultron uygulamasını CANLI inceler: açılış durumu, arayüz bölümleri,
// yerel model bağlantısı, konsol hataları ve ekran görüntüsü raporu üretir.
const debugPort = process.env.INSPECT_DEBUG_PORT || '9333'

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
const report = {}
try {
  const page = browser.contexts()[0]?.pages()[0]
  if (!page) throw new Error('Ultron penceresi bulunamadı')

  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)))

  await page.waitForSelector('.app-shell', { timeout: 20_000 })
  await page.waitForTimeout(2_500)

  report.title = await page.title()
  report.url = page.url()

  report.ui = await page.evaluate(() => {
    const visible = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return 'yok'
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 ? 'görünür' : 'gizli'
    }
    const texts = [...document.querySelectorAll('button, .right-tabs button, nav button')]
      .map((b) => (b.textContent ?? '').trim())
      .filter((t) => t.length > 0 && t.length < 30)
    return {
      appShell: visible('.app-shell'),
      mainColumn: visible('.main-column'),
      chatInput: visible('.main-column textarea'),
      rightPanel: visible('.right-panel, aside'),
      headerText: (document.querySelector('header')?.textContent ?? '').trim().slice(0, 120),
      buttons: [...new Set(texts)].slice(0, 40),
      projectOpen: document.body.textContent?.includes('proje') ?? false,
      bodySnippet: (document.body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
    }
  })

  report.bridge = await page.evaluate(async () => {
    const api = window.kodAtolyesi
    if (!api) return { available: false }
    const keys = Object.keys(api).sort()
    const out = { available: true, keys }
    try { out.project = api.getProject() } catch (error) { out.projectError = String(error) }
    try { out.voice = api.getVoiceStatus ? await api.getVoiceStatus() : null } catch (error) { out.voiceError = String(error) }
    try { out.userMemory = api.getUserMemory ? (await api.getUserMemory()).entries?.length ?? 0 : null } catch (error) { out.memoryError = String(error) }
    return out
  })

  // Ollama yerel model durumu (arayüzde gösterilen durum metni)
  report.modelPanel = await page.evaluate(() => {
    const indicators = [...document.querySelectorAll('[class*="model"], [class*="status"], [class*="provider"]')]
      .map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter((text) => text.length > 0 && text.length < 200)
    return [...new Set(indicators)].slice(0, 12)
  })

  const screenshotDir = path.resolve('release')
  await fs.mkdir(screenshotDir, { recursive: true })
  const screenshotPath = path.join(screenshotDir, 'ultron-inceleme.png')
  await page.screenshot({ path: screenshotPath })

  report.consoleErrors = consoleErrors
  report.pageErrors = pageErrors
  report.screenshot = screenshotPath
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close().catch(() => undefined)
}
