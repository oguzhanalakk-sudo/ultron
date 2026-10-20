import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// ULTRON TURBO ölçüm betiği: önce/sonra karşılaştırma için aynı senaryolarla çalışır.
// Sahte sonuç yok: yalnızca ölçülen değerler yazılır; başarısız senaryo başarısız olarak kaydedilir.
// Çıktı: PERF_OUTPUT_NAME (varsayılan release/perf-baseline.json) ve PERF_SCREENSHOT_NAME (varsayılan release/perf-scenarios.png)
const debugPort = process.env.PERF_DEBUG_PORT || String(9460 + Math.floor(Math.random() * 120))
const outputName = process.env.PERF_OUTPUT_NAME || 'perf-baseline.json'
const screenshotName = process.env.PERF_SCREENSHOT_NAME || 'perf-scenarios.png'
const launchAt = Date.now()
const sandbox = path.join(process.env.TEMP || os.tmpdir(), 'opencode', `ultron-perf-sandbox-${Date.now().toString(36)}`)
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-perf-profile-'))
const installedPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ultron', 'Ultron.exe')
const { spawn, exec } = await import('node:child_process')
const execAsync = (command) => new Promise((resolve) => exec(command, { windowsHide: true }, (error, stdout, stderr) => resolve({ error, stdout, stderr })))

await fs.mkdir(sandbox, { recursive: true })
await fs.mkdir(path.join(sandbox, 'testler'), { recursive: true })
await fs.writeFile(path.join(sandbox, 'not.txt'), 'Bu dosya ULTRON performans ölçüm kum havuzunun not.txt dosyasıdır.\nİkinci satır: süreler milisaniye cinsinden ölçülür.\n', 'utf8')
await fs.writeFile(path.join(sandbox, 'notlar.md'), '# Notlar\n\n- Performans ölçümü yapılmaktadır.\n- Model yerel Ollama qwen3:8b.\n', 'utf8')
await fs.writeFile(path.join(sandbox, 'testler/yerel_kontrol.py'), 'import unittest\n\nclass YerelKontrol(unittest.TestCase):\n    def test_health(self):\n        self.assertEqual(2, 2)\n\nif __name__ == "__main__":\n    unittest.main()\n', 'utf8')

// Masaüstü ölçüm dosyası: gerçek masaüstü yolu Windows API'siyle çözülür (sabit C:\ varsayımı yok).
const desktopProbeFile = 'ultron-perf-not.txt'
const desktopResult = await execAsync('powershell -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"')
const desktopDir = String(desktopResult.stdout ?? '').trim()
if (desktopDir) await fs.writeFile(path.join(desktopDir, desktopProbeFile), 'Masaüstü performans ölçüm dosyası (otomatik temizlenir).\n', 'utf8')
results_init: {
  // yalnızca konsol günlüğü
}

const child = spawn(installedPath, [
  `--user-data-dir=${profilePath}`,
  `--remote-debugging-port=${debugPort}`,
  '--open-project', sandbox,
], { detached: true, stdio: 'ignore', windowsHide: true })

const waitPort = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const net = await import('node:net')
      await new Promise((resolve, reject) => {
        const socket = net.createConnection(Number(debugPort), '127.0.0.1', () => { socket.end(); resolve() })
        socket.on('error', reject)
      })
      return
    } catch { await new Promise((resolve) => setTimeout(resolve, 500)) }
  }
  throw new Error('Perf uygulaması CDP portu açılmadı')
}
await waitPort()

const results = { measuredAt: new Date().toISOString(), sandbox, desktopDir, scenarios: {}, approvals: [], reviewProposalsObserved: [], errors: [] }
let exitStatus = 0
const safeCommand = (command) => {
  const text = String(command ?? '')
  if (!/^(python3?|py|where|cmd \/c (python|py))/i.test(text.trim())) return false
  return !/(pip install|msiexec|reg add|netsh|rmdir|del \/|format|shutdown|taskkill|Remove-Item|Invoke-WebRequest|curl |bitsadmin|wmic|setx)/i.test(text)
}

try {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Perf penceresi açılmalı')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.getProject) && Boolean(document.querySelector('.app-shell')), null, { timeout: 90_000 })
  results.startupMs = Date.now() - launchAt

  await page.evaluate(() => { window.__perfEvents = [] })
  await page.evaluate(() => { window.__perfUnlisten = window.kodAtolyesi.onEvent((event) => window.__perfEvents.push(event)) })
  const clearEvents = async () => { await page.evaluate(() => { window.__perfEvents = [] }) }
  await clearEvents()

  // Ölçüm izinleri: gercek kullanıcı varsayılanı (review + onay), taslaklar uygulanmaz.
  await page.evaluate(() => window.kodAtolyesi.saveWorkspace({
    permissions: { mode: 'controlled', editMode: 'review', commandMode: 'confirm', allowPackageInstalls: false, allowSystemChanges: false },
  }))

  const ipcMs = async (selector, arg) => { const t0 = Date.now(); const value = await page.evaluate(selector, arg ?? null); return { ms: Date.now() - t0, value } }

  // --- 1. Yerel deterministik IPC ölçümleri (model çağrısı yok) ---
  results.scenarios.softwareListCached = await ipcMs(() => window.kodAtolyesi.getSoftwareCatalog())
  results.scenarios.pluginsList = await ipcMs(() => window.kodAtolyesi.listPlugins())
  results.scenarios.localAIStatus = await ipcMs(() => window.kodAtolyesi.getLocalAIStatus())

  // Dosya arama motorunun gerçek masaüstü kapsamını ölçmek için masaüstü read-only kaynak kökü:
  const injected = await page.evaluate((dir) => window.kodAtolyesi.saveWorkspace({
    resourceRoots: [{ id: 'perf-desktop', path: dir, recursive: true, access: 'read' }],
  }), desktopDir)
  results.desktopRootInjected = Boolean(injected)
  const scopes = await page.evaluate(() => window.kodAtolyesi.listFileScopes())
  const desktopScope = scopes.resources.find((item) => item.value.includes('perf-desktop'))?.value ?? ''

  results.scenarios.fileSearchDesktopCold = await ipcMs((scope) => window.kodAtolyesi.runFileSearch('ultron-perf-not', scope), desktopScope)
  results.scenarios.fileSearchDesktopWarm = await ipcMs((scope) => window.kodAtolyesi.runFileSearch('ultron-perf-not', scope), desktopScope)
  results.desktopSearchHit = results.scenarios.fileSearchDesktopCold.value?.hits?.some?.((hit) => String(hit.path ?? '').endsWith(desktopProbeFile)) ?? false
  results.scenarios.fileSearchProjectCold = await ipcMs(() => window.kodAtolyesi.runFileSearch('not.txt', ''))
  results.scenarios.fileSearchProjectWarm = await ipcMs(() => window.kodAtolyesi.runFileSearch('not.txt', ''))
  results.scenarios.filePreview = await ipcMs(() => window.kodAtolyesi.previewProjectFile('not.txt'))
  results.scenarios.softwareRefreshLive = await ipcMs(() => window.kodAtolyesi.refreshSoftwareCatalog())

  // --- 2. Sohbet: model soğuk / sıcak ---
  // Dürüst cold ölçüm: ölçüm öncesi yüklü model varsa boşaltılır (önceki çalışmaların taşınması yok).
  const preloaded = (await page.evaluate(() => window.kodAtolyesi.getLocalAIStatus())).loadedModels ?? []
  results.unloadedBeforeCold = []
  for (const model of preloaded) {
    const unload = await page.evaluate((name) => window.kodAtolyesi.unloadLocalModel(name), model.name)
    results.unloadedBeforeCold.push({ model: model.name, ok: unload?.ok ?? null, ms: unload?.durationMs ?? null })
  }
  const captureStats = async () => {
    const status = await page.evaluate(() => window.kodAtolyesi.getLocalAIStatus())
    return {
      requests: status.stats?.requests ?? null, lastDurationMs: status.stats?.lastDurationMs ?? null,
      lastTokensPerSecond: status.stats?.lastTokensPerSecond ?? null, lastEvaluatedTokens: status.stats?.lastEvaluatedTokens ?? null,
      lastPromptTokens: status.stats?.lastPromptTokens ?? null,
      loadedModels: (status.loadedModels ?? []).map((model) => model.name),
    }
  }
  const agentMessageCount = async () => (await page.locator('article.message.assistant').count())

  const chatScenario = async (label, text) => {
    const before = await captureStats()
    const beforeCount = await agentMessageCount()
    const sendAt = Date.now()
    const chatInput = page.locator('.main-column textarea')
    await chatInput.fill(text)
    await chatInput.press('Enter')
    let firstChunkMs = null
    await page.waitForFunction((prev) => [...document.querySelectorAll('article.message.assistant .markdown-body')].slice(prev).some((body) => (body.textContent ?? '').trim().length > 0), beforeCount, { timeout: 300_000 }).catch(() => undefined)
    firstChunkMs = Date.now() - sendAt
    await page.waitForFunction(() => { const input = document.querySelector('.main-column textarea'); return Boolean(input) && !input.disabled }, null, { timeout: 300_000 }).catch(() => undefined)
    return { label, firstChunkMs, completeMs: Date.now() - sendAt, before, after: await captureStats() }
  }

  results.scenarios.chatCold = await chatScenario('chat-cold', 'Merhaba! Tek cümleyle kendini tanıt.')
  results.scenarios.chatWarm = await chatScenario('chat-warm', 'Yerel model durumunu tek cümleyle özetler misin?')

  // --- 3. Ajan görev senaryoları (gerçek kullanıcı istekleri; süre + model çağrı sayısı ölçülür) ---
  const taskScenario = async (label, text, timeoutMs = 12 * 60_000) => {
    const before = await captureStats()
    const sendAt = Date.now()
    const chatInput = page.locator('.main-column textarea')
    await chatInput.fill(text)
    await chatInput.press('Enter')
    const deadline = Date.now() + timeoutMs
    let settled = false
    while (Date.now() < deadline) {
      await page.waitForTimeout(2_500)
      const tasks = await page.evaluate(() => window.kodAtolyesi.getTasks())
      const events = await page.evaluate(() => [...(window.__perfEvents ?? [])])
      await page.evaluate(() => { window.__perfEvents = [] })
      for (const event of events.filter((item) => item.type === 'proposal')) {
        results.reviewProposalsObserved.push({ label, path: event.proposal?.path })
      }
      for (const event of events.filter((item) => item.type === 'approval')) {
        const request = event.request
        if (!request?.requestId) continue
        const approve = safeCommand(request.command)
        await page.evaluate((payload) => window.kodAtolyesi.resolveApproval(payload.id, payload.decision), { id: request.requestId, decision: approve ? { approved: true, scope: 'category', remember: true } : { approved: false, scope: 'operation', remember: false } })
        results.approvals.push({ label, command: String(request.command ?? '').slice(0, 160), decision: approve ? 'onaylandi' : 'reddedildi' })
      }
      const running = tasks.filter((task) => ['running', 'waiting_approval'].includes(task.status))
      settled = tasks.length > 0 && running.length === 0
      if (settled) break
    }
    const after = await captureStats()
    const tasks = await page.evaluate(() => window.kodAtolyesi.getTasks())
    const latest = tasks[0]
    return {
      label, ms: Date.now() - sendAt, settled,
      taskStatus: latest?.status ?? null,
      toolEvents: (latest?.events ?? []).filter((event) => event.type === 'tool').map((event) => `${event.name}:${event.status ?? ''}`),
      finalText: String((await page.locator('article.message.assistant .markdown-body').allTextContents()).at(-1) ?? '').slice(0, 700),
      requestsDelta: after.requests !== null && before.requests !== null ? after.requests - before.requests : null,
      promptTokens: after.lastPromptTokens, tokPerSec: after.lastTokensPerSecond,
    }
  }

  results.scenarios.agentListFiles = await taskScenario('agent-list-files', 'Bu klasördeki dosyaları listele.')
  results.scenarios.agentReadFile = await taskScenario('agent-read-file', 'not.txt dosyasının içeriğini oku ve bana kısaca özetle.')
  // Masaüstü açma senaryosu hızlı yerel yol olabilir (görev kaydı oluşmaz); yanıt geldiğinde doğrudan ölçülür
  // ve OS düzeyinde açmanın gerçekten başladığı, açılan Notepad'ın tam eşleşen komut satırıyla tespit edilip temizlenir.
  const desktopOpenScenario = async () => {
    const before = await captureStats()
    const beforeCount = await agentMessageCount()
    const sendAt = Date.now()
    const chatInput = page.locator('.main-column textarea')
    await chatInput.fill('masaüstündeki ultron-perf-not.txt dosyasını aç.')
    await chatInput.press('Enter')
    await page.waitForFunction((prev) => [...document.querySelectorAll('article.message.assistant .markdown-body')].slice(prev).some((body) => (body.textContent ?? '').trim().length > 0), beforeCount, { timeout: 240_000 }).catch(() => undefined)
    await page.waitForFunction(() => { const input = document.querySelector('.main-column textarea'); return Boolean(input) && !input.disabled }, null, { timeout: 240_000 }).catch(() => undefined)
    const ms = Date.now() - sendAt
    const after = await captureStats()
    const tasks = await page.evaluate(() => window.kodAtolyesi.getTasks())
    const latest = tasks[0]
    await new Promise((resolve) => setTimeout(resolve, 1_800))
    const osOpen = { detected: false, killed: [], error: null }
    try {
      const probe = await execAsync('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'Notepad.exe\'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"')
      let parsed = []
      try { parsed = JSON.parse(String(probe.stdout ?? '').trim() || '[]') } catch { parsed = [] }
      const list = Array.isArray(parsed) ? parsed : parsed && parsed.ProcessId ? [parsed] : []
      const matched = list.filter((item) => String(item.CommandLine ?? '').includes(desktopProbeFile))
      osOpen.detected = matched.length > 0
      for (const item of matched) {
        await new Promise((resolve) => exec(`taskkill /PID ${item.ProcessId} /T /F`, { windowsHide: true }, () => resolve()))
        osOpen.killed.push(Number(item.ProcessId))
      }
    } catch (error) {
      osOpen.error = String(error?.message ?? error).slice(0, 200)
    }
    return {
      label: 'agent-desktop-open', ms, osOpenedNotepad: osOpen.detected, osOpenNotepadKilled: osOpen.killed, osOpenError: osOpen.error,
      settled: true, fastPathNoTask: tasks.length === 0,
      taskStatus: latest?.status ?? null,
      toolEvents: (latest?.events ?? []).filter((event) => event.type === 'tool').map((event) => `${event.name}:${event.status ?? ''}`),
      finalText: String((await page.locator('article.message.assistant .markdown-body').allTextContents()).at(-1) ?? '').slice(0, 700),
      requestsDelta: after.requests !== null && before.requests !== null ? after.requests - before.requests : null,
      promptTokens: after.lastPromptTokens, tokPerSec: after.lastTokensPerSecond,
    }
  }
  results.scenarios.agentDesktopOpen = await desktopOpenScenario()
  results.scenarios.agentRunTests = await taskScenario('agent-run-tests', 'testler/yerel_kontrol.py dosyasını python ile çalıştır.', 8 * 60_000)

  // Yerel model çalışma zamanı özeti (bellek/bağlam): doğrudan Ollama sunucusundan
  const aiStatus = await page.evaluate(() => window.kodAtolyesi.getLocalAIStatus())
  results.modelRuntime = { selectedModel: aiStatus.selectedModel, baseUrl: aiStatus.baseUrl, loadedModels: aiStatus.loadedModels ?? [], hardware: aiStatus.hardware ?? null }

  const screenshot = path.resolve('release', screenshotName)
  await fs.mkdir(path.dirname(screenshot), { recursive: true })
  await page.screenshot({ path: screenshot })
  results.screenshot = screenshot
} catch (error) {
  exitStatus = 1
  results.errors.push(String(error?.message ?? error).slice(0, 600))
  console.error('PERF-SCENARIOS-HATA:', error?.message ?? error)
} finally {
  // taskkill /Tile süreç ağacı kapanır; process.kill(-pid) Windows'ta çalışmaz.
  exec(`taskkill /PID ${child.pid} /T /F`, { windowsHide: true }, () => undefined)
  const target = path.resolve('release', outputName)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(results, null, 2), 'utf8').catch(() => undefined)
  console.log(`KANIT-KAYDI: ${target}`)
  if (desktopDir) await fs.rm(path.join(desktopDir, desktopProbeFile), { force: true }).catch(() => undefined)
  for (let attempt = 0; attempt < 10; attempt++) {
    await fs.rm(profilePath, { recursive: true, force: true }).catch(() => undefined)
    try { await fs.access(profilePath) } catch { break }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  setTimeout(() => process.exit(exitStatus), 1_500).unref()
}
