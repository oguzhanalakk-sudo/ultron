import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// Canlı ajan akışı doğrulaması: BOŞ bir klasörde, gerçek yerel model (Ollama qwen3:8b)
// ile tam ajan akışı (niyet → plan → üretme → test → düzeltme) çalıştırılır.
// Sahtecilik kabul edilmez: model gerçekten tamamlamadan "tamamlandı" denmez;
// kanıtlar release/agent-flow-demo.json + release/agent-flow-demo.png dosyalarına yazılır.
const debugPort = process.env.DEMO_DEBUG_PORT || String(9650 + Math.floor(Math.random() * 250))
const taskText = process.env.DEMO_TASK || 'Basit bir not defteri uygulaması yap: Tkinter GUI, kaydet/aç, testleri olsun'
const maxRunMs = Number(process.env.DEMO_MAX_MS || 26 * 60 * 1000)
const projectRoot = path.join(process.env.TEMP || os.tmpdir(), 'opencode', `ultron-demo-notepad-${Date.now().toString(36)}`)
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-demo-profile-'))
const installedPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ultron', 'Ultron.exe')
const { spawn, exec } = await import('node:child_process')
const execAsync = (command, options = {}) => new Promise((resolve) => exec(command, { windowsHide: true, ...options }, (error, stdout, stderr) => resolve({ error, stdout, stderr })))

await fs.mkdir(projectRoot, { recursive: true })
const initialEntries = await fs.readdir(projectRoot)
assert.equal(initialEntries.length, 0, 'Demo klasörü boş olmalı (sıfırdan üretim kanıtı)')

const child = spawn(installedPath, [
  `--user-data-dir=${profilePath}`,
  `--remote-debugging-port=${debugPort}`,
  '--open-project', projectRoot,
], { detached: true, stdio: 'ignore', windowsHide: true })

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

const evidence = {
  startedAt: new Date().toISOString(),
  projectRoot,
  taskText,
  debugPort,
  proposalsApplied: [],
  approvals: [],
  statusTrace: [],
  tasks: [],
  assistantFinal: null,
  unittest: null,
  fileTree: [],
  errors: [],
}
let exitStatus = 0

// Onay politikası: yalnızca salt-okunur python çağrıları (python/py/where) otomatik onaylanır;
// kurulum, kayıt defteri, ağ ve silme içerikli komutlar reddedilir (kanıt kaydına yazılır).
const safeCommand = (command) => {
  const text = String(command ?? '')
  if (!/^(python3?|py|where|cmd \/c (python|py))/i.test(text.trim())) return false
  return !/(pip install|msiexec|reg add|regedit|netsh|rmdir|del \/|format|shutdown|taskkill|Remove-Item|Invoke-WebRequest|curl |bitsadmin|wmic|setx)/i.test(text)
}

const listTree = async (root, prefix = '') => {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(`${prefix}${entry.name}/`)
      out.push(...await listTree(full, `${prefix}  `))
    } else {
      const size = (await fs.stat(full)).size
      out.push(`${prefix}${entry.name} (${size} B)`)
    }
  }
  return out
}

try {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Kurulu Ultron penceresi açılmalı')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.getProject), null, { timeout: 20_000 })
  await page.waitForFunction(() => Boolean(document.querySelector('.app-shell')), null, { timeout: 30_000 })

  const openedProject = await page.evaluate(() => window.kodAtolyesi.getProject())
  const openedProjectPath = typeof openedProject === 'string' ? openedProject : openedProject?.path
  assert.equal(openedProjectPath, await fs.realpath(projectRoot), 'Ajan akışı boş demo klasöründe başlatılmalı')
  evidence.openedProject = openedProject

  await page.evaluate(() => { window.__demoEvents = [] })
  await page.evaluate(() => { window.__demoUnlisten = window.kodAtolyesi.onEvent((event) => window.__demoEvents.push(event)) })

  const aiStatus = await page.evaluate(() => window.kodAtolyesi.getLocalAIStatus())
  evidence.localAI = { connected: aiStatus.connected, selectedModel: aiStatus.selectedModel, models: (aiStatus.models ?? []).map((model) => model.name), loaded: (aiStatus.loadedModels ?? []).map((model) => model.name) }
  assert.equal(aiStatus.connected, true, 'Yerel Ollama bağlantısı kurulu olmalı')
  assert.ok((aiStatus.models ?? []).some((model) => model.name === 'qwen3:8b'), 'qwen3:8b yerel model listesinde olmalı')

  // Demo izinleri: taslaklar otomatik uygulanır (uygulama öncesi yedek alınır),
  // komutlar onay panelinden geçer; paket kurulumu ve sistem değişikliği kapalı.
  await page.evaluate(() => window.kodAtolyesi.saveWorkspace({
    permissions: { mode: 'controlled', editMode: 'automatic', commandMode: 'confirm', allowPackageInstalls: false, allowSystemChanges: false },
  }))

  const chatInput = page.locator('.main-column textarea')
  await chatInput.fill(taskText)
  await chatInput.press('Enter')
  evidence.sentAt = new Date().toISOString()

  const processedProposals = new Set()
  const processedApprovals = new Set()
  const runStart = Date.now()
  while (Date.now() - runStart < maxRunMs) {
    await page.waitForTimeout(3_000)
    const tasks = await page.evaluate(() => window.kodAtolyesi.getTasks())
    const events = await page.evaluate(() => [...(window.__demoEvents ?? [])])
    await page.evaluate(() => { window.__demoEvents = [] })

    for (const proposal of events.filter((event) => event.type === 'proposal').map((event) => event.proposal)) {
      if (!proposal?.id || processedProposals.has(proposal.id)) continue
      processedProposals.add(proposal.id)
      const applied = await page.evaluate((id) => window.kodAtolyesi.applyProposal(id), proposal.id)
      evidence.proposalsApplied.push({ path: proposal.path, bytes: proposal.newContent?.length ?? 0, applied })
      console.log(`TASLAK-UYGULANDI: ${proposal.path}`)
    }

    for (const event of events.filter((item) => item.type === 'approval')) {
      const request = event.request
      if (!request?.requestId || processedApprovals.has(request.requestId)) continue
      processedApprovals.add(request.requestId)
      const approve = safeCommand(request.command)
      const decision = approve ? { approved: true, scope: 'category', remember: true } : { approved: false, scope: 'operation', remember: false }
      evidence.approvals.push({ command: String(request.command ?? request.reason ?? '').slice(0, 300), category: request.category, risk: request.risk, decision: decision.approved ? 'onaylandi' : 'reddedildi' })
      console.log(`ONAY-${decision.approved ? 'VERILDI' : 'REDDEDILDI'}: ${String(request.command ?? '').slice(0, 120)}`)
      await page.evaluate((payload) => window.kodAtolyesi.resolveApproval(payload.id, payload.decision), { id: request.requestId, decision })
    }

    const running = tasks.filter((task) => ['running', 'waiting_approval'].includes(task.status))
    const done = tasks.length > 0 && tasks.every((task) => !['running', 'waiting_approval'].includes(task.status))
    if (running.length) {
      const trace = { at: new Date().toISOString(), status: running[0].status, stage: running[0].stage ?? null, tool: running[0].currentTool ?? null, correctionAttempts: running[0].correctionAttempts ?? null }
      evidence.statusTrace.push(trace)
      console.log(`ASAMA: ${trace.status} / ${trace.stage ?? '-'} / ${trace.tool ?? '-'}`)
    }
    if (done) break
  }

  const finalTasks = await page.evaluate(() => window.kodAtolyesi.getTasks())
  evidence.tasks = finalTasks.slice(0, 4).map((task) => ({
    id: task.id,
    request: String(task.request ?? '').slice(0, 200),
    status: task.status,
    stage: task.stage ?? null,
    plan: task.plan ?? [],
    completedSteps: task.completedSteps ?? [],
    pendingSteps: task.pendingSteps ?? [],
    acceptanceTests: task.acceptanceTests ?? [],
    verificationResults: (task.verificationResults ?? []).slice(-6),
    verificationFailures: (task.verificationFailures ?? []).slice(-3),
    errorAnalysis: task.errorAnalysis ?? null,
    events: (task.events ?? []).slice(-14).map((event) => ({ type: event.type, name: event.name, status: event.status, detail: String(event.detail ?? '').slice(0, 160) })),
  }))
  evidence.assistantFinal = String((await page.locator('article.message.assistant .markdown-body').allTextContents()).at(-1) ?? '').slice(0, 4_000)
  evidence.finishedAt = new Date().toISOString()

  const latest = evidence.tasks[0]
  assert.ok(latest, 'Ajan görev kaydı oluşmalı')
  evidence.finalTaskStatus = latest.status

  // Kanıt 1: klasör gerçekten dosya içeriyor mu?
  evidence.fileTree = await listTree(projectRoot)
  assert.ok(evidence.fileTree.length > 0, `Ajan boş klasöre dosya üretmeli; son durum: ${latest.status}`)

  // Kanıt 2: üretilen uygulamanın testleri gerçekten çalışıyor ve geçiyor mu?
  // unittest discover proje kökünden tests/ klasörünü keşfetmez (paket değilse);
  // test klasörlerini bulup her birini kendi ebeveyninden çalıştır, en az bir gerçek test iste.
  const findTestDirs = async (root) => {
    const found = []
    const walk = async (dir) => {
      let entries = []
      try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
      if (path.basename(dir) === 'tests' && entries.some((entry) => entry.isFile() && /^test.*\.py$/i.test(entry.name))) found.push(dir)
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== '__pycache__' && entry.name !== '.codex-local') await walk(path.join(dir, entry.name))
      }
    }
    await walk(root)
    return found
  }
  const testRuns = []
  for (const dir of await findTestDirs(projectRoot)) {
    const run = await execAsync('cmd /c python -m unittest discover -s tests -v', { cwd: path.dirname(dir) })
    const exitCode = run.error ? (typeof run.error.code === 'number' ? run.error.code : String(run.error.code ?? 'killed')) : 0
    const combined = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
    const ranMatch = combined.match(/Ran (\d+) tests?/)
    testRuns.push({
      directory: path.relative(projectRoot, dir) || '.',
      exitCode,
      ranTests: ranMatch ? Number(ranMatch[1]) : 0,
      stdout: String(run.stdout ?? '').slice(0, 4_000),
      stderr: String(run.stderr ?? '').slice(0, 4_000),
    })
  }
  evidence.unittest = {
    cwd: projectRoot,
    runs: testRuns,
    ranTests: testRuns.reduce((total, run) => total + run.ranTests, 0),
    exitCode: testRuns.length && testRuns.every((run) => run.exitCode === 0) ? 0 : 'failed',
  }

  const screenshot = path.resolve('release', 'agent-flow-demo.png')
  await fs.mkdir(path.dirname(screenshot), { recursive: true })
  await page.screenshot({ path: screenshot })
  evidence.screenshot = screenshot

  console.log('DOSYA-AGACI:')
  for (const line of evidence.fileTree) console.log(`  ${line}`)
  console.log('TASK-SON-DURUM:', evidence.finalTaskStatus)
  console.log('UNITTEST-CIKIS-KODU:', evidence.unittest.exitCode, '| CALISAN-TEST:', evidence.unittest.ranTests)
  if (evidence.unittest.runs.length) {
    const lastRun = evidence.unittest.runs.at(-1)
    console.log(String(lastRun.stderr || '').trim() ? String(lastRun.stderr).slice(-1_200) : String(lastRun.stdout).slice(-1_200))
  }

  assert.equal(latest.status, 'completed', `Ajan görevi tamamlamalı; gerçek durum: ${latest.status}`)
  assert.equal(evidence.unittest.exitCode, 0, `Üretilen uygulamanın testleri geçmeli:\n${JSON.stringify(evidence.unittest.runs, null, 2)}`)
  assert.ok(evidence.unittest.ranTests >= 1, `En az bir gerçek test çalışmalı; çalışan test sayısı: ${evidence.unittest.ranTests}`)
  console.log('AJAN-AKISI-DEMO: GECTI')
} catch (error) {
  exitStatus = 1
  evidence.errors.push(String(error?.message ?? error).slice(0, 500))
  console.error('AJAN-AKISI-DEMO-HATA:', error?.message ?? error)
} finally {
  // taskkill /T süreç ağacını kapatır; process.kill(-pid) Windows'ta çalışmaz.
  await execAsync(`taskkill /PID ${child.pid} /T /F`)
  const target = path.resolve('release', 'agent-flow-demo.json')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(evidence, null, 2), 'utf8').catch(() => undefined)
  console.log(`KANIT-KAYDI: ${target}`)
  // Electron kapanırken dosya tutamaçları kısa süre açık kalabilir; sınırlı denemeyle sil.
  for (let attempt = 0; attempt < 10; attempt++) {
    await fs.rm(profilePath, { recursive: true, force: true }).catch(() => undefined)
    try { await fs.access(profilePath) } catch { break }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  setTimeout(() => process.exit(exitStatus), 1_500).unref()
}
