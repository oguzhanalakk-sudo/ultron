import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'

const port = process.env.ULTRON_LIVE_DEBUG_PORT
const prompt = process.env.ULTRON_LIVE_PROMPT
if (!port || !prompt) throw new Error('ULTRON_LIVE_DEBUG_PORT ve ULTRON_LIVE_PROMPT gerekli.')

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
try {
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Ultron penceresi bulunamadı.')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.sendMessage), null, { timeout: 20_000 })
  const project = await page.evaluate(() => window.kodAtolyesi.getProject())
  assert.ok(project?.path, 'Canlı ajan testi için bir proje klasörü açık olmalı.')
  console.log(`Proje: ${project.path}`)

  const input = page.locator('.main-column textarea')
  await input.fill(prompt)
  const previous = await page.locator('article.message.assistant .markdown-body').count()
  await input.press('Enter')
  await page.waitForFunction((count) => document.querySelectorAll('article.message.assistant .markdown-body').length > count, previous, { timeout: 300_000 })
  await page.waitForFunction(() => {
    const input = document.querySelector('.main-column textarea')
    return Boolean(input) && !input.disabled
  }, null, { timeout: 600_000 })

  const result = await page.evaluate(async () => ({
    reply: [...document.querySelectorAll('article.message.assistant .markdown-body')].at(-1)?.textContent?.trim() ?? '',
    tree: await window.kodAtolyesi.getTree(),
  }))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close().catch(() => undefined)
}
