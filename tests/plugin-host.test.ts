import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { fork } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const hostScript = path.join(here, '..', 'resources', 'plugin-host.cjs')

type HostMessage =
  | { type: 'ready'; tools: string[]; id?: string }
  | { type: 'result'; callId: number; ok: boolean; result?: unknown; error?: string }
  | { type: 'fatal'; error: string }

function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} ${milliseconds} ms gecendi`)), milliseconds)),
  ])
}

async function startHost(pluginDir: string, env: Record<string, string> = {}): Promise<{
  ready: Promise<Extract<HostMessage, { type: 'ready' }>>
  child: ReturnType<typeof fork>
  invoke: (tool: string, args?: unknown) => Promise<Extract<HostMessage, { type: 'result' }>>
}> {
  const child = fork(hostScript, [pluginDir], { silent: true, env: { ...process.env, ...env } })
  let nextCall = 0
  const pending = new Map<number, (message: Extract<HostMessage, { type: 'result' }>) => void>()
  let readyResolve!: (message: Extract<HostMessage, { type: 'ready' }>) => void
  let readyReject!: (error: Error) => void
  const ready = new Promise<Extract<HostMessage, { type: 'ready' }>>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  child.on('message', (raw: HostMessage) => {
    if (raw.type === 'ready') readyResolve(raw)
    else if (raw.type === 'result') pending.get(raw.callId)?.(raw)
    else if (raw.type === 'fatal') readyReject(new Error(raw.error))
  })
  child.on('exit', (code) => {
    readyReject(new Error(`host erken çıktı (kod ${code})`))
  })
  const invoke = (tool: string, args?: unknown) => new Promise<Extract<HostMessage, { type: 'result' }>>((resolve) => {
    const callId = ++nextCall
    pending.set(callId, resolve)
    child.send({ type: 'invoke', callId, tool, args })
  })
  return { ready, child, invoke }
}

test('plugin-host: eklenti yüklenir, ready ve çağrı döner', async () => {
  const pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-plugin-a-'))
  await fs.writeFile(path.join(pluginDir, 'manifest.json'), JSON.stringify({
    id: 'ornek-a', name: 'Ornek A', version: '1.0.0', entry: 'main.js', tools: [{ name: 'sum', description: 'x' }], permissions: ['storage'],
  }), 'utf8')
  await fs.writeFile(path.join(pluginDir, 'main.js'), [
    'exports.tools = {',
    '  sum: async (args) => ({ base: 10, total: 10 + Number(args?.b ?? 0), note: args?.note ?? null }),',
    '  read: async (_args, api) => ({ value: api.storage.get("anahtar") }),',
    '  write: async (args, api) => { api.storage.set("anahtar", args.value); return { ok: true }; },',
    '  boom: async () => { throw new Error("kasitli hata"); },',
    '}',
  ].join('\n'), 'utf8')
  try {
    const host = await startHost(pluginDir)
    try {
      const ready = await withTimeout(host.ready, 5000, 'ready')
      assert.deepEqual([...ready.tools].sort(), ['boom', 'read', 'sum', 'write'])
      assert.equal(ready.id, 'ornek-a')
      const result = await withTimeout(host.invoke('sum', { b: 32 }), 5000, 'sum')
      assert.ok(result.ok)
      assert.deepEqual(result.result, { base: 10, total: 42, note: null })
      const write = await withTimeout(host.invoke('write', { value: 'hatıra' }), 5000, 'write')
      assert.ok(write.ok)
      const readBack = await withTimeout(host.invoke('read'), 5000, 'read')
      assert.deepEqual(readBack.result, { value: 'hatıra' })
      const boom = await withTimeout(host.invoke('boom'), 5000, 'boom')
      assert.equal(boom.ok, false)
      assert.match(String(boom.error), /kasitli hata/)
      const missing = await withTimeout(host.invoke('yok-araç'), 5000, 'missing')
      assert.equal(missing.ok, false)
      assert.match(String(missing.error), /Araç bulunamadı/)
    } finally {
      host.child.kill()
    }
  } finally {
    await fs.rm(pluginDir, { recursive: true, force: true })
  }
})

test('plugin-host: entry dışına çıkan manifest reddedilir', async () => {
  const pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-plugin-b-'))
  await fs.writeFile(path.join(pluginDir, 'manifest.json'), JSON.stringify({
    id: 'kotu-b', name: 'Kotu B', version: '1.0.0', entry: '..\\kotu.js', tools: [{ name: 'x', description: 'x' }],
  }), 'utf8')
  try {
    const host = await startHost(pluginDir)
    try {
      await assert.rejects(() => withTimeout(host.ready, 5000, 'ready-fail-fast'), /güvenlik ihlali|dışına çıkıyor|erken çıktı/)
    } finally {
      host.child.kill()
    }
  } finally {
    await fs.rm(pluginDir, { recursive: true, force: true })
  }
})
