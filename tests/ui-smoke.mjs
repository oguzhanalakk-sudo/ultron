import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = path.resolve(process.env.UI_SMOKE_PROJECT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'demo'))
const deferFixtureCleanup = process.env.UI_SMOKE_DEFER_CLEANUP === '1'
const debugPort = process.env.UI_SMOKE_DEBUG_PORT || '9222'
const fixtureFile = path.join(project, 'index.js')
const externalResource = path.join(project, '..', 'resource-scope-fixture')
const original = await fs.readFile(fixtureFile, 'utf8')
let mockChatResolve
const mockChatSeen = new Promise((resolve) => { mockChatResolve = resolve })
let mockPauseResolve
const mockPauseSeen = new Promise((resolve) => { mockPauseResolve = resolve })
const mockModelServer = createServer((request, response) => {
  if (request.method === 'GET' && request.url?.endsWith('/api/tags')) {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ models: [{ name: 'smoke-agent-model' }] }))
    return
  }
  if (request.method === 'POST' && request.url?.endsWith('/api/chat')) {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      mockChatResolve(true)
      let payload = {}
      try { payload = JSON.parse(body) } catch { response.writeHead(400).end(); return }
      const messages = payload.messages ?? []
      const userRequest = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
      const send = (events, delay = 0) => {
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        const write = () => { for (const event of events) response.write(`${JSON.stringify(event)}\n`); response.end() }
        if (delay) { const timer = setTimeout(write, delay); response.on('close', () => clearTimeout(timer)) } else write()
      }
      const toolEvent = (name, args) => ({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] }, done: true })
      const contentEvents = (text) => [{ message: { role: 'assistant', content: text }, done: true }]
      if (userRequest.includes('model-failure')) {
        response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Controlled model service failure' }))
        return
      }
      if (userRequest.includes('grouped-web-project')) {
        const recent = messages.slice(messages.findLastIndex((message) => message.role === 'user') + 1)
        const completed = recent.filter((message) => message.role === 'tool').length
        const step = completed === 0 ? ['create_web_project', { folder: 'grouped-smoke', project_name: 'Gruplu Smoke Projesi' }] : null
        send(step ? [toolEvent(step[0], step[1])] : contentEvents('Başlangıç projesi oluşturuldu.'))
        return
      }
      if (userRequest.includes('model-recovered')) {
        send(contentEvents('Model bağlantısı düzeldi.'))
        return
      }
      if (/freshness-(stale|recheck|missing|excluded)/.test(userRequest)) {
        const recent = messages.slice(messages.findLastIndex((message) => message.role === 'user') + 1)
        const completed = recent.filter((message) => message.role === 'tool').length
        const editPath = userRequest.includes('freshness-excluded') ? 'coverage/verification-source.cjs' : 'verification-fail.cjs'
        const steps = userRequest.includes('freshness-recheck') ? [
          ['run_tests', { command: 'node verification-ok.cjs' }],
        ] : userRequest.includes('freshness-missing') ? [
          ['set_task_plan', { title: 'Eksik kabul kontrolü', objective: 'Çalıştırılmayan testi başarı sayma', steps: ['Doğrula'], tests: ['node verification-ok.cjs'] }],
          ['update_task_step', { step: 1, status: 'done' }],
        ] : [
          ['set_task_plan', { title: 'Güncel kanıt kontrolü', objective: 'Değişen kaynağı yeniden doğrula', steps: ['Doğrula'], tests: ['node verification-ok.cjs'] }],
          ['run_tests', { command: 'node verification-ok.cjs' }],
          ['read_file', { path: editPath }],
          ['apply_patch', { path: editPath, old_text: 'process.exitCode = 1', new_text: 'process.exitCode = 0', description: 'Testten sonra kaynağı değiştir' }],
          ['update_task_step', { step: 1, status: 'done' }],
        ]
        const step = steps[completed]
        send(step ? [toolEvent(step[0], step[1])] : contentEvents('Tüm testler geçti, görev tamamlandı.'))
        return
      }
      if (/verification-(fail|recover|invalid)/.test(userRequest)) {
        const recent = messages.slice(messages.findLastIndex((message) => message.role === 'user') + 1)
        const completed = recent.filter((message) => message.role === 'tool').length
        const steps = userRequest.includes('verification-invalid') ? [
          ['run_tests', { command: 123 }],
          ['run_tests', { command: 'node verification-ok.cjs' }],
        ] : userRequest.includes('verification-recover') ? [
          ['read_file', { path: 'verification-fail.cjs' }],
          ['apply_patch', { path: 'verification-fail.cjs', old_text: 'process.exitCode = 1', new_text: 'process.exitCode = 0', description: 'Başarısız test fikstürünü düzelt' }],
          ['run_tests', { command: 'node verification-fail.cjs' }],
          ['run_tests', { command: 'node verification-ok.cjs' }],
        ] : [
          ['run_tests', { command: 'node verification-fail.cjs' }],
          ['run_tests', { command: 'node verification-ok.cjs' }],
        ]
        const step = steps[completed]
        send(step ? [toolEvent(step[0], step[1])] : contentEvents('Tüm kontroller başarılı, görev tamamlandı.'))
        return
      }
      if (userRequest.includes('Duraklatma smoke görevi')) {
        mockPauseResolve(true)
        send(contentEvents('Duraklatma testi yanıtı'), 15_000)
        return
      }
      if (userRequest.includes('new-app-calculator')) {
        // Plan isteği: yeni proje için iki adımlı plan döndür.
        if (userRequest.includes('JSON formatında plan üret')) {
          send(contentEvents(JSON.stringify({ title: 'Hesap makinesi', objective: 'Yeni hesap makinesi uygulamasını oluştur ve test et', steps: ['Uygulama dosyasını oluştur', 'Test ile doğrula'], tests: [] })))
          return
        }
        const recent = messages.slice(messages.findLastIndex((message) => message.role === 'user') + 1)
        const completed = recent.filter((message) => message.role === 'tool').length
        if (completed === 0) {
          // Regresyon sinyali: eski sohbet bağlamı sızarsa veya keşif araçları
          // hâlâ sunulursa read_file ile karşılık ver; senaryo write_file bekler.
          const offered = new Set((payload.tools ?? []).map((tool) => tool.function?.name))
          const contaminated = messages.some((message) => typeof message.content === 'string' && /grouped-web-project|Mock ajan|Yerel Qwen|index\.js dosyasındaki combine/.test(message.content))
          if (contaminated || offered.has('read_file') || offered.has('list_files')) {
            send([toolEvent('read_file', { path: 'index.js' })])
            return
          }
          send([toolEvent('write_file', { path: 'hesap-makinesi/hesap-makinesi.js', content: "function topla(a, b) { return a + b }\nconsole.log(topla(2, 3) === 5 ? 'Hesap makinesi OK' : 'HATA')\n" })])
          return
        }
        const steps = [
          ['run_tests', { command: 'node hesap-makinesi/hesap-makinesi.js' }],
          ['update_task_step', { step: 1, status: 'done' }],
          ['update_task_step', { step: 2, status: 'done' }],
        ]
        const step = steps[completed - 1]
        send(step ? [toolEvent(step[0], step[1])] : contentEvents('Hesap makinesi oluşturuldu ve test edildi.'))
        return
      }
      const hasRead = messages.some((message) => message.role === 'tool' && message.tool_name === 'read_file')
      const hasProposal = messages.some((message) => message.role === 'tool' && message.tool_name === 'propose_file_edit')
      if (!hasProposal) {
        const step = hasRead
          ? ['propose_file_edit', { path: 'index.js', description: 'combine iki sayıyı toplasın', old_text: 'return a - b', new_text: 'return a + b' }]
          : ['read_file', { path: 'index.js' }]
        send([toolEvent(step[0], step[1])])
        return
      }
      send(contentEvents('index.js için toplama işlemini hazırladım. Değişiklik taslağı incelemeye hazır.'))
    })
    return
  }
  response.writeHead(404).end()
})
await new Promise((resolve, reject) => { mockModelServer.once('error', reject); mockModelServer.listen(0, '127.0.0.1', resolve) })
const mockPort = mockModelServer.address().port
if (!deferFixtureCleanup) {
  await fs.rm(path.join(project, '.codex-local'), { recursive: true, force: true })
  await fs.rm(externalResource, { recursive: true, force: true })
}
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
try {
  const context = browser.contexts()[0]
  const page = context.pages()[0]
  assert.ok(page, 'Electron penceresi açılmalı')
  await page.waitForFunction(() => Boolean(window.kodAtolyesi?.getProject), null, { timeout: 20_000 })
  await page.waitForFunction(() => document.querySelector('.app-shell'), null, { timeout: 20_000 })
  const opened = await page.evaluate(() => window.kodAtolyesi.getProject())
  assert.equal(opened?.path, project, 'CLI ile seçilen proje yüklenmeli')
  const environmentSecret = 'SMOKE_PRIVATE_TOKEN_VALUE'
  await fs.writeFile(path.join(project, '.env'), `API_TOKEN=${environmentSecret}\n`, 'utf8')
  await fs.writeFile(path.join(project, '.env.example'), 'API_TOKEN=replace-me\n', 'utf8')
  const environmentSecretBlocked = await page.evaluate(async () => {
    try { await window.kodAtolyesi.readFile('.env'); return false }
    catch { return true }
  })
  assert.equal(environmentSecretBlocked, true, 'Hassas .env içeriği renderer ve modele açılmamalı')
  assert.equal(await page.evaluate(() => window.kodAtolyesi.readFile('.env.example')), 'API_TOKEN=replace-me\n', 'Güvenli .env.example dosyası okunabilmeli')
  assert.equal(JSON.stringify(await page.evaluate(() => window.kodAtolyesi.getWorkspace())).includes(environmentSecret), false, 'Gizli örnek değer çalışma alanına yazılmamalı')
  const fileWindow = await page.evaluate(() => window.open('file:///C:/Windows/win.ini'))
  assert.equal(fileWindow, null, 'Uygulama yeni pencerelerde dosya URLsi açmamalı')
  await page.waitForFunction(async () => (await window.kodAtolyesi.getStatus()).connected, null, { timeout: 15_000, polling: 500 })
  const modelStatus = await page.evaluate(() => window.kodAtolyesi.getStatus())
  assert.equal(modelStatus.connected, true, 'Yerel Ollama bağlantısı çalışmalı')
  assert.ok(modelStatus.models.includes('qwen3:8b'), 'Kurulu yerel model listelenmeli')
  await page.evaluate(() => window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://127.0.0.1:1/v1', model: 'qwen3:8b' }))
  const disconnected = await page.evaluate(() => window.kodAtolyesi.getStatus())
  assert.equal(disconnected.connected, false, 'Model servisi kapalı olduğunda bağlantı hatası raporlanmalı')
  await page.evaluate(() => window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' }))
  assert.equal((await page.evaluate(() => window.kodAtolyesi.getStatus())).connected, true, 'Çalışan Ollama ayarı tekrar bağlanmalı')

  const workspaceBeforeLocalAgent = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  const smokeRunId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await page.evaluate(() => {
    window.__smokeEvents = []
    window.__smokeUnlisten?.()
    window.__smokeUnlisten = window.kodAtolyesi.onEvent((event) => window.__smokeEvents.push(event))
  })
  const localAgentRequest = `Yerel Qwen gerçek araç düzenleme smoke görevi ${smokeRunId}: index.js dosyasındaki combine fonksiyonunu çıkarma yerine toplama yapacak şekilde düzelt. Önce read_file ile dosyayı oku, sonra propose_file_edit ile sadece diff taslağı hazırla; diskteki dosyayı değiştirme ve terminal komutu çalıştırma.`
  const localAgentMessages = [...workspaceBeforeLocalAgent.messages, { role: 'user', content: localAgentRequest }].slice(-100)
  await page.evaluate((messages) => { void window.kodAtolyesi.sendMessage(messages) }, localAgentMessages)
  let localAgentTask
  try {
    localAgentTask = await page.evaluate(async ({ request, timeoutMs }) => {
      const startedAt = Date.now()
      let matching = []
      while (Date.now() - startedAt < timeoutMs) {
        const tasks = await window.kodAtolyesi.getTasks()
        matching = tasks.filter((task) => task.request.includes(request))
        const finished = matching.find((task) => ['completed', 'failed'].includes(task.status))
        if (finished) return finished
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      return { status: 'timeout', matching }
    }, { request: localAgentRequest, timeoutMs: 240_000 })
    assert.equal(localAgentTask.status, 'completed', `Yerel Qwen görevi tamamlanmalı: ${JSON.stringify(localAgentTask)}`)
    assert.ok(Array.isArray(localAgentTask.usedTools) && localAgentTask.usedTools.includes('read_file'), `Yerel Qwen read_file aracını kullanmalı; görev: ${JSON.stringify(localAgentTask)}`)
    assert.ok(localAgentTask.usedTools.includes('propose_file_edit'), `Yerel Qwen gerçek değişiklik taslağı hazırlamalı; görev: ${JSON.stringify(localAgentTask)}`)
    const localProposals = await page.evaluate(() => window.__smokeEvents.filter((event) => event.type === 'proposal').map((event) => event.proposal))
    const localProposal = localProposals.find((proposal) => proposal.path === 'index.js' && /a \+ b/.test(proposal.newContent))
    assert.ok(localProposal, `Yerel Qwen toplama değişikliği için uygulanabilir taslak hazırlamalı: ${JSON.stringify(localProposals)}`)
    assert.equal(localProposal.oldContent, original, 'Yerel Qwen taslağı gerçek dosyanın mevcut içeriğini temel almalı')
    assert.equal(await fs.readFile(fixtureFile, 'utf8'), original, 'Taslak hazırlanırken gerçek dosya değişmemeli')
    const localApplied = await page.evaluate((id) => window.kodAtolyesi.applyProposal(id), localProposal.id)
    assert.equal(localApplied.ok, true, localApplied.message)
    assert.match(await fs.readFile(fixtureFile, 'utf8'), /a \+ b/, 'Yerel model taslağı kullanıcı onayıyla gerçek dosyaya uygulanmalı')
    const userEdit = original.replace('return a - b', 'return a * b')
    await fs.writeFile(fixtureFile, userEdit, 'utf8')
    const protectedUndo = await page.evaluate(() => window.kodAtolyesi.undoLast())
    assert.equal(protectedUndo.ok, false, 'Kullanıcının sonradan değiştirdiği dosya geri alma ile ezilmemeli')
    assert.match(protectedUndo.message, /ezmemek|değişti/, 'Reddedilen geri alma güvenli nedeni açıklamalı')
    assert.equal(await fs.readFile(fixtureFile, 'utf8'), userEdit, 'Reddedilen geri alma kullanıcı düzenlemesini korumalı')
    await fs.writeFile(fixtureFile, localProposal.newContent, 'utf8')
    const localUndo = await page.evaluate(() => window.kodAtolyesi.undoLast())
    assert.equal(localUndo.ok, true, localUndo.message)
    assert.equal(await fs.readFile(fixtureFile, 'utf8'), original, 'Yerel model değişikliği yedekten geri alınabilmeli')
  } finally {
    await page.evaluate((workspace) => window.kodAtolyesi.saveWorkspace({ messages: workspace.messages }), workspaceBeforeLocalAgent)
  }

  // Basit metin dosyası istekleri modelin araç çağrısına bağlı olmadan gerçek diskte tamamlanmalı.
  const localTextFile = `ultron-local-text-${smokeRunId}.txt`
  const localTextPath = path.join(project, localTextFile)
  try {
    const createRequest = `${localTextFile} dosyasını oluştur ve içine Merhaba yaz.`
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), createRequest)
    assert.equal(await fs.readFile(localTextPath, 'utf8'), 'Merhaba', 'Yerel metin yönlendiricisi dosyayı gerçek diskte oluşturup içeriği doğrulamalı')
    const createReply = (await page.evaluate(() => window.kodAtolyesi.getWorkspace())).messages.at(-1)?.content ?? ''
    assert.match(createReply, /oluşturuldu ve doğrulandı/i, 'Dosya oluşturma sonucu kullanıcıya açıklanmalı')

    const readRequest = `${localTextFile} dosyasını oku.`
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), readRequest)
    const readReply = (await page.evaluate(() => window.kodAtolyesi.getWorkspace())).messages.at(-1)?.content ?? ''
    assert.match(readReply, /Merhaba/, 'Dosya okuma isteği gerçek dosya içeriğini sohbet yanıtına koymalı')

    const replaceRequest = `${localTextFile} dosyasındaki Merhaba kelimesini Selam olarak değiştir.`
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), replaceRequest)
    const localTextProposal = await page.evaluate(() => window.__smokeEvents.filter((event) => event.type === 'proposal').at(-1)?.proposal)
    assert.equal(localTextProposal?.path, localTextFile, 'Proje içindeki metin değişikliği inceleme taslağı olmalı')
    assert.equal(localTextProposal?.newContent, 'Selam', 'Taslak yalnızca istenen metni değiştirmeli')
    const applied = await page.evaluate((id) => window.kodAtolyesi.applyProposal(id), localTextProposal.id)
    assert.equal(applied.ok, true, applied.message)
    assert.equal(await fs.readFile(localTextPath, 'utf8'), 'Selam', 'Onaylanan metin değişikliği gerçek diskte doğrulanmalı')
  } finally {
    await fs.rm(localTextPath, { force: true })
  }

  // Ultron sohbet modu: görev kaydı oluşturmadan doğal yanıt ve yerel hafıza denetimleri
  const tasksBeforeChat = await page.evaluate(() => window.kodAtolyesi.getTasks())
  const chatBefore = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  const chatMessages = [...chatBefore.messages, { role: 'user', content: 'Merhaba Ultron, kısaca nasılsın?' }].slice(-100)
  await page.evaluate((messages) => window.kodAtolyesi.sendMessage(messages), chatMessages)
  const chatWorkspace = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  const chatReply = chatWorkspace.messages.at(-1)
  assert.equal(chatReply?.role, 'assistant', 'Sohbet mesajına asistan yanıtı gelmeli')
  assert.ok(chatReply.content.trim().length > 10, `Sohbet yanıtı boş olmamalı: ${JSON.stringify(chatReply).slice(0, 200)}`)
  const tasksAfterChat = await page.evaluate(() => window.kodAtolyesi.getTasks())
  assert.equal(tasksAfterChat.length, tasksBeforeChat.length, 'Sohbet modu görev kaydı oluşturmamalı')
  assert.equal(tasksAfterChat.some((task) => task.request.includes('nasılsın')), false, 'Sohbet isteği görev geçmişine yazılmamalı')

  const voiceStatus = await page.evaluate(() => window.kodAtolyesi.getVoiceStatus())
  assert.equal(typeof voiceStatus.available, 'boolean', 'Ses durumu raporlanmalı')
  assert.ok(Array.isArray(voiceStatus.speechToText) && Array.isArray(voiceStatus.textToSpeech), 'Ses araç denetimleri listelenmeli')
  assert.ok(voiceStatus.note.length > 10, 'Ses durumu açıklaması bulunmalı')

  const memoryBefore = await page.evaluate(() => window.kodAtolyesi.getUserMemory())
  assert.equal(memoryBefore.version, 1, 'Yerel hafıza sürümlü yapıda olmalı')
  const memoryAdded = await page.evaluate(() => window.kodAtolyesi.addUserMemory({ kind: 'preference', text: 'Smoke testi: yanıtları kısa tut.' }))
  assert.ok(['added', 'merged', 'conflict'].includes(memoryAdded.action), 'Hafıza kaydı eklenmeli')
  const memoryAfterAdd = await page.evaluate(() => window.kodAtolyesi.getUserMemory())
  const smokeEntry = memoryAfterAdd.entries.find((entry) => entry.text === 'Smoke testi: yanıtları kısa tut.')
  assert.ok(smokeEntry, 'Eklenen hafıza kaydı listede görünmeli')
  const memoryUpdated = await page.evaluate((id) => window.kodAtolyesi.updateUserMemory(id, { text: 'Smoke testi: kısa yanıt tercih edilir.' }), smokeEntry.id)
  assert.equal(memoryUpdated.text, 'Smoke testi: kısa yanıt tercih edilir.', 'Hafıza kaydı düzenlenebilmeli')
  await page.evaluate((id) => window.kodAtolyesi.deleteUserMemory(id), smokeEntry.id)
  const memoryAfterDelete = await page.evaluate(() => window.kodAtolyesi.getUserMemory())
  assert.equal(memoryAfterDelete.entries.some((entry) => entry.id === smokeEntry.id), false, 'Hafıza kaydı silinebilmeli')

  const rememberRequest = `Şunu hatırla: smoke hafıza kontrolü ${smokeRunId}.`
  const rememberBefore = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  const rememberMessages = [...rememberBefore.messages, { role: 'user', content: rememberRequest }].slice(-100)
  await page.evaluate((messages) => window.kodAtolyesi.sendMessage(messages), rememberMessages)
  const memoryAfterRemember = await page.evaluate(() => window.kodAtolyesi.getUserMemory())
  const rememberEntries = memoryAfterRemember.entries.filter((entry) => entry.text.includes(smokeRunId))
  assert.ok(rememberEntries.length > 0, 'Açık "hatırla" isteği yerel hafızaya kaydedilmeli')
  for (const entry of rememberEntries) await page.evaluate((id) => window.kodAtolyesi.deleteUserMemory(id), entry.id)

  // Otomatik öğrenme açıkken düzeltme geri bildirimi yerel hafızaya alınmalı
  await page.evaluate((profile) => window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b', profile }), { name: '', instructions: '', autoLearn: true })
  try {
    const feedbackRequest = `Bu cevap yanlış, doğrusu şu: önce soruyu netleştirmelisin ${smokeRunId}.`
    const feedbackBefore = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
    const feedbackMessages = [...feedbackBefore.messages, { role: 'user', content: feedbackRequest }].slice(-100)
    await page.evaluate((messages) => window.kodAtolyesi.sendMessage(messages), feedbackMessages)
    const memoryAfterFeedback = await page.evaluate(() => window.kodAtolyesi.getUserMemory())
    const feedbackEntries = memoryAfterFeedback.entries.filter((entry) => entry.kind === 'feedback' && entry.text.includes(smokeRunId))
    assert.ok(feedbackEntries.length > 0, `Otomatik öğrenme açıkken düzeltme geri bildirimi hafızaya kaydedilmeli: ${JSON.stringify(memoryAfterFeedback.entries.map((entry) => ({ kind: entry.kind, text: entry.text.slice(0, 80) })))}`)
    for (const entry of feedbackEntries) await page.evaluate((id) => window.kodAtolyesi.deleteUserMemory(id), entry.id)
  } finally {
    await page.evaluate(() => window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b', profile: { name: '', instructions: '', autoLearn: false } }))
  }

  await page.locator('.right-tabs button', { hasText: 'Hafıza' }).click()
  await page.waitForSelector('.memory-panel', { timeout: 10_000 })
  assert.equal(await page.locator('.memory-panel').count(), 1, 'Kişisel hafıza paneli açılmalı')

  // ---- Sağ panel daraltma/genişletme ----
  const expandedWidth = await page.locator('.right-sidebar').evaluate((node) => Math.round(node.getBoundingClientRect().width))
  assert.ok(expandedWidth > 300, `Yan panel geniş hâlde olmalı, ölçülen: ${expandedWidth}`)
  const expandedTabCount = await page.locator('.right-tabs-scroll button').count()
  await page.locator('.right-collapse').click()
  await page.waitForSelector('.right-rail', { timeout: 5_000 })
  const collapsedWidth = await page.locator('.right-sidebar').evaluate((node) => Math.round(node.getBoundingClientRect().width))
  assert.ok(collapsedWidth <= 60, `Daraltılmış yan panel dar olmalı, ölçülen: ${collapsedWidth}`)
  assert.equal(await page.locator('.right-rail .rail-tab').count(), expandedTabCount, 'Daraltılmış şeritte tüm sekmeler bulunmalı')
  assert.equal(await page.locator('.right-tabs').count(), 0, 'Daraltılmış durumda geniş sekme çubuğu görünmemeli')
  // Şeritten bir sekme seçilince panel açılıp o sekmeye geçmeli.
  await page.locator('.right-rail .rail-tab').nth(3).click()
  await page.waitForSelector('.right-tabs', { timeout: 5_000 })
  const reopenedWidth = await page.locator('.right-sidebar').evaluate((node) => Math.round(node.getBoundingClientRect().width))
  assert.ok(reopenedWidth > 300, `Şeritten seçim paneli yeniden genişletmeli, ölçülen: ${reopenedWidth}`)
  const activeTabLabel = await page.locator('.right-tabs button.active').first().textContent()
  assert.ok(activeTabLabel?.includes('Web'), `Şeritten seçilen sekme etkin olmalı, gelen: ${activeTabLabel}`)
  // Daraltma tercihi yeniden açılışta korunmalı.
  await page.locator('.right-collapse').click()
  await page.waitForSelector('.right-rail', { timeout: 5_000 })
  assert.equal(await page.evaluate(() => window.localStorage.getItem('ultron.rightPanelCollapsed')), '1', 'Daraltma durumu kalıcı saklanmalı')
  await page.locator('.rail-expand').click()
  await page.waitForSelector('.right-tabs', { timeout: 5_000 })

  // ---- Dosyalar paneli: gerçek dosya keşfi ----
  await page.locator('.right-tabs button', { hasText: 'Dosyalar' }).click()
  await page.waitForSelector('.files-body', { timeout: 10_000 })
  const fileSearchOutcome = await page.evaluate(async () => {
    const result = await window.kodAtolyesi.runFileSearch('index.js dosyalarını bul', '')
    return { hits: result.hits?.length ?? 0, firstName: result.hits?.[0]?.name ?? '', summary: result.summary ?? '' }
  })
  assert.ok(fileSearchOutcome.hits >= 1, 'Dosya araması gerçek eşleşme dönmeli (fixture index.js)')
  assert.ok(fileSearchOutcome.firstName.includes('index.js'), `İlk sonuç index.js olmalı, gelen: ${fileSearchOutcome.firstName}`)
  assert.ok(fileSearchOutcome.summary.trim().length > 0, 'Özet boş olmamalı')
  const indexedSearchOutcome = await page.evaluate(async () => {
    const index = await window.kodAtolyesi.refreshFileIndex('')
    const result = await window.kodAtolyesi.runFileSearch('index.js dosyalarını bul', '')
    return { entries: index.entries ?? 0, notices: result.notices ?? [], durationMs: result.durationMs ?? -1 }
  })
  assert.ok(indexedSearchOutcome.entries >= 1, 'Hızlı arama için proje dosya indeksi oluşturulmalı')
  assert.ok(indexedSearchOutcome.notices.some((notice) => /hızlı sonuç/i.test(notice)), `Yenilenmiş indeksle arama yapılmalı: ${JSON.stringify(indexedSearchOutcome)}`)
  const fileScopes = await page.evaluate(() => window.kodAtolyesi.listFileScopes())
  assert.ok(fileScopes.project && fileScopes.project.label.includes('Proje'), 'Proje kapsamı sunulmalı')

  // ---- Yazılımlar paneli: gerçek envanter ----
  await page.locator('.right-tabs button', { hasText: 'Yazılımlar' }).click()
  await page.waitForSelector('.software-list', { timeout: 30_000 })
  const softwareOverview = await page.evaluate(async () => {
    const catalog = await window.kodAtolyesi.getSoftwareCatalog()
    const adapters = await window.kodAtolyesi.listAppAdapters()
    const capability = await window.kodAtolyesi.checkCapability('pdf')
    return {
      catalogEntries: catalog.catalog.entries.length,
      adapterIds: adapters.adapters.map((a) => a.id),
      capabilityHandled: capability.handled === true,
    }
  })
  assert.ok(softwareOverview.catalogEntries >= 1, `Yazılım kataloğu boş olmamalı (gelen: ${softwareOverview.catalogEntries})`)
  assert.ok(softwareOverview.adapterIds.includes('git'), 'git adaptörü envanterde olmalı')
  assert.equal(softwareOverview.capabilityHandled, true, 'pdf gereksinim analizi desteklenmeli')
  const softwareRowsOnUi = await page.locator('.software-row').count()
  assert.ok(softwareRowsOnUi >= 1, 'Yazılım listesi arayüzde kayıt göstermeli')

  // ---- Eklentiler paneli: kurulu-olmayan durum + API çalışıyor olmalı ----
  await page.locator('.right-tabs button', { hasText: 'Eklentiler' }).click()
  await page.waitForSelector('.plugin-note', { timeout: 10_000 })
  const pluginOverview = await page.evaluate(async () => {
    try { await window.kodAtolyesi.enablePlugin('olmayan-eklenti'); return { rejected: false } } catch { return { rejected: true } }
  })
  assert.equal(pluginOverview.rejected, true, 'Kurulu olmayan eklentinin etkinleştirilmesi reddedilmeli')
  const pluginsListed = await page.evaluate(() => window.kodAtolyesi.listPlugins())
  assert.ok(Array.isArray(pluginsListed.plugins), 'Eklenti listesi dizide dönmeli')

  await page.locator('.right-tabs button', { hasText: 'Değişiklikler' }).click()

  const tree = await page.evaluate(() => window.kodAtolyesi.getTree())
  assert.ok(tree.some((node) => node.name === 'index.js'), 'Dosya ağacı projedeki dosyayı göstermeli')
  const remoteEndpointRejected = await page.evaluate(async () => {
    try { await window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://api.example.com/v1', model: 'smoke-agent-model' }); return false }
    catch { return true }
  })
  assert.equal(remoteEndpointRejected, true, 'Uzak/bulut model adresi reddedilmeli')
  const cloudProviderRejected = await page.evaluate(async () => {
    try { await window.kodAtolyesi.saveSettings({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: 'x' }); return false }
    catch { return true }
  })
  assert.equal(cloudProviderRejected, true, 'Bulut/OpenAI sağlayıcısı reddedilmeli')
  await page.locator('.top-icon[title="Ayarlar"]').click()
  await page.locator('#base-url').fill(`http://127.0.0.1:${mockPort}/v1`)
  await page.locator('#model-name').fill('smoke-agent-model')
  await page.locator('#profile-name').fill('Smoke Kullanıcı')
  await page.locator('#profile-instructions').fill('Kısa ve doğrudan yanıt ver.')
  assert.equal(await page.locator('#api-key').count(), 0, 'API anahtarı alanı bulunmamalı')
  await page.locator('#profile-autolearn').check()
  await page.getByRole('button', { name: /Ayarları kaydet/ }).click()
  await page.locator('.settings-modal').waitFor({ state: 'hidden' })
  const savedLocalSettings = await page.evaluate(() => window.kodAtolyesi.getSettings())
  assert.equal(savedLocalSettings.provider, 'ollama', 'Yalnızca yerel Ollama sağlayıcısı kullanılmalı')
  assert.equal(savedLocalSettings.baseUrl, `http://127.0.0.1:${mockPort}/v1`, 'Yerel model adresi kaydedilmeli')
  assert.equal(savedLocalSettings.profile.name, 'Smoke Kullanıcı', 'Kişisel ad yerel ayarlarda saklanmalı')
  assert.equal(savedLocalSettings.profile.instructions, 'Kısa ve doğrudan yanıt ver.', 'Kişisel talimatlar yerel ayarlarda saklanmalı')
  assert.equal(savedLocalSettings.profile.autoLearn, true, 'Otomatik öğrenme kullanıcı onayıyla açılabilmeli')
  await page.evaluate((baseUrl) => window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl, model: 'smoke-agent-model', profile: { name: 'Smoke Kullanıcı', instructions: 'Kısa ve doğrudan yanıt ver.', autoLearn: false } }), `http://127.0.0.1:${mockPort}/v1`)
  const resetSettings = await page.evaluate(() => window.kodAtolyesi.getSettings())
  assert.equal(resetSettings.profile.autoLearn, false, 'Otomatik öğrenme kullanıcı tarafından kapatılabilmeli')
  assert.equal(resetSettings.profile.name, 'Smoke Kullanıcı', 'Otomatik öğrenme kapatılırken profil korunmalı')
  const beforeConcurrentSave = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  const concurrentMessages = [...beforeConcurrentSave.messages, { role: 'user', content: 'parallel-persistence-smoke' }].slice(-100)
  const concurrentMemory = { ...beforeConcurrentSave.memory, summary: 'parallel-persistence-smoke' }
  await Promise.all([
    page.evaluate((messages) => window.kodAtolyesi.saveWorkspace({ messages }), concurrentMessages),
    page.evaluate((memory) => window.kodAtolyesi.saveWorkspace({ memory }), concurrentMemory),
  ])
  const afterConcurrentSave = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  assert.equal(afterConcurrentSave.messages.at(-1)?.content, 'parallel-persistence-smoke', 'Eşzamanlı çalışma alanı kayıtları sohbeti korumalı')
  assert.equal(afterConcurrentSave.memory.summary, 'parallel-persistence-smoke', 'Eşzamanlı çalışma alanı kayıtları proje hafızasını korumalı')
  await page.evaluate((workspace) => window.kodAtolyesi.saveWorkspace({ messages: workspace.messages, memory: workspace.memory }), beforeConcurrentSave)
  await page.getByRole('button', { name: 'Web', exact: true }).click()
  await page.getByRole('button', { name: 'Analizi başlat' }).click()
  await page.getByText('tarama dosyası', { exact: false }).waitFor({ timeout: 5_000 })
  const webAnalysis = await page.evaluate(() => window.kodAtolyesi.analyzeWebProject())
  assert.ok(webAnalysis.filesScanned >= 1, 'Web paneli gerçek proje dosyalarını yerel olarak taramalı')
  await page.getByRole('button', { name: 'Windows', exact: true }).click()
  await page.getByText('Windows masaüstü araçları', { exact: true }).waitFor({ timeout: 5_000 })
  const windowsEnvironment = await page.evaluate(() => window.kodAtolyesi.getWindowsEnvironment())
  assert.ok(windowsEnvironment.os.includes('Windows'), 'Windows paneli gerçek işletim sistemi bilgisini göstermeli')
  assert.ok(windowsEnvironment.cpuCores > 0 && windowsEnvironment.memoryTotalBytes > 0, 'Windows paneli CPU ve bellek bilgisini denetlemeli')
  assert.ok(windowsEnvironment.checks.some((check) => check.id === 'node' && check.state === 'available'), 'Windows paneli Node.js kullanılabilirliğini sürüm sorgusuyla doğrulamalı')
  assert.ok(windowsEnvironment.checks.some((check) => check.id === 'npm' && check.state === 'available' && check.path?.toLowerCase().endsWith('.cmd')), 'Windows paneli npm için çalıştırılabilir .cmd sarmalayıcısını seçmeli')
  // Ayarlar bölümü mock sunucuyu test etmişti; Yerel AI panelini gerçek Ollama kataloğuyla doğrula.
  await page.evaluate(() => window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' }))
  await page.locator('.right-tabs button', { hasText: 'Yerel AI' }).click()
  await page.getByText('Yerel AI çekirdeği', { exact: true }).waitFor({ timeout: 10_000 })
  const localAiStatus = await page.evaluate(() => window.kodAtolyesi.getLocalAIStatus())
  assert.equal(localAiStatus.provider, 'ollama', 'Yerel AI paneli yalnızca Ollama sağlayıcısını kullanmalı')
  assert.equal(localAiStatus.connected, true, 'Yerel AI paneli çalışan Ollama bağlantısını raporlamalı')
  assert.ok(localAiStatus.models.some((model) => model.name === 'qwen3:8b'), `Yerel AI paneli kurulu qwen3:8b modelini listelemeli: ${JSON.stringify({ connected: localAiStatus.connected, baseUrl: localAiStatus.baseUrl, note: localAiStatus.note, models: localAiStatus.models })}`)
  assert.ok(localAiStatus.models.every((model) => model.sizeBytes > 0), 'Yerel AI paneli model boyutlarını gerçek katalogdan okumalı')
  assert.ok(localAiStatus.models.every((model) => ['gpu', 'partial', 'cpu', 'too-large', 'unknown'].includes(model.fit.level)), 'Her model için donanım uyum tahmini üretilmeli')
  assert.ok(localAiStatus.hardware.cpuCores > 0 && localAiStatus.hardware.memoryTotalBytes > 0, 'Yerel AI paneli gerçek CPU ve RAM ölçümü yapmalı')
  assert.ok(localAiStatus.hardware.detectedAt, 'Donanım ölçümü zaman damgası taşımalı')
  await page.locator('.localai-model').first().waitFor({ timeout: 5_000 })
  assert.ok(await page.locator('.localai-fit').count() > 0, 'Model uyum açıklaması arayüzde görünmeli')

  await fs.mkdir(externalResource, { recursive: true })
  await fs.writeFile(path.join(externalResource, 'shared.txt'), 'authorized resource\n', 'utf8')
  await page.evaluate((resource) => window.kodAtolyesi.saveWorkspace({ resourceRoots: [resource] }), { id: 'smoke-resource', path: externalResource, recursive: true, access: 'read' })
  const scopedTree = await page.evaluate(() => window.kodAtolyesi.getTree())
  assert.ok(scopedTree.some((node) => node.path === '@resource/smoke-resource'), 'Yetkili ek klasör dosya ağacında görünmeli')
  assert.equal(await page.evaluate(() => window.kodAtolyesi.readFile('@resource/smoke-resource/shared.txt')), 'authorized resource\n', 'Ajan yalnızca açıkça eklenen kaynak klasörünü okuyabilmeli')
  const outsideBlocked = await page.evaluate(async (outsidePath) => {
    try { await window.kodAtolyesi.readFile(outsidePath); return false }
    catch { return true }
  }, path.join(project, '..', 'outside-scope.txt'))
  assert.equal(outsideBlocked, true, 'Yetkisiz mutlak dosya yolu reddedilmeli')
  await page.evaluate(() => window.kodAtolyesi.saveWorkspace({ resourceRoots: [] }))
  const revokedBlocked = await page.evaluate(async () => {
    try { await window.kodAtolyesi.readFile('@resource/smoke-resource/shared.txt'); return false }
    catch { return true }
  })
  assert.equal(revokedBlocked, true, 'Kaldırılan kaynak kapsamı anında etkisiz olmalı')

  await page.evaluate(() => {
    window.__smokeUnlisten?.()
    window.__smokeEvents = []
    window.__smokeUnlisten = window.kodAtolyesi.onEvent((event) => window.__smokeEvents.push(event))
  })
  await page.evaluate((config) => window.kodAtolyesi.saveSettings(config), { provider: 'ollama', baseUrl: `http://127.0.0.1:${mockPort}/v1`, model: 'smoke-agent-model' })
  const mockAgentRequest = `Mock ajan smoke görevi ${smokeRunId}: Lütfen index.js dosyasını oku. combine fonksiyonu toplama yapmalı ama şu anda çıkarıyor. Dosyayı düzelten bir taslak hazırla; dosyayı doğrudan yazma ve terminal çalıştırma.`
  await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), mockAgentRequest)
  await Promise.race([mockChatSeen, new Promise((_, reject) => setTimeout(() => reject(new Error('Mock kodlama modeli çağrılmadı.')), 10_000))])
  const taskRecords = await page.evaluate(() => window.kodAtolyesi.getTasks())
  const mockAgentTask = taskRecords.find((task) => task.request.includes(smokeRunId) && task.request.includes('Mock ajan smoke görevi'))
  assert.ok(mockAgentTask, 'Mock ajan görevi kalıcı görev günlüğüne yazılmalı')
  if (mockAgentTask.status !== 'completed') {
    console.log(JSON.stringify({ task: { status: mockAgentTask.status, stage: mockAgentTask.stage, errorAnalysis: mockAgentTask.errorAnalysis, errors: mockAgentTask.errors }, tools: mockAgentTask.usedTools }, null, 2))
  }
  assert.equal(mockAgentTask.status, 'completed', 'Tamamlanan ajan dönüşü doğru durumla saklanmalı')
  assert.ok(mockAgentTask.usedTools.includes('read_file'), 'Gerçek dosya okuması görev kaydına bağlanmalı')
  assert.ok(mockAgentTask.events.some((event) => event.type === 'tool' && event.status === 'completed'), 'Araç sonucu görev geçmişinde bulunmalı')
  const proposals = await page.evaluate(() => window.__smokeEvents.filter((event) => event.type === 'proposal').map((event) => event.proposal))
  const persistedMessages = await page.evaluate(() => window.kodAtolyesi.getWorkspace().then((state) => state.messages))
  await page.evaluate(() => { window.__smokeEvents = [] })
  const pauseRequest = `Duraklatma smoke görevi ${smokeRunId}: bu model isteğini beklerken görevi duraklat.`
  try {
    await page.evaluate(({ messages, request }) => { void window.kodAtolyesi.sendMessage([...messages, { role: 'user', content: request }]) }, { messages: persistedMessages, request: pauseRequest })
    await page.waitForFunction(async (request) => (await window.kodAtolyesi.getTasks()).some((task) => task.request.includes(request) && task.status === 'running' && task.events.some((event) => event.name === 'task-started')), pauseRequest, { timeout: 10_000 })
    let waitTimer
    const modelRequestArrived = await Promise.race([mockPauseSeen, new Promise((resolve) => { waitTimer = setTimeout(() => resolve(false), 10_000) })])
    clearTimeout(waitTimer)
    assert.equal(modelRequestArrived, true, 'Yapay zekâ isteği kontrollü yerel model ucuna ulaşmalı')
    assert.equal((await page.evaluate(() => window.kodAtolyesi.pauseAgent())).ok, true, 'Çalışan ajan görevi duraklatma isteğini kabul etmeli')
    await page.waitForFunction(async (request) => (await window.kodAtolyesi.getTasks()).some((task) => task.request.includes(request) && task.status === 'paused' && task.stage === 'paused'), pauseRequest, { timeout: 10_000 })
    const pausedTask = await page.evaluate(async (request) => (await window.kodAtolyesi.getTasks()).find((task) => task.request.includes(request)), pauseRequest)
    assert.equal(pausedTask?.stage, 'paused', 'Duraklatılan görev aşaması kalıcı günlükte tutulmalı')
  } finally {
    await page.evaluate(() => window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' }))
  }
  if (proposals.length !== 1) console.log(JSON.stringify({ proposals: proposals.map((proposal) => ({ id: proposal.id, path: proposal.path, description: proposal.description })), tools: await page.evaluate(() => window.__smokeEvents.filter((event) => event.type === 'activity').map((event) => event.item.title)), messages: await page.locator('.markdown-body').allTextContents() }, null, 2))
  assert.equal(proposals.length, 1, 'Ajan bir dosya değişikliği taslağı hazırlamalı')
  assert.equal(await fs.readFile(path.join(project, 'index.js'), 'utf8'), original, 'Taslak hazırlanırken gerçek dosya değişmemeli')

  const applied = await page.evaluate((id) => window.kodAtolyesi.applyProposal(id), proposals[0].id)
  assert.equal(applied.ok, true, applied.message)
  assert.match(await fs.readFile(path.join(project, 'index.js'), 'utf8'), /a \+ b/, 'Onaylanan taslak gerçek dosyaya yazılmalı')
  const backups = await fs.readdir(path.join(project, '.codex-local', 'backups'))
  assert.ok(backups.length >= 2, 'Her uygulanan taslak için dosya yedeği oluşturulmalı')

  const undo = await page.evaluate(() => window.kodAtolyesi.undoLast())
  assert.equal(undo.ok, true, undo.message)
  assert.equal(await fs.readFile(path.join(project, 'index.js'), 'utf8'), original, 'Geri alma eski dosya içeriğini döndürmeli')

  const workspaceBeforeGroupedProject = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  await page.evaluate((config) => window.kodAtolyesi.saveSettings(config), { provider: 'ollama', baseUrl: `http://127.0.0.1:${mockPort}/v1`, model: 'smoke-agent-model' })
  await page.evaluate((permissions) => window.kodAtolyesi.saveWorkspace({ permissions }), { ...workspaceBeforeGroupedProject.permissions, editMode: 'automatic' })
  const groupedRequest = `grouped-web-project ${smokeRunId}: Yeni web başlangıç projesini oluştur.`
  try {
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), groupedRequest)
    await page.waitForFunction(async (request) => {
      const task = (await window.kodAtolyesi.getTasks()).find((item) => item.request === request)
      return Boolean(task && !['pending', 'running', 'awaiting_approval'].includes(task.status))
    }, groupedRequest, { timeout: 30_000 })
    const groupedTask = await page.evaluate(async (request) => (await window.kodAtolyesi.getTasks()).find((item) => item.request === request), groupedRequest)
    assert.ok(groupedTask?.usedTools.includes('create_web_project'), 'Otomatik başlangıç üretimi gerçek web proje aracını kullanmalı')
    const groupedReadme = path.join(project, 'web-projects', 'grouped-smoke', 'README.md')
    assert.equal(await fs.stat(groupedReadme).then(() => true, () => false), true, 'Grup içindeki proje dosyaları otomatik modda yazılmalı')
    const groupedUndo = await page.evaluate(() => window.kodAtolyesi.undoLast())
    assert.equal(groupedUndo.ok, true, groupedUndo.message)
    assert.match(groupedUndo.message, /dosyalık işlem grubu/, 'Tek geri alma tüm otomatik proje üretim grubunu kapsamalı')
    assert.equal(await fs.stat(groupedReadme).then(() => true, () => false), false, 'Grup geri alındığında tüm proje dosyaları kaldırılmalı')
  } finally {
    await page.evaluate((workspace) => window.kodAtolyesi.saveWorkspace({ permissions: workspace.permissions }), workspaceBeforeGroupedProject)
    await page.evaluate(() => window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' }))
  }

  // Regresyon: eski proje bağlamı taşıyan çalışma alanında yeni uygulama isteği,
  // ilk dosya yazılmadan keşif araçlarını görmemeli ve doğrudan write_file üretmeli.
  const workspaceBeforeCalculator = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  await page.evaluate((config) => window.kodAtolyesi.saveSettings(config), { provider: 'ollama', baseUrl: `http://127.0.0.1:${mockPort}/v1`, model: 'smoke-agent-model' })
  await page.evaluate((permissions) => window.kodAtolyesi.saveWorkspace({ permissions }), { ...workspaceBeforeCalculator.permissions, editMode: 'automatic', commandMode: 'automatic' })
  const calculatorRequest = `new-app-calculator ${smokeRunId}: bir hesap makinesi uygulaması yapalım`
  try {
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), calculatorRequest)
    await page.waitForFunction(async (request) => {
      const task = (await window.kodAtolyesi.getTasks()).find((item) => item.request === request)
      return Boolean(task && !['pending', 'running', 'awaiting_approval'].includes(task.status))
    }, calculatorRequest, { timeout: 30_000 })
    const calculatorTask = await page.evaluate(async (request) => (await window.kodAtolyesi.getTasks()).find((item) => item.request === request), calculatorRequest)
    if (calculatorTask.status !== 'completed') {
      console.log(JSON.stringify({ calculatorTask: { status: calculatorTask.status, stage: calculatorTask.stage, errorAnalysis: calculatorTask.errorAnalysis, errors: calculatorTask.errors }, tools: calculatorTask.usedTools }, null, 2))
    }
    assert.ok(calculatorTask.usedTools.includes('write_file'), `Yeni uygulama isteği gerçek write_file çağrısıyla dosya üretmeli: ${JSON.stringify(calculatorTask.usedTools)}`)
    assert.equal(calculatorTask.usedTools.includes('read_file'), false, 'Yeni proje kapsamı ilk yazımdan önce eski proje okumalarına izin vermemeli')
    assert.equal(calculatorTask.usedTools.includes('list_files'), false, 'Yeni proje kapsamı eski proje ağacını listelememeli')
    assert.equal(calculatorTask.status, 'completed', `Yeni uygulama görevi tamamlanmalı: ${JSON.stringify({ status: calculatorTask.status, errorAnalysis: calculatorTask.errorAnalysis, errors: calculatorTask.errors })}`)
    const calculatorFile = path.join(project, 'hesap-makinesi', 'hesap-makinesi.js')
    assert.equal(await fs.stat(calculatorFile).then(() => true, () => false), true, 'Hesap makinesi dosyası otomatik modda yazılmalı')
    const calculatorUndo = await page.evaluate(() => window.kodAtolyesi.undoLast())
    assert.equal(calculatorUndo.ok, true, calculatorUndo.message)
    assert.equal(await fs.stat(calculatorFile).then(() => true, () => false), false, 'Geri alma hesap makinesi dosyasını kaldırmalı')
  } finally {
    await page.evaluate((workspace) => window.kodAtolyesi.saveWorkspace({ permissions: workspace.permissions }), workspaceBeforeCalculator)
    await page.evaluate(() => window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' }))
  }

  const beforeManualTask = await page.evaluate(async (request) => (await window.kodAtolyesi.getTasks()).find((task) => task.request.includes(request)), pauseRequest)
  assert.equal(beforeManualTask?.status, 'paused', 'Elle terminal kullanımı öncesinde ajan görevi duraklatılmış olmalı')
  await page.evaluate(async (taskId) => {
    const project = await window.kodAtolyesi.getProject()
    await window.kodAtolyesi.saveWorkspace({ permissionGrants: [{ id: 'paused-task-grant', scope: 'task', category: 'development', projectPath: project.path, taskId, createdAt: new Date().toISOString(), label: 'Duraklatılmış görev izni' }] })
  }, beforeManualTask.id)
  await page.evaluate(() => window.kodAtolyesi.runCommand('npm --version'))
  await page.waitForFunction(() => window.__smokeEvents.some((event) => event.type === 'approval'), null, { timeout: 5_000 })
  const request = await page.evaluate(() => window.__smokeEvents.find((event) => event.type === 'approval').request)
  assert.equal(request.taskId, undefined, 'Elle terminal komutu önceki ajan görevine bağlanmamalı ve onun görev iznini kullanmamalı')
  await page.waitForFunction(() => document.querySelector('.approval-card select option[value="task"]')?.disabled === true, null, { timeout: 5_000 })
  assert.equal(await page.locator('.approval-card select option[value="task"]').first().evaluate((option) => option.disabled), true, 'Bağımsız terminal komutunda görev boyunca izni kapalı olmalı')
  await page.waitForFunction(() => {
    const history = document.querySelector('.task-history')
    return history && history.clientHeight >= history.scrollHeight - 1 && history.clientHeight > 30
  }, null, { timeout: 5_000 })
  await page.locator('.task-history button').first().scrollIntoViewIfNeeded()
  assert.equal((await page.evaluate((id) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.id === id)), beforeManualTask.id)).status, 'paused', 'Komut onayı beklemek duraklatılan görevi yeniden açmamalı')
  await page.evaluate(() => window.kodAtolyesi.saveWorkspace({ permissionGrants: [] }))
  assert.match(await page.locator('.approval-card p').first().innerText(), /kimlik bilgisi olabilecek ortam değişkenleri alt süreçten ayıklanır/i, 'Komut onayı ortam değişkeni filtrelemesini ve kalan erişim sınırını açıklamalı')
  assert.equal(request.category, 'development', 'Onay isteği doğru işlem kategorisini taşımalı')
  await page.evaluate((id) => window.kodAtolyesi.resolveApproval(id, { approved: true, scope: 'category', remember: true }), request.requestId)
  await page.waitForFunction(() => window.__smokeEvents.some((event) => event.type === 'command-output' && event.text.includes('[çıkış kodu: 0]')), null, { timeout: 20_000 })
  const afterGrant = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  assert.equal(afterGrant.permissionGrants.length, 1, 'Açıkça istenen kalıcı kategori izni saklanmalı')
  assert.equal(afterGrant.permissionGrants[0].category, 'development', 'Kategori izni yalnızca onaylanan komut sınıfını kapsamalı')
  assert.equal(afterGrant.permissionGrants[0].projectPath, '*', 'Kalıcı kategori izni kullanıcı kapsamındaki izin deposunda saklanmalı')
  await page.evaluate(() => window.kodAtolyesi.runCommand('npm --version'))
  await page.waitForFunction(() => window.__smokeEvents.filter((event) => event.type === 'command-output' && event.text.includes('[çıkış kodu: 0]')).length >= 2, null, { timeout: 20_000 })
  await fs.writeFile(path.join(project, 'env-probe.cjs'), "process.stdout.write(process.env.KODATOLYESI_SMOKE_API_TOKEN ? 'credential-env-present' : 'credential-env-filtered')\n", 'utf8')
  await page.evaluate(() => window.kodAtolyesi.runCommand('node env-probe.cjs'))
  await page.waitForFunction(() => window.__smokeEvents.some((event) => event.type === 'command-output' && event.text.includes('credential-env-filtered')), null, { timeout: 20_000 })
  assert.equal(await page.evaluate(() => window.__smokeEvents.some((event) => event.type === 'command-output' && event.text.includes('credential-env-present'))), false, 'Kimlik bilgisi ortam değişkeni onaylanan ajan komutuna aktarılmamalı')
  await page.evaluate(() => window.kodAtolyesi.runCommand('npm run kod-atolyesi-smoke-missing-script'))
  await page.waitForFunction(() => window.__smokeEvents.some((event) => event.type === 'command-output' && event.text.includes('[çıkış kodu: 1]')), null, { timeout: 20_000 })
  const failedBuild = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  assert.equal(failedBuild.lastBuild?.exitCode, 1, 'Başarısız komut gizlenmemeli; çıkış kodu saklanmalı')
  const revokedWorkspace = await page.evaluate(() => window.kodAtolyesi.saveWorkspace({ permissionGrants: [] }))
  assert.equal(revokedWorkspace.permissionGrants.length, 0, 'Kalıcı izin listeden çıkarılınca iptal edilmeli')
  assert.equal(await page.evaluate(() => window.__smokeEvents.filter((event) => event.type === 'approval').length), 1, 'Kaydedilmiş kategori izni aynı projedeki geliştirme komutunu onaysız çalıştırmalı')

  await page.evaluate(() => window.kodAtolyesi.runCommand('npm install kod-atolyesi-smoke-nonexistent-package-xyz'))
  await page.waitForFunction(() => window.__smokeEvents.filter((event) => event.type === 'approval').length >= 2, null, { timeout: 5_000 })
  const rejectedRequest = await page.evaluate(() => window.__smokeEvents.filter((event) => event.type === 'approval').at(-1).request)
  assert.equal(rejectedRequest.category, 'package', 'Paket kurulumu ayrı izin kategorisi istemeli')
  await page.evaluate((id) => window.kodAtolyesi.resolveApproval(id, { approved: false, scope: 'operation', remember: false }), rejectedRequest.requestId)

  await page.evaluate(() => window.kodAtolyesi.runCommand('winget --version'))
  await page.waitForFunction(() => window.__smokeEvents.filter((event) => event.type === 'approval').length >= 3, null, { timeout: 5_000 })
  const cancelledRequest = await page.evaluate(() => window.__smokeEvents.filter((event) => event.type === 'approval').at(-1).request)
  await page.evaluate((id) => window.kodAtolyesi.cancelCommand(id), cancelledRequest.requestId)
  await page.evaluate(() => window.kodAtolyesi.runCommand('node -e "setInterval(process.cwd,1000)"'))
  await page.waitForFunction(() => window.__smokeEvents.filter((event) => event.type === 'approval').length >= 4, null, { timeout: 5_000 })
  const longRequest = await page.evaluate(() => window.__smokeEvents.filter((event) => event.type === 'approval').at(-1).request)
  await page.evaluate((id) => { void window.kodAtolyesi.resolveApproval(id, { approved: true, scope: 'operation', remember: false }) }, longRequest.requestId)
  await page.waitForFunction((id) => window.__smokeEvents.some((event) => event.type === 'command-status' && event.requestId === id && event.status === 'running'), longRequest.requestId, { timeout: 5_000 })
  assert.equal((await page.evaluate((id) => window.kodAtolyesi.cancelCommand(id), longRequest.requestId)).ok, true, 'Çalışan işlem iptal isteğini kabul etmeli')
  await page.waitForFunction((id) => window.__smokeEvents.some((event) => event.type === 'command-status' && event.requestId === id && event.status === 'cancelled'), longRequest.requestId, { timeout: 10_000 })
  assert.equal((await page.evaluate(() => window.kodAtolyesi.getWorkspace())).lastBuild?.exitCode, -3, 'İptal edilen işlem tamamlandı gibi kaydedilmemeli')
  const blocked = await page.evaluate(async () => {
    try { await window.kodAtolyesi.runCommand('powershell') ; return false }
    catch { return true }
  })
  assert.equal(blocked, true, 'İzin listesinde olmayan kabuk komutları reddedilmeli')

  const savedWorkspace = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  const finalTasks = await page.evaluate(() => window.kodAtolyesi.getTasks())
  assert.equal(finalTasks.find((task) => task.id === beforeManualTask.id)?.status, 'paused', 'Terminal onayları ve iptallerinden sonra duraklatılan görev sürdürülebilir kalmalı')
  assert.equal(finalTasks.find((task) => task.id === mockAgentTask.id)?.status, 'completed', 'Elle terminal işlemleri tamamlanmış görevi değiştirmemeli')
  assert.equal(await page.locator('.approval-card').count(), 0, 'Çözümlenen onay kartları ana süreç olaylarıyla arayüzden kaldırılmalı')
  assert.ok((savedWorkspace.messages.at(-1)?.content ?? '').trim().length > 0, 'Sohbet yanıtı proje çalışma alanında kalıcı olmalı')
  const audit = await page.evaluate(() => window.kodAtolyesi.getAudit())
  assert.ok(audit.length >= 5, 'Dosya ve terminal işlemleri kalıcı denetim günlüğüne yazılmalı')
  assert.ok(audit.some((entry) => entry.title === 'Dosya okundu'), 'Denetim günlüğü dosya okuma olayını saklamalı')
  assert.ok(audit.some((entry) => entry.title === 'Son değişiklik geri alındı'), 'Denetim günlüğü geri alma olayını saklamalı')
  assert.ok(audit.some((entry) => entry.approvalOutcome === 'rejected' && entry.result === 'denied'), 'Denetim günlüğü reddedilen işlemi sınıflandırmalı')
  assert.ok(audit.some((entry) => entry.approvalOutcome === 'cancelled'), 'Denetim günlüğü iptal edilen işlemi sınıflandırmalı')

  const priorVerificationWorkspace = await page.evaluate(() => window.kodAtolyesi.getWorkspace())
  await fs.writeFile(path.join(project, 'verification-fail.cjs'), "console.log('verification fixture')\nprocess.exitCode = 1\n")
  await fs.writeFile(path.join(project, 'verification-ok.cjs'), "console.log('independent check passed')\n")
  try {
    await page.evaluate(async (port) => {
      await window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'smoke-agent-model' })
      await window.kodAtolyesi.saveWorkspace({ permissions: { mode: 'advanced', editMode: 'automatic', commandMode: 'automatic', allowPackageInstalls: false, allowSystemChanges: false } })
    }, mockPort)
    const request = `verification-fail ${smokeRunId}: Testleri çalıştır ve sonucu doğrula.`
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), request)
    const failedTask = await page.evaluate((request) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.request === request)), request)
    assert.equal(failedTask.status, 'failed', 'Modelin başarı iddiası ve ilgisiz başarılı test, başarısız testi gizleyemez')
    assert.equal(failedTask.verificationFailures.length, 1, 'Başarısız kontrol kalıcı görev kaydında tutulmalı')
    assert.match((await page.evaluate(() => window.kodAtolyesi.getWorkspace())).messages.at(-1).content, /Uygulama doğrulaması: Görev başarısız/, 'Model başarı iddia etse de uygulama gerçek sonucu sohbet kaydında açıklamalı')
    await page.waitForFunction(() => document.querySelector('.ready-chip')?.textContent?.includes('Başarısız'), null, { timeout: 5_000 })
    await page.evaluate(({ id, request }) => window.kodAtolyesi.resumeTask(id, [{ role: 'user', content: request }]), { id: failedTask.id, request: `verification-recover ${smokeRunId}: Test hatasını düzelt ve aynı kontrolü yeniden çalıştır.` })
    const recoveredTask = await page.evaluate((id) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.id === id)), failedTask.id)
    assert.equal(recoveredTask.status, 'completed', 'Ajan gerçek dosya düzeltmesi ve aynı başarılı kontrol sonrası görevi tamamlayabilmeli')
    assert.equal(recoveredTask.verificationFailures.length, 0)
    assert.ok(recoveredTask.events.some((event) => event.name === 'task-resumed'))
    assert.match(await fs.readFile(path.join(project, 'verification-fail.cjs'), 'utf8'), /process.exitCode = 0/)
    assert.equal((await page.evaluate(() => window.kodAtolyesi.undoLast())).ok, true)
    assert.match(await fs.readFile(path.join(project, 'verification-fail.cjs'), 'utf8'), /process.exitCode = 1/)

    const invalidRequest = `verification-invalid ${smokeRunId}: Test aracı parametresini düzeltip kontrolü çalıştır.`
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), invalidRequest)
    const invalidRecoveredTask = await page.evaluate((request) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.request === request)), invalidRequest)
    assert.equal(invalidRecoveredTask.status, 'completed', 'Geçersiz parametre düzeltildiğinde imkânsız eski kontrol kimliği görevi kilitlememeli')
    assert.equal(invalidRecoveredTask.verificationFailures.length, 0)
    assert.ok(invalidRecoveredTask.events.some((event) => event.name === 'run_tests' && event.status === 'failed'))

    const missingRequest = `freshness-missing ${smokeRunId}: Planın kabul komutunu doğrula.`
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), missingRequest)
    const missingTask = await page.evaluate((request) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.request === request)), missingRequest)
    assert.equal(missingTask.status, 'needs_review', `Modelin done beyanı çalıştırılmamış kabul testinin yerini tutamaz: ${JSON.stringify(missingTask)}`)
    assert.deepEqual(missingTask.acceptanceTests, ['node verification-ok.cjs'])
    assert.equal(missingTask.pendingSteps.length, 0)
    assert.match((await page.evaluate(() => window.kodAtolyesi.getWorkspace())).messages.at(-1).content, /1 kabul komutu/)
    const staleRequest = `freshness-stale ${smokeRunId}: Testleri çalıştır, kaynak sürümünü kontrol et.`
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), staleRequest)
    const staleTask = await page.evaluate((request) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.request === request)), staleRequest)
    assert.equal(staleTask.status, 'needs_review', 'Başarılı testten sonra değişen kaynak eski kanıtla tamamlanamaz')
    assert.equal(staleTask.verificationRequired, true)
    assert.equal(staleTask.verificationResults.length, 0)
    assert.equal(staleTask.verificationFailures[0].status, 'stale')
    assert.equal(staleTask.pendingSteps.length, 0)
    await page.getByRole('button', { name: 'İşlemler', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.task-verification-issue.stale')?.textContent?.includes('tekrar çalıştırılmalı'), null, { timeout: 5_000 })
    assert.equal(await page.locator('.task-status-badge.complete').count(), 0, 'Eski test kanıtıyla başarı rozeti gösterilmemeli')
    assert.equal((await page.evaluate(() => window.kodAtolyesi.getWorkspace())).task.status, 'complete', 'Kontrollü senaryo plan done iken gerçek görevin inceleme beklemesini sınamalı')
    // Open another task, then resume the older plan: acceptance commands must survive.
    await page.evaluate(() => window.kodAtolyesi.sendMessage([{ role: 'user', content: 'model-recovered: Ara görev.' }]))
    await page.evaluate(({ id, request }) => window.kodAtolyesi.resumeTask(id, [{ role: 'user', content: request }]), { id: staleTask.id, request: 'freshness-recheck: Aynı kabul kontrolünü güncel kaynakta yeniden çalıştır.' })
    const freshTask = await page.evaluate((id) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.id === id)), staleTask.id)
    assert.equal(freshTask.status, 'completed', 'Aynı test yeni kaynakta başarılı çalışınca görev tamamlanmalı')
    assert.deepEqual(freshTask.acceptanceTests, ['node verification-ok.cjs'])
    assert.equal(freshTask.verificationResults.length, 1)
    assert.equal(freshTask.verificationFailures.length, 0)
    assert.deepEqual((await page.evaluate(() => window.kodAtolyesi.getWorkspace())).task.tests, ['node verification-ok.cjs'])
    assert.equal((await page.evaluate(() => window.kodAtolyesi.undoLast())).ok, true)
    assert.match(await fs.readFile(path.join(project, 'verification-fail.cjs'), 'utf8'), /process.exitCode = 1/)
    await fs.mkdir(path.join(project, 'coverage'), { recursive: true })
    await fs.writeFile(path.join(project, 'coverage', 'verification-source.cjs'), 'process.exitCode = 1\n')
    const excludedRequest = `freshness-excluded ${smokeRunId}: Çıktı klasöründeki dosya değişikliğini doğrula.`
    await page.evaluate((request) => window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]), excludedRequest)
    const excludedTask = await page.evaluate((request) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.request === request)), excludedRequest)
    assert.equal(excludedTask.status, 'needs_review', 'Parmak izinden hariç yoldaki gerçek araç yazımı da eski kanıtı geçersizleştirmeli')
    assert.equal(excludedTask.verificationFailures[0].status, 'stale')
    assert.equal((await page.evaluate(() => window.kodAtolyesi.undoLast())).ok, true)
    await fs.rm(path.join(project, 'coverage', 'verification-source.cjs'), { force: true })
    const modelFailureRequest = `model-failure ${smokeRunId}: Model bağlantısını kontrol et.`
    const modelCallRejected = await page.evaluate(async (request) => {
      try { await window.kodAtolyesi.sendMessage([{ role: 'user', content: request }]); return false }
      catch { return true }
    }, modelFailureRequest)
    assert.equal(modelCallRejected, true, 'Kontrollü 503 model hatası başarılı yanıt sayılmamalı')
    const modelFailureTask = await page.evaluate((request) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.request === request)), modelFailureRequest)
    assert.equal(modelFailureTask.status, 'failed')
    await page.evaluate((id) => window.kodAtolyesi.resumeTask(id, [{ role: 'user', content: 'model-recovered: Model bağlantısını yeniden doğrula.' }]), modelFailureTask.id)
    assert.equal((await page.evaluate((id) => window.kodAtolyesi.getTasks().then((tasks) => tasks.find((task) => task.id === id)), modelFailureTask.id)).status, 'completed', 'Yeni başarılı model çağrısı önceki model bağlantı hatasını çözebilmeli')
  } finally {
    await page.evaluate(async (permissions) => {
      await window.kodAtolyesi.saveWorkspace({ permissions })
      await window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' })
    }, priorVerificationWorkspace.permissions)
    await fs.rm(path.join(project, 'verification-fail.cjs'), { force: true })
    await fs.rm(path.join(project, 'verification-ok.cjs'), { force: true })
  }

  const screenshot = path.resolve('release', 'ui-smoke.png')
  await fs.mkdir(path.dirname(screenshot), { recursive: true })
  await page.bringToFront()
  await page.screenshot({ path: screenshot })
  console.log(`UI smoke test passed. Screenshot: ${screenshot}`)
} finally {
  for (const page of browser.contexts().flatMap((context) => context.pages())) await page.close().catch(() => undefined)
  await browser.close()
  await new Promise((resolve) => mockModelServer.close(resolve))
  if (!deferFixtureCleanup) {
    await fs.writeFile(fixtureFile, original, 'utf8')
    await fs.rm(path.join(project, '.codex-local'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    await fs.rm(externalResource, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
