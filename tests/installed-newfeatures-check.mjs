import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// Kurtarma sonrası derlenen kurulu uygulamada YENİ özelliklerin (Dosya/Yazılım/Eklenti
// motorları ve sekmeleri) gerçekten var olduğunu doğrular. Gerçek model gerekmez.
const debugPort = process.env.INSTALLED_SMOKE_DEBUG_PORT || String(9220 + Math.floor(Math.random() * 40))
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-newfeatures-'))
const installedPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ultron', 'Ultron.exe')
const { spawn } = await import('node:child_process')

const child = spawn(installedPath, [`--user-data-dir=${profilePath}`, `--remote-debugging-port=${debugPort}`], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
})

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
await waitPort()

let exitStatus = 0
try {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Kurulu Ultron penceresi açılmalı')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.getProject), null, { timeout: 20_000 })

  // 1) Yeni yükleme API'leri preload köprüsünde mevcut olmalı
  const api = await page.evaluate(() => ({
    fileSearch: typeof window.kodAtolyesi.runFileSearch,
    scopes: typeof window.kodAtolyesi.listFileScopes,
    software: typeof window.kodAtolyesi.getSoftwareCatalog,
    adapters: typeof window.kodAtolyesi.listAppAdapters,
    capability: typeof window.kodAtolyesi.checkCapability,
    plugins: typeof window.kodAtolyesi.listPlugins,
    pluginEnable: typeof window.kodAtolyesi.enablePlugin,
    pluginInstallZip: typeof window.kodAtolyesi.installPluginZip,
  }))
  for (const [key, value] of Object.entries(api)) assert.equal(value, 'function', `window.kodAtolyesi.${key} fonksiyon olmalı`)

  // 2) Sekmeler arayüzde görünmeli
  for (const tab of ['Dosyalar', 'Yazılımlar', 'Eklentiler']) {
    const count = await page.locator('.right-tabs button', { hasText: tab }).count()
    assert.ok(count === 1, `Sekme eksik/çok: ${tab} (${count})`)
  }

  // 3) Dosya arama motoru çalışıyor olmalı (proje kapsamı yoksa AÇIK yönlendirme metni)
  const fileSearch = await page.evaluate(async () => {
    try {
      const result = await window.kodAtolyesi.runFileSearch('deneme-arama', '')
      return { threw: false, hits: result.hits?.length ?? 0 }
    } catch (error) { return { threw: true, message: String(error?.message ?? error).slice(0, 200) } }
  })
  assert.equal(typeof fileSearch.threw, 'boolean', 'runFileSearch sonuç dönmeli')
  assert.ok(
    fileSearch.threw ? /proje|kapsam/i.test(fileSearch.message) : fileSearch.hits >= 0,
    `Dosya arama beklenen davranışta olmalı: ${JSON.stringify(fileSearch)}`,
  )

  // 4) Yazılım envanteri gerçek makalede kayıt dönmeli
  const software = await page.evaluate(async () => {
    const catalog = await window.kodAtolyesi.getSoftwareCatalog()
    return catalog.catalog.entries.map((entry) => entry.name).slice(0, 5)
  })
  assert.ok(software.length >= 1, `Yazılım kataloğu kurulu uygulamada dolu olmalı: ${JSON.stringify(software)}`)
  console.log('KURULU-APP SOZLUK ILK 5:', JSON.stringify(software))

  // 5) Eklenti motoru: olmayan eklentinin etkinleştirilmesi açık Türkçe hata dönmeli
  const pluginReject = await page.evaluate(async () => {
    try { await window.kodAtolyesi.enablePlugin('olmayan-eklenti'); return { ok: true, error: '' } }
    catch (error) { return { ok: false, error: String(error?.message ?? error).slice(0, 160) } }
  })
  assert.equal(pluginReject.ok, false, 'Olmayan eklentinin etkinleştirilmesi reddedilmeli')
  assert.ok(/kurulu değil/i.test(pluginReject.error), `Hata beklenen biçimde olmalı: ${pluginReject.error}`)

  // 6) Eklenti IPC turu (dialogsuz): list boş liste + kurulum yolu dönmeli
  const pluginsEye = await page.evaluate(() => window.kodAtolyesi.listPlugins())
  assert.ok(Array.isArray(pluginsEye.plugins), 'listPlugins dizi dönmeli')
  assert.ok(/plugins$/.test(pluginsEye.rootDir) && !pluginsEye.rootDir.includes('object'), `Eklenti rootDir profil dizini olmalı: ${pluginsEye.rootDir}`)
  console.log('PLUGIN-IPC-TURU: ok · rootDir =', pluginsEye.rootDir)

  await page.screenshot({ path: path.join(process.cwd(), 'release', 'installed-newfeatures.png') })
  console.log('KURULU-APP-YENI-ÖZELLIKLER: GEÇTİ')
} catch (error) {
  exitStatus = 1
  console.error('YENI-ÖZELLIK-KONTROL-HATA:', error?.message ?? error)
} finally {
  // Windows'ta negatif PID grup-kill çalışmaz; taskkill /T ile süreç ağacı kapanır.
  const { exec } = await import('node:child_process')
  await new Promise((resolve) => { exec(`taskkill /PID ${child.pid} /T /F`, () => resolve()) }).catch(() => undefined)
  setTimeout(() => process.exit(exitStatus), 1500).unref()
}
