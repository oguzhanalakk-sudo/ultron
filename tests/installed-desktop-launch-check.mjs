import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'

const execFileAsync = promisify(execFile)
const debugPort = process.env.ULTRON_DESKTOP_TEST_PORT
if (!debugPort) throw new Error('ULTRON_DESKTOP_TEST_PORT tanımlı olmalı.')

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
try {
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Kurulu Ultron penceresi açılmalı')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.sendMessage), null, { timeout: 20_000 })
  const input = page.locator('.main-column textarea')

  async function ask(text, expected) {
    const before = await page.locator('article.message.assistant .markdown-body').count()
    await input.fill(text)
    await input.press('Enter')
    await page.waitForFunction((previous) => {
      const messages = [...document.querySelectorAll('article.message.assistant .markdown-body')]
      return messages.length > previous && Boolean(messages.at(-1)?.textContent?.trim())
    }, before, { timeout: 35_000 })
    const reply = await page.locator('article.message.assistant .markdown-body').last().textContent()
    assert.match(reply ?? '', expected, `Yanıt beklenen sonucu vermeli: ${reply}`)
    return reply ?? ''
  }

  await ask("Hesap Makinesi'ni aç", /Hesap Makinesi açıldı/i)
  await ask("Not Defteri'ni aç", /Not Defteri açıldı/i)
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', "@(Get-Process -Name Notepad -ErrorAction SilentlyContinue).Count"], { windowsHide: true })
  assert.ok(Number.parseInt(stdout.trim(), 10) >= 1, 'Not Defteri işlemi Windows üzerinde gerçekten çalışmalı')
  await ask('Bilinmeyen uygulamayı aç', /güvenli başlatma listesinde değil/i)
  console.log('Kurulu uygulama üzerinden gerçek masaüstü başlatma kontrolü geçti.')
} finally {
  await browser.close().catch(() => undefined)
}
