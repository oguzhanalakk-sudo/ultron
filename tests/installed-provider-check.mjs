import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

// Kurulu uygulamada sağlayıcı katmanının uçtan uca doğrulaması:
// 1) Arayüzde Ollama/OpenAI uyumlu geçişi ve API anahtarı alanı,
// 2) Ayarların IPC ile kaydı, /models keşfi,
// 3) Gerçek sohbet akışının yerel sahte OpenAI uyumlu sunucuya gitmesi,
// 4) Anahtarın settings.json'a yazılmaması, yalnızca provider-secrets.json'da olması.
// Dış ağa çıkılmaz; sahte sunucu yalnızca 127.0.0.1 üzerinde dinler.
const debugPort = process.env.PROVIDER_CHECK_DEBUG_PORT || String(9180 + Math.floor(Math.random() * 80))
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-provider-'))
const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-provider-project-'))
const installedPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ultron', 'Ultron.exe')
const mockKey = 'sk-mock-provider-only-1234567890'
const { spawn, exec } = await import('node:child_process')
const execAsync = (command) => new Promise((resolve) => exec(command, { windowsHide: true }, (error, stdout, stderr) => resolve({ error, stdout, stderr })))

const requests = []
const server = http.createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    requests.push({ method: request.method, url: request.url, hasAuthorization: Boolean(request.headers.authorization), bodyLength: body.length })
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
      return
    }
    if (request.url === '/v1/chat/completions') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"Merhaba"}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":" dünya"},"finish_reason":"stop"}]}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
      return
    }
    response.writeHead(404, { 'Content-Type': 'application/json' })
    response.end('{}')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const mockPort = server.address().port
const mockBaseUrl = `http://127.0.0.1:${mockPort}/v1`

const child = spawn(installedPath, [
  `--user-data-dir=${profilePath}`,
  `--remote-debugging-port=${debugPort}`,
  '--open-project', projectPath,
], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ULTRON_OPENAI_API_KEY: '' } })

const waitPort = async () => {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const net = await import('node:net')
      await new Promise((resolve, reject) => {
        const socket = net.createConnection(Number(debugPort), '127.0.0.1', () => { socket.end(); resolve() })
        socket.on('error', reject)
      })
      return
    } catch { await new Promise((resolve) => setTimeout(resolve, 500)) }
  }
  throw new Error('Kurulu uygulama CDP portu açılmadı')
}

let exitStatus = 0
try {
  await waitPort()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Kurulu Ultron penceresi açılmalı')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.getSettings), null, { timeout: 20_000 })
  await page.waitForSelector('.app-shell', { timeout: 30_000 })

  // 1) Arayüz: varsayılan Ollama modunda API anahtarı alanı görünmez.
  await page.locator('button[title="Ayarlar"]').click()
  await page.waitForSelector('.settings-modal')
  assert.match(await page.locator('.settings-modal h2').innerText(), /Model sağlayıcı ayarları/)
  assert.equal(await page.locator('.provider-switch button').count(), 2, 'İki sağlayıcı seçeneği olmalı')
  assert.equal(await page.locator('#api-key').count(), 0, 'Ollama modunda API anahtarı alanı görünmemeli')
  assert.match(await page.locator('.workspace-security-note').innerText(), /Tamamen yerel ve özel/)
  assert.equal(await page.locator('button', { hasText: 'Ollama · yerel' }).count(), 1)

  // 2) OpenAI uyumlu sağlayıcıya geçiş: HTTPS varsayılanı + parola alanı + güvenlik metni.
  await page.locator('.provider-switch button', { hasText: 'OpenAI uyumlu' }).click()
  await page.waitForSelector('#api-key')
  assert.equal(await page.locator('#api-key').getAttribute('type'), 'password', 'Anahtar alanı parola tipinde olmalı')
  assert.match(await page.locator('#base-url').inputValue(), /^https:\/\//, 'Bulut sağlayıcı varsayılanı HTTPS olmalı')
  assert.match(await page.locator('.workspace-security-note').innerText(), /Bulut\/uzak sağlayıcı/)

  // 3) Anahtarsız bulut isteği net hata vermeli; /models çağrısı yapılmamalı.
  const withoutKey = await page.evaluate(({ baseUrl }) => window.kodAtolyesi.saveSettings({
    provider: 'openai-compatible', baseUrl, model: 'mock-model',
    profile: { name: '', instructions: '', autoLearn: false }, clearApiKey: true,
  }), { baseUrl: mockBaseUrl })
  assert.equal(withoutKey.connected, false)
  assert.match(String(withoutKey.note ?? ''), /API anahtarı tanımlı değil/)
  assert.equal(requests.some((item) => item.url === '/v1/models'), false, 'Anahtarsızken modele istek atılmamalı')

  // 4) IPC ile yerel sahte sağlayıcıyı yapılandır ve /models keşfini doğrula.
  const saved = await page.evaluate(({ baseUrl, key }) => window.kodAtolyesi.saveSettings({
    provider: 'openai-compatible', baseUrl, model: 'mock-model',
    profile: { name: '', instructions: '', autoLearn: false }, apiKey: key,
  }), { baseUrl: mockBaseUrl, key: mockKey })
  assert.equal(saved.provider, 'openai-compatible')
  assert.equal(saved.connected, true, `Sağlayıcı bağlanmalı: ${saved.note ?? ''}`)
  assert.deepEqual(saved.models, ['mock-model'])
  const settings = await page.evaluate(() => window.kodAtolyesi.getSettings())
  assert.equal(settings.provider, 'openai-compatible')
  assert.equal(settings.apiKeyConfigured, true, 'Anahtar yapılandırılmış görünmeli')

  // 4) Sohbet akışı gerçekten sahte sağlayıcıya gitmeli; anahtar yalnızca header'da.
  await page.evaluate(() => { window.__providerEvents = []; window.__providerUnlisten = window.kodAtolyesi.onEvent((event) => window.__providerEvents.push(event)) })
  await page.evaluate(() => { void window.kodAtolyesi.sendMessage([{ role: 'user', content: 'Merhaba' }]) })
  await page.waitForFunction(() => (window.__providerEvents ?? []).some((event) => event.type === 'done'), null, { timeout: 60_000 })
  const deltas = await page.evaluate(() => (window.__providerEvents ?? []).filter((event) => event.type === 'delta').map((event) => event.text).join(''))
  assert.match(deltas, /Merhaba dünya/, `Sohbet akışı sahte sağlayıcıdan gelmeli; gelen: ${deltas.slice(-300)}`)
  assert.ok(requests.some((item) => item.url === '/v1/models'), '/models çağrısı yapılmalı')
  assert.ok(requests.some((item) => item.url === '/v1/chat/completions' && item.hasAuthorization), 'Sohbet çağrısı Authorization başlığıyla gitmeli')

  // 5) Anahtar ayar dosyasına sızmamalı; yalnızca ayrı sır dosyasında olmalı.
  const settingsRaw = await fs.readFile(path.join(profilePath, 'settings.json'), 'utf8')
  assert.equal(settingsRaw.includes(mockKey), false, 'API anahtarı settings.json içinde olmamalı')
  assert.equal(/apiKey/i.test(settingsRaw), false, 'settings.json içinde apiKey alanı olmamalı')
  const secretsRaw = await fs.readFile(path.join(profilePath, 'provider-secrets.json'), 'utf8')
  assert.equal(secretsRaw.includes(mockKey), true, 'Anahtar yalnızca provider-secrets.json içinde tutulmalı')

  // 6) Yeniden yüklenen arayüzde kayıtlı anahtar maskeli durumda görünür; ekran görüntüsü kanıtı.
  await page.reload()
  await page.waitForSelector('.app-shell', { timeout: 30_000 })
  await page.locator('button[title="Ayarlar"]').click()
  await page.waitForSelector('.settings-modal')
  assert.match(await page.locator('#api-key').getAttribute('placeholder'), /Kayıtlı anahtar var/)
  assert.equal(await page.locator('#clear-api-key').count(), 1, 'Anahtarı silme seçeneği görünmeli')
  assert.equal(await page.locator('#base-url').inputValue(), mockBaseUrl)
  await page.screenshot({ path: path.resolve('release', 'installed-provider.png') })

  console.log('SAGLAYICI-KONTROL: GECTI')
  console.log('MODELS-ISTEGI:', requests.filter((item) => item.url === '/v1/models').length)
  console.log('CHAT-ISTEGI:', requests.filter((item) => item.url === '/v1/chat/completions').length)
  console.log('DELTA:', deltas.slice(0, 120))
} catch (error) {
  exitStatus = 1
  console.error('SAGLAYICI-KONTROL-HATA:', error?.message ?? error)
} finally {
  await execAsync(`taskkill /PID ${child.pid} /T /F`)
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) => setTimeout(resolve, 1200))
  for (let attempt = 0; attempt < 8; attempt++) {
    await fs.rm(profilePath, { recursive: true, force: true }).catch(() => undefined)
    await fs.rm(projectPath, { recursive: true, force: true }).catch(() => undefined)
    try { await fs.access(profilePath) } catch { break }
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  process.exit(exitStatus)
}
