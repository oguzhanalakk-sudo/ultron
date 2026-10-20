// Ultron plugin-host: her etkin eklenti için fork edilen minimal CJS süreç.
// Eklenti kodu bu süreçte izole çalışır; ana süreç çağrı başına zaman aşımı
// uygular ve süreç kilitlenirse öldürebilir. Ağ erişimi v1'de tamamen kapalıdır:
// manifest 'network' izni alan eklenti bile bu sürümde ağ API'si elde etmez.
// Protokol (satır bazlı JSON mesajlar):
//   parent -> child : { type:'invoke', callId, tool, args }
//   child -> parent : { type:'ready', tools:[...], error? }
//                     { type:'result', callId, ok, result? , error? }
//                     { type:'fatal', error }
const fs = require('node:fs')
const path = require('node:path')

const pluginDir = process.argv[2] ?? ''
let manifest = null
let pluginModule = null
let storageFile = null

function sendReadyPayload(payload) {
  if (typeof process.send === 'function') process.send(payload)
}

function fail(message) {
  sendReadyPayload({ type: 'fatal', error: String(message).slice(0, 500) })
  process.exitCode = 1
}

function readStorage() {
  try {
    if (!storageFile || !fs.existsSync(storageFile)) return {}
    return JSON.parse(fs.readFileSync(storageFile, 'utf8'))
  } catch {
    return {}
  }
}

function writeStorage(map) {
  if (!storageFile) return false
  try {
    const dir = path.dirname(storageFile)
    fs.mkdirSync(dir, { recursive: true })
    const temp = `${storageFile}.tmp`
    fs.writeFileSync(temp, JSON.stringify(map, null, 1), 'utf8')
    fs.renameSync(temp, storageFile)
    return true
  } catch (error) {
    sendReadyPayload({ type: 'storage-error', error: String(error instanceof Error ? error.message : error).slice(0, 300) })
    return false
  }
}

try {
  if (!pluginDir) fail('pluginDir komut satırı argümanı ile verilmedi.')
  else {
    manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'))
    if (!manifest || typeof manifest.id !== 'string' || typeof manifest.entry !== 'string') {
      fail('manifest.json id/entry alanları geçersiz.')
    } else {
      const entryPath = path.resolve(pluginDir, manifest.entry)
      const scopedRoot = path.resolve(pluginDir)
      if (entryPath !== scopedRoot && !entryPath.startsWith(scopedRoot + path.sep)) {
        fail('entry plugin klasörü dışına çıkıyor; yol güvenlik ihlali.')
      } else {
        pluginModule = require(entryPath)
        if (!pluginModule || typeof pluginModule !== 'object' || !pluginModule.tools || typeof pluginModule.tools !== 'object') {
          fail('modül exports.tools nesnesi içermiyor (örn. exports.tools = { arac: async (args, api) => {...} }).')
        } else {
          storageFile = path.join(
            process.env.ULTRON_PLUGIN_DATA || path.join(pluginDir, '..', 'data'),
            `${manifest.id}-storage.json`,
          )
          const toolNames = Object.keys(pluginModule.tools).filter((name) => typeof pluginModule.tools[name] === 'function')
          sendReadyPayload({ type: 'ready', tools: toolNames, id: manifest.id })
        }
      }
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

const api = {
  storage: {
    get: (key) => readStorage()[key] ?? null,
    set: (key, value) => {
      const map = readStorage()
      map[key] = value
      return writeStorage(map)
    },
  },
  log: () => undefined,
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return
  if (message.type !== 'invoke') return
  const { callId, tool, args } = message
  const handler = pluginModule && pluginModule.tools ? pluginModule.tools[tool] : undefined
  if (typeof handler !== 'function') {
    sendReadyPayload({ type: 'result', callId, ok: false, error: `Araç bulunamadı: ${tool}` })
    return
  }
  try {
    Promise.resolve(handler.call(null, args ?? {}, api)).then(
      (result) => sendReadyPayload({ type: 'result', callId, ok: true, result: result ?? null }),
      (error) => sendReadyPayload({ type: 'result', callId, ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 500) }),
    )
  } catch (error) {
    sendReadyPayload({ type: 'result', callId, ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 500) })
  }
})
