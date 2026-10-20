import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { builtInToolExecutorNames, selectToolsForTask, taskCapabilitiesForRequest, toolsByCapability } from '../electron/tool-registry.ts'

const mainSource = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const registrySource = await readFile(new URL('../electron/tool-registry.ts', import.meta.url), 'utf8')
const verificationSource = await readFile(new URL('../electron/agent-verification.ts', import.meta.url), 'utf8')

function schemaNames() {
  const start = mainSource.indexOf('const agentTools = [')
  const endMarker = /\]\r?\n\r?\n\/\/ Yeni proje görevinde/.exec(mainSource.slice(start))
  const end = endMarker?.index === undefined ? -1 : start + endMarker.index
  assert.ok(start >= 0 && end > start, 'agentTools tanımı bulunmalı')
  return [...mainSource.slice(start, end).matchAll(/function:\s*\{\s*name:\s*'([^']+)'/g)].map((match) => match[1]).sort()
}

function executorNames() {
  const start = mainSource.indexOf('async function runTool(')
  const end = mainSource.indexOf('\nasync function captureVerificationSource', start)
  assert.ok(start >= 0 && end > start, 'runTool tanımı bulunmalı')
  return [...mainSource.slice(start, end).matchAll(/case '([^']+)'/g)].map((match) => match[1]).sort()
}

function schemaEntries() {
  const start = mainSource.indexOf('const agentTools = [')
  const endMarker = /\]\r?\n\r?\n\/\/ Yeni proje görevinde/.exec(mainSource.slice(start))
  const end = endMarker?.index === undefined ? -1 : start + endMarker.index
  assert.ok(start >= 0 && end > start, 'agentTools tanımı bulunmalı')
  const block = mainSource.slice(start, end)
  return [...block.matchAll(/function:\s*\{\s*name:\s*'([^']+)'[\s\S]*?parameters:\s*(\{[\s\S]*?)\s*\}\s*\}/g)].map((match) => ({ name: match[1], parameters: match[2] }))
}

function stringSetIn(source: string, marker: string) {
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `${marker} bulunmalı`)
  const end = source.indexOf('])', start)
  const block = source.slice(start, end)
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

test('yerleşik araç şemaları ve runTool yürütücüleri bire bir eşleşir', () => {
  const schemas = schemaNames()
  const executors = executorNames()
  assert.deepEqual(schemas, executors)
  assert.deepEqual([...builtInToolExecutorNames].sort(), executors)
})

test('araç adı tekrarı yoktur', () => {
  const schemas = schemaNames()
  assert.equal(new Set(schemas).size, schemas.length, 'Aynı araç adı birden fazla kez tanımlanmamalı')
  const executors = executorNames()
  assert.equal(new Set(executors).size, executors.length, 'Aynı yürütücü dalı birden fazla kez tanımlanmamalı')
})

test('yardımcı araç kayıtları yalnız var olan şemaları içerir', () => {
  const schemas = new Set(schemaNames())
  // Yeni proje iskeleti aracı listesi (main.ts)
  for (const name of stringSetIn(mainSource, 'const newProjectScaffoldToolNames = new Set([')) {
    assert.ok(schemas.has(name), `newProjectScaffoldToolNames içindeki "${name}" şeması yok`)
  }
  // Yetenek kaydındaki araç listeleri (tool-registry.ts)
  for (const [capability, names] of Object.entries(toolsByCapability)) {
    for (const name of names) {
      assert.ok(schemas.has(name), `${capability} yeteneğindeki "${name}" şeması yok`)
    }
  }
  // Doğrulama defteri araç kümeleri (agent-verification.ts)
  for (const marker of ['const commandTools = new Set([', 'const structuredTools = new Set([', 'const resultTools = new Set([', 'const approvalTools = new Set([']) {
    for (const name of stringSetIn(verificationSource, marker)) {
      assert.ok(schemas.has(name), `${marker} içindeki "${name}" şeması yok`)
    }
  }
  // Değişiklik üreten araç kümesi (main.ts)
  for (const name of stringSetIn(mainSource, 'const mutationTools = new Set([')) {
    assert.ok(schemas.has(name), `mutationTools içindeki "${name}" şeması yok`)
  }
})

test('her araç şeması açıklama ve nesne parametreleri taşır', () => {
  for (const entry of schemaEntries()) {
    assert.ok(entry.name.length > 0, 'Araç adı boş olamaz')
    assert.match(entry.parameters, /type:\s*'object'/, `${entry.name} şeması nesne tipinde olmalı`)
  }
  const start = mainSource.indexOf('const agentTools = [')
  const endMarker = /\]\r?\n\r?\n\/\/ Yeni proje görevinde/.exec(mainSource.slice(start))
  const block = mainSource.slice(start, endMarker?.index === undefined ? -1 : start + endMarker.index)
  const descriptions = [...block.matchAll(/name:\s*'([^']+)',\s*description:\s*'([^']*)'/g)]
  assert.equal(descriptions.length, schemaNames().length, 'Her araç için açıklama alanı bulunmalı')
  for (const [, name, description] of descriptions) {
    assert.ok(description.trim().length >= 10, `${name} açıklaması anlamlı düzeyde olmalı`)
  }
})

test('yetenek kaydındaki her araç tam olarak bir yeteneğe bağlıdır', () => {
  const capabilityMembers = Object.values(toolsByCapability).flat()
  assert.equal(new Set(capabilityMembers).size, capabilityMembers.length, 'Bir araç iki yeteneğe birden bağlanmamalı')
  const gated = new Set(capabilityMembers)
  const alwaysVisible = schemaNames().filter((name) => !gated.has(name))
  // Araştırma yeteneği her zaman etkindir: web araçları sürekli görünürdür.
  const alwaysActive = new Set(toolsByCapability.research ?? [])
  const expected = schemaNames().filter((name) => !gated.has(name) || alwaysActive.has(name))
  const tools = schemaNames().map((name) => ({ function: { name } }))
  assert.deepEqual(
    selectToolsForTask(tools, 'Bu istek hiçbir özel alana dair bir şey içermiyor').map((tool) => tool.function.name).sort(),
    expected.sort(),
    'Yetenek kapsamı dışındaki ve her zaman etkin yeteneklerin araçları görünür olmalı',
  )
})

test('bilgisayar erişim araçları (kapsam keşfi ve yetki isteme) her zaman görünür', () => {
  const tools = ['read_file', 'list_scopes', 'request_scope', 'find_files'].map((name) => ({ function: { name } }))
  // Kullanıcı klasörlerine erişim isteyen bir istekte bile kapsam araçları görünür kalmalı.
  const visible = selectToolsForTask(tools, 'Belgeler klasöründeki notu oku').map((tool) => tool.function.name).sort()
  assert.deepEqual(visible, ['find_files', 'list_scopes', 'read_file', 'request_scope'])
})

test('masaüstü kontrolü kapalıyken masaüstü araçları modele hiç gösterilmez', () => {
  const tools = ['read_file', 'desktop_state', 'desktop_launch_app', 'desktop_mouse_click'].map((name) => ({ function: { name } }))
  const request = 'Not Defteri uygulamasını aç ve fareye tıkla'
  assert.deepEqual(
    selectToolsForTask(tools, request, { desktopEnabled: true }).map((tool) => tool.function.name).sort(),
    ['desktop_launch_app', 'desktop_mouse_click', 'desktop_state', 'read_file'],
  )
  assert.deepEqual(
    selectToolsForTask(tools, request, { desktopEnabled: false }).map((tool) => tool.function.name),
    ['read_file'],
  )
  // Masaüstü kontrolü açıkken anahtar kelime şartı yoktur: opt-in tek başına yeterlidir.
  assert.deepEqual(
    selectToolsForTask(tools, 'Bugün hava nasıl, sadece bilgi ver', { desktopEnabled: true }).map((tool) => tool.function.name).sort(),
    ['desktop_launch_app', 'desktop_mouse_click', 'desktop_state', 'read_file'],
    'Masaüstü kontrolü açıkken masaüstü araçları her istekte görünür olmalı',
  )
})

test('görev yetenekleri araç görünürlüğünü merkezi kayıttan belirler', () => {
  const tools = ['read_file', 'project_scaffold', 'list_project_templates', 'create_android_project', 'web_search'].map((name) => ({ function: { name } }))
  // NOT: web_search her zaman görünür (araştırma yeteneği daima etkin).
  assert.deepEqual(selectToolsForTask(tools, 'Yeni bir proje iskeleti oluştur ve şablonları göster').map((tool) => tool.function.name), ['read_file', 'project_scaffold', 'list_project_templates', 'web_search'])
  assert.deepEqual(selectToolsForTask(tools, 'Android APK uygulaması geliştir').map((tool) => tool.function.name), ['read_file', 'create_android_project', 'web_search'])
  assert.ok(taskCapabilitiesForRequest('Güncel hata çözümünü internette araştır').has('research'))
  // Web araştırma araçları artık anahtar kelimeye bağlı DEĞİLDİR: her istekte görünür
  // kalır, böylece ajan "web erişimim yok" demeye çalışmaz.
  assert.deepEqual(
    selectToolsForTask(tools, 'Bir dosyadaki fonksiyonu incele').map((tool) => tool.function.name).sort(),
    ['read_file', 'web_search'],
    'Web araçları her istekte görünür olmalı',
  )
})

test('hiçbir araç erişilemez kalmaz: her yetenek gerçek bir istekle açılabilir', () => {
  const allTools = schemaNames().map((name) => ({ function: { name } }))
  const triggerRequests: Record<string, string> = {
    android: 'Android APK uygulaması yap',
    web: 'React web sitesi ve REST API kur',
    windows: 'Windows masaüstü uygulaması paketle',
    research: 'bu hatanın nedenini internette araştır',
    network: 'ağ envanteri ve port taraması yap',
    rename: 'dosya adını değiştir',
    delete: 'bu dosyayı sil',
    powershell: 'registry kayıtlarını powershell ile oku',
    logs: 'uygulama log dosyasını analiz et',
    'file-discovery': 'pdf dosyalarını bul',
    'duplicate-discovery': 'yinelenen kopya dosyaları bul',
    'file-index': 'dosya indeksini yenile',
    'software-inventory': 'kurulu yazılımları listele',
    'app-adapter': 'git ve npm adaptörlerini çalıştır',
    'capability-check': 'eksik yetenekleri kontrol et',
    'project-scaffold': 'şablonlardan yeni proje iskeleti oluştur',
    desktop: 'Not Defteri uygulamasını aç ve pencereye tıkla',
  }
  for (const [capability, names] of Object.entries(toolsByCapability)) {
    const request = triggerRequests[capability]
    assert.ok(request, `${capability} yeteneği için tetikleyici istek tanımlı olmalı`)
    const visible = selectToolsForTask(allTools, request).map((tool) => tool.function.name)
    for (const name of names) {
      assert.ok(visible.includes(name), `${capability} yeteneği "${request}" isteğiyle açılmalı (${name})`)
    }
  }
})

test('dosya oluşturan araçlar gerçek dosya değişikliği olarak sayılır', () => {
  // Bu listede olmayan bir oluşturma aracı, dosyaları yazsa bile ajan
  // "hiçbir dosya değişikliği yapılmadı" sanıp görevi başarısız işaretler.
  const fileCreatingTools = schemaNames().filter((name) => name.startsWith('create_') || name === 'project_scaffold')
  assert.ok(fileCreatingTools.length > 0, 'Dosya oluşturan araç listesi boş olmamalı')
  const marker = "if (['propose_file_edit', 'write_file', 'apply_patch'"
  const start = mainSource.indexOf(marker)
  assert.ok(start >= 0, 'Dosya değişikliği sayımı bulunmalı')
  const end = mainSource.indexOf('].includes(call.function.name)', start)
  const block = mainSource.slice(start, end)
  for (const name of fileCreatingTools) {
    assert.ok(block.includes(`'${name}'`), `'${name}' gerçek dosya değişikliği olarak sayılmalı`)
  }
})
