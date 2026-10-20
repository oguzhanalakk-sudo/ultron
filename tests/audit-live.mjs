import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, exec } from 'node:child_process'

// ULTRON tam denetim canlı koşumu (kurulu uygulama): §6 internet araştırması E2E,
// §8 çok adımlı masaüstü görevi, §5 gerçek dosya işlemleri, §7 düzeltme+test doğrulaması.
// Sahte sonuç yok: her senaryoda gerçek kanıt (görev olayları, dosya mutasyonu, sürecin kendisi) doğrulanır.
const debugPort = process.env.AUDIT_DEBUG_PORT || String(9700 + Math.floor(Math.random() * 120))
const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-audit-profile-'))
const installedPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'Ultron', 'Ultron.exe')

// Kum havuzu: gerçek kullanıcı verisi asla değiştirilmez; ajan yalnızca bu klasörde çalışır.
const sandbox = path.join(process.env.TEMP || os.tmpdir(), 'opencode', `ultron-audit-sandbox-${Date.now().toString(36)}`)
await fs.mkdir(path.join(sandbox, 'testler'), { recursive: true })

// §6/§7 senaryo hazırlığı: bilerek hatalı küçük Python projesi (ImportError: yazım hatası).
// Test dosyası ; içerik: unittest — düzeltme sonrası mutlaka çalışabilmeli.
await fs.writeFile(path.join(sandbox, 'aritmetik.py'), 'def toplam(a, b):\n    return a + b\n\n\ndef main():\n    print("toplam=6:", toplam(2, 4))\n    import jsonper\n    print(jsonper.dumps({"ok": True}))\n\n\nif __name__ == "__main__":\n    main()\n', 'utf8')
await fs.writeFile(path.join(sandbox, 'testler', 'test_aritmetik.py'), 'import unittest\nfrom aritmetik import toplam\n\nclass TestAritmetik(unittest.TestCase):\n    def test_toplam(self):\n        self.assertEqual(6, toplam(2, 4))\n\nif __name__ == "__main__":\n    unittest.main()\n', 'utf8')

// Masaüstü senaryo dosyası: gerçek masaüstü yolu (sabit C:\ varsayımı yok).
const desktopProbeFile = 'ultron-denetim-kit.txt'
const probeSecret = 'DENETIM-2026-X7'
const probeContent = `ULTRON DENETİM KİT DOSYASI. Gizli kod: ${probeSecret}. Bu satır doğrulama hedefidir.\n`
const desktopResult = await new Promise((resolve, reject) => {
  const proc = spawn('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { windowsHide: true })
  let out = ''
  proc.stdout.on('data', (chunk) => { out += String(chunk) })
  proc.on('error', reject)
  proc.on('close', () => resolve(out))
})
const desktopDir = String(desktopResult ?? '').split(/\r?\n/)[0]?.trim() ?? ''
if (desktopDir) await fs.writeFile(path.join(desktopDir, desktopProbeFile), probeContent, 'utf8')

const child = spawn(installedPath, [
  `--user-data-dir=${profilePath}`,
  `--remote-debugging-port=${debugPort}`,
  '--open-project', sandbox,
], { detached: true, stdio: 'ignore', windowsHide: true })

const waitPort = async () => {
  const net = await import('node:net')
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection(Number(debugPort), '127.0.0.1', () => { socket.end(); resolve() })
        socket.on('error', reject)
      })
      return
    } catch { await new Promise((resolve) => setTimeout(resolve, 500)) }
  }
  throw new Error('Denetim uygulaması CDP portu açılmadı')
}
await waitPort()

const results = { measuredAt: new Date().toISOString(), sandbox, desktopDir, checks: [], approvals: [], errors: [] }
let exitStatus = 0
const check = (id, detail) => { results.checks.push({ id, ok: true, detail }); console.log(`PASS ${id}: ${detail}`) }
const failCheck = (id, detail) => { results.checks.push({ id, ok: false, detail }); console.log(`FAIL ${id}: ${detail}`) }

const safeCommand = (command) => {
  const text = String(command ?? '')
  if (!/^(python3?|py|where|cmd \/c (python|py))/i.test(text.trim())) return false
  return !/(pip install|msiexec|reg add|netsh|rmdir|del \/|format|shutdown|taskkill|Remove-Item|Invoke-WebRequest|curl |bitsadmin|wmic|setx)/i.test(text)
}

try {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const page = browser.contexts()[0]?.pages()[0]
  assert.ok(page, 'Denetim penceresi açılmalı')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.getProject) && Boolean(document.querySelector('.app-shell')), null, { timeout: 90_000 })

  await page.evaluate(() => { window.__auditEvents = [] })
  await page.evaluate(() => { window.__auditUnlisten = window.kodAtolyesi.onEvent((event) => window.__auditEvents.push(event)) })
  const clearEvents = async () => { await page.evaluate(() => { window.__auditEvents = [] }) }
  const drainEvents = async () => await page.evaluate(() => [...(window.__auditEvents ?? [])])

  // Gerçek kullanıcı izin profili: editMode=review (düzeltme öneri olarak gelir), onaylı komutlar.
  await page.evaluate(() => window.kodAtolyesi.saveWorkspace({
    permissions: { mode: 'controlled', editMode: 'review', commandMode: 'confirm', allowPackageInstalls: false, allowSystemChanges: false },
  }))
  // Modelin masaüstü dosyasını okuyabilmesi için salt okunur kaynak kök (senaryo 2'ye gerekli).
  const injected = await page.evaluate((dir) => window.kodAtolyesi.saveWorkspace({
    resourceRoots: [{ id: 'audit-desktop', path: dir, recursive: true, access: 'read' }],
  }), desktopDir)
  results.desktopRootInjected = Boolean(injected)

  const chatInput = page.locator('.main-column textarea')
  const agentTask = async (text, timeoutMs = 8 * 60_000) => {
    await clearEvents()
    const sendAt = Date.now()
    await chatInput.fill(text)
    await chatInput.press('Enter')
    const deadline = Date.now() + timeoutMs
    let settled = false
    while (Date.now() < deadline) {
      await page.waitForTimeout(2_500)
      const tasks = await page.evaluate(() => window.kodAtolyesi.getTasks())
      for (const event of (await drainEvents()).filter((item) => item.type === 'approval')) {
        const request = event.request
        if (!request?.requestId) continue
        const approve = safeCommand(request.command)
        await page.evaluate((payload) => window.kodAtolyesi.resolveApproval(payload.id, payload.decision), { id: request.requestId, decision: approve ? { approved: true, scope: 'category', remember: true } : { approved: false, scope: 'operation', remember: false } })
        results.approvals.push({ task: text.slice(0, 50), command: String(request.command ?? '').slice(0, 160), decision: approve ? 'onaylandi' : 'reddedildi' })
      }
      const running = tasks.filter((task) => ['running', 'waiting_approval'].includes(task.status))
      settled = tasks.length > 0 && running.length === 0
      if (settled) break
    }
    const ms = Date.now() - sendAt
    const tasks = await page.evaluate(() => window.kodAtolyesi.getTasks())
    const latest = tasks[0]
    return {
      ms, settled,
      taskStatus: latest?.status ?? null,
      toolEvents: (latest?.events ?? []).filter((event) => event.type === 'tool').map((event) => `${event.name}:${event.status ?? ''}`),
      eventsAll: (await drainEvents()).map((event) => `${event.type}/${event.name ?? event.message ?? ''}:${event.status ?? ''}`).slice(-40),
      proposalsObserved: (await drainEvents()).filter((event) => event.type === 'proposal').map((event) => ({ id: event.proposal?.id ?? null, path: event.proposal?.path ?? null })),
      taskProposals: (latest?.events ?? []).filter((event) => event.type === 'proposal').map((event) => ({ id: event.id ?? event.proposal?.id ?? null, path: event.path ?? event.proposal?.path ?? null })),
      finalText: String((await page.locator('article.message.assistant .markdown-body').allTextContents()).at(-1) ?? '').slice(0, 900),
    }
  }

  // +---- SENARYO 1 (§6 + §7): yerel teşhis + internet araştırması + düzeltme önerisi ----+
  const s1 = await agentTask('aritmetik.py dosyasını çalıştır, çıkan ImportError hatası internette ne anlama geliyor araştır; sorunu çöz ve testleri çalıştır.', 9 * 60_000)
  results.researchScenario = s1
  const s1Joined = s1.toolEvents.join(' ')
  const s1All = [...s1.eventsAll, ...s1.toolEvents].join(' ')
  const webUsed = /web_search|fetch_web_page/.test(s1All)
  const readUsed = /read_file:completed/.test(s1Joined)
  const fixUsed = /apply_patch|write_file|propose_file_edit/.test(s1Joined)
  const testsUsed = /run_tests|run_command/.test(s1Joined)
  if (webUsed) check('audit-s1-web-research', `Web araştırma araç kanıtı var: ${s1All.match(/(?:web_search|fetch_web_page):?\S*/g)?.slice(0, 4).join(', ')}`)
  else failCheck('audit-s1-web-research', `Web kanıtı yok; toolEvents: ${s1Joined || 'boş'}; final: ${s1.finalText.slice(0, 160)}`)
  if (readUsed) check('audit-s1-local-diagnosis', 'Yerel teşhiste dosya gerçekten okundu')
  else failCheck('audit-s1-local-diagnosis', `read_file kanıtı yok: ${s1Joined}`)
  if (fixUsed) check('audit-s1-fix-effort', `Düzeltme girişimi kanıtlı: ${s1Joined.match(/(?:apply_patch|write_file|propose_file_edit):\S*/g)?.join(', ')}`)
  else failCheck('audit-s1-fix-effort', `Düzeltme kanıtı yok: ${s1Joined}`)
  if (testsUsed) check('audit-s1-tests-ran', 'Test/çalıştırma aracı kullanıldı')
  else failCheck('audit-s1-tests-ran', `Test kanıtı yok: ${s1Joined}`)
  if (s1.taskStatus === 'needs_review' || s1.taskStatus === 'completed') check('audit-s1-status-honest', `Görev durumu dürüst: ${s1.taskStatus}`)
  else failCheck('audit-s1-status-honest', `Beklenmeyen durum: ${s1.taskStatus}; final: ${s1.finalText.slice(0, 200)}`)

  // Öneri varsa GERÇEK kullanıcı eylemi gibi uygula (review modu: ajan dosyaya doğrudan yazamaz).
  const proposalId = (s1.proposalsObserved[0] ?? s1.taskProposals[0] ?? {}).id ?? null
  const proposalPath = (s1.proposalsObserved[0] ?? s1.taskProposals[0] ?? {}).path ?? null
  results.s1Proposal = { proposalId, proposalPath }
  if (proposalId) {
    const applied = await page.evaluate((id) => window.kodAtolyesi.applyProposal(id), proposalId)
    results.s1ProposalApplied = Boolean(applied?.ok ?? applied)
  } else {
    results.s1ProposalApplied = false
  }

  // Düzeltmenin gerçekten dosyaya yazıldığını disk üzerinden doğrula (aritmetik.py).
  const afterContent = await fs.readFile(path.join(sandbox, 'aritmetik.py'), 'utf8')
  const fixOnDisk = !/import jsonper/i.test(afterContent)
  results.s1FileAfter = { fixOnDisk, excerpt: afterContent.slice(0, 400) }
  if (fixOnDisk) check('audit-s7-fix-on-disk', 'Düzeltme gerçek dosyaya yazıldı (import jsonper gitti)')
  else failCheck('audit-s7-fix-on-disk', `Dosya hâlâ bozuk; öneri: ${JSON.stringify(results.s1Proposal)}`)

  // +---- SENARYO 2 (§8): çok adımlı masaüstü okuma görevi; yalnız okuma, yazma YOK ----+
  const s2 = await agentTask('masaüstündeki ultron-denetim-kit.txt dosyasını okup içeriğindeki gizli kodu bana bildir; yalnızca okuma yap.', 8 * 60_000)
  results.desktopReadScenario = s2
  const s2ReadOk = /read_file:completed/.test(s2.toolEvents.join(' ')) || s2.finalText.toLowerCase().includes(probeSecret.toLowerCase())
  const s2NoWrite = !/write_file:|apply_patch:/.test(s2.toolEvents.join(' '))
  const s2ReportsSecret = s2.finalText.toLowerCase().includes(probeSecret.toLowerCase())
  if (s2ReadOk) check('audit-s2-desktop-read', `Okuma kanıtı: ${s2.toolEvents.join(' ')}`)
  else failCheck('audit-s2-desktop-read', `Okuma kanıtı yok; final: ${s2.finalText.slice(0, 200)}`)
  if (s2NoWrite) check('audit-s2-no-mutation', 'Okuma istekte dosya mutasyonu yok')
  else failCheck('audit-s2-no-mutation', `Yazma kanıtı var: ${s2.toolEvents.join(' ')}`)
  if (s2ReportsSecret) check('audit-s2-content-accurate', 'Gizli kod gerçekten dosyadan okunarak raporlandı')
  else failCheck('audit-s2-content-accurate', `İçerik raporu eksik: ${s2.finalText.slice(0, 220)}`)

  // +---- SENARYO 3 (§5): masaüstü dosyasını OS düzeyinde açma ----+
  const s3 = await agentTask('masaüstündeki ultron-denetim-kit.txt dosyasını varsayılan uygulamayla aç.', 6 * 60_000)
  results.desktopOpenScenario = s3
  const s3OpenOk = /open_file:completed/.test(s3.toolEvents.join(' ')) && !/open_file:failed/.test(s3.toolEvents.join(' '))
  if (s3OpenOk) check('audit-s3-open-file-tool', `open_file kanıtı: ${s3.toolEvents.join(' ')}`)
  else failCheck('audit-s3-open-file-tool', `open_file kanıtı yok; final: ${s3.finalText.slice(0, 200)}`)
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  let notepadDetected = false
  try {
    const probeOutcome = await new Promise((resolve, reject) => {
      const proc = spawn('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Notepad.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"], { windowsHide: true })
      let out = ''
      proc.stdout.on('data', (chunk) => { out += String(chunk) })
      proc.on('error', reject)
      proc.on('close', () => resolve(out))
    })
    let parsed = []
    try { parsed = JSON.parse(String(probeOutcome ?? '').trim() || '[]') } catch { parsed = [] }
    const list = Array.isArray(parsed) ? parsed : parsed && parsed.ProcessId ? [parsed] : []
    const matched = list.filter((item) => String(item.CommandLine ?? '').includes(desktopProbeFile))
    notepadDetected = matched.length > 0
    for (const item of matched) {
      await new Promise((resolve) => spawn('taskkill', ['/PID', String(item.ProcessId), '/T', '/F'], { windowsHide: true }).on('close', resolve))
    }
  } catch (processError) {
    results.osProbeError = String(processError?.message ?? processError).slice(0, 200)
  }
  if (notepadDetected) check('audit-s3-os-open-real', 'OS düzeyinde Notepad süreci gerçekten başladı (CommandLine eşleşti) ve kapatıldı')
  else failCheck('audit-s3-os-open-real', `Notepad süreci tespit edilmedi; toolEvents: ${s3.toolEvents.join(' ')}`)

  // +---- SENARYO 4 (§5/§10): var olmayan dosyada dürüst hata ----+
  const s4 = await agentTask('masaüstündeki yok_dosya_denetim_2026.txt dosyasını aç.', 5 * 60_000)
  results.missingFileScenario = { ...s4, finalText: s4.finalText }
  const s4Honest = s4.taskStatus !== 'completed' || /bulunamadı|böyle bir dosya|yok|hata|dosya yok/i.test(s4.finalText)
  if (s4Honest) check('audit-s4-honest-miss', `Dürüst sonuç (${s4.taskStatus}): ${s4.finalText.slice(0, 180)}`)
  else failCheck('audit-s4-honest-miss', `Var olmayan dosya için tamamlanmış yanıtı verildi: ${s4.finalText.slice(0, 220)}`)

  // +---- SENARYO 5 (§7): düzeltilmiş dosyanın gerçek çıktısı (denetçinin ikincil doğrulaması) ----+
  // Düzeltme gerçekten işe yaradı mı? Doğrudan çalıştırma: import yaması sonrası script uçtan uca çalışabilmeli.
  const verifyProc = await new Promise((resolve, reject) => {
    const proc = spawn('python', ['aritmetik.py'], { cwd: sandbox, windowsHide: true })
    let out = ''
    proc.stdout.on('data', (chunk) => { out += String(chunk) })
    proc.stderr.on('data', (chunk) => { out += String(chunk) })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, out: out.slice(0, 800) }))
  })
  results.s5TestRun = verifyProc
  if (verifyProc.code === 0 && verifyProc.out.includes('toplam=6')) check('audit-s5-real-verification', `Düzeltilmiş script gerçekten çalıştı (kod 0): ${verifyProc.out.slice(0, 200)}`)
  else failCheck('audit-s5-real-verification', `Çalıştırma beklenen gibi değil (kod ${verifyProc.code}): ${verifyProc.out.slice(0, 300)}`)

  // +---- SENARYO 6 (§7): başarısız değişikliğin geri alınması ----+
  const undoOutcome = await page.evaluate(() => window.kodAtolyesi.undoLast())
  const contentAfterUndo = await fs.readFile(path.join(sandbox, 'aritmetik.py'), 'utf8')
  const undoRestored = /import jsonper/i.test(contentAfterUndo)
  results.s6Undo = { undoOutcome: String(undoOutcome?.ok ?? undoOutcome), undoRestored }
  if (undoRestored) check('audit-s7-undo-restored', 'undoLast gerçekten düzeltmeden önceki dosya içeriğine geri döndü')
  else failCheck('audit-s7-undo-restored', `Geri alma kanıtı yok; içerikte 'jsonper' bulunamadı`)

  // +---- SENARYO 7: çözüm hafızası canlı yazım kanıtı ----+
  const memoryCandidates = [
    path.join(profilePath, 'solution-memory.json'),
    path.join(profilePath, 'Ultron', 'solution-memory.json'),
  ]
  let memoryRaw = null
  for (const candidate of memoryCandidates) {
    const content = await fs.readFile(candidate, 'utf8').catch(() => null)
    if (content && content.length > 20) { memoryRaw = content; break }
  }
  results.s7MemoryFile = memoryRaw ? memoryRaw.slice(0, 800) : null
  if (memoryRaw) check('audit-s8-solution-memory-written', 'Çözüm hafızası userData dosyasına canlı yazıldı')
  else failCheck('audit-s8-solution-memory-written', `solution-memory.json bulunamadı; denenen yollar: ${memoryCandidates.join(' | ')}`)

  const screenshot = path.resolve('release', 'audit-live.png')
  await fs.mkdir(path.dirname(screenshot), { recursive: true })
  await page.screenshot({ path: screenshot })
  results.screenshot = screenshot
} catch (error) {
  exitStatus = 1
  results.errors.push(String(error?.message ?? error).slice(0, 600))
  console.error('AUDIT-LIVE-HATA:', error?.message ?? error)
} finally {
  exec(`taskkill /PID ${child.pid} /T /F`, { windowsHide: true }, () => undefined)
  const target = path.resolve('denetim', 'audit-live-result.json')
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
