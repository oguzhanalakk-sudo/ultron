import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, mkdir, rename, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeJsonAtomically } from '../electron/atomic-json.ts'

test('JSON kayıtları hedef dosyayı güvenle değiştirir ve geçici dosya bırakmaz', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kod-atolyesi-atomic-json-'))
  try {
    const file = path.join(root, 'nested', 'state.json')
    await writeJsonAtomically(file, { revision: 1, text: 'first' })
    await writeJsonAtomically(file, { revision: 2, text: 'replacement' })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { revision: 2, text: 'replacement' })
    assert.deepEqual(await readdir(path.dirname(file)), ['state.json'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('JSON değişimi başarısız olursa eski hedef korunur ve geçici dosya temizlenir', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kod-atolyesi-atomic-json-'))
  try {
    const target = path.join(root, 'state.json')
    await mkdir(target)
    await writeFile(path.join(target, 'keep.txt'), 'original', 'utf8')
    await assert.rejects(writeJsonAtomically(target, { revision: 2 }))
    assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'original')
    assert.deepEqual(await readdir(root), ['state.json'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function withExistingTarget(run: (root: string, target: string) => Promise<void>) {
  const temporaryParent = path.resolve(os.tmpdir())
  const root = await mkdtemp(path.join(temporaryParent, 'kod-atolyesi-rename-retry-'))
  try {
    const target = path.join(root, 'state.json')
    await writeFile(target, JSON.stringify({ revision: 1 }))
    await run(root, target)
  } finally {
    assert.equal(path.dirname(path.resolve(root)), temporaryParent)
    assert.ok(path.basename(root).startsWith('kod-atolyesi-rename-retry-'))
    await rm(root, { recursive: true, force: true })
  }
}

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`${code} paylaşım kilidi kalkınca aynı geçici dosya hedef silinmeden yeniden adlandırılır`, async () => withExistingTarget(async (root, target) => {
    const pauses: number[] = []
    const sources: string[] = []
    await writeJsonAtomically(target, { revision: 2 }, {
      rename: async (source, destination) => {
        sources.push(source)
        assert.equal(destination, target)
        assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { revision: 1 }, 'Yeniden denemeler sırasında eski hedef korunmalı')
        assert.deepEqual(JSON.parse(await readFile(source, 'utf8')), { revision: 2 }, 'Hazırlanan JSON yeniden yazılmadan korunmalı')
        if (sources.length <= 5) throw Object.assign(new Error('Controlled sharing violation'), { code })
        await rename(source, destination)
      },
      wait: async (milliseconds) => { pauses.push(milliseconds) },
    })
    assert.equal(sources.length, 6)
    assert.equal(new Set(sources).size, 1, 'Her deneme aynı geçici dosyayı kullanmalı')
    assert.deepEqual(pauses, [25, 50, 100, 200, 400])
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { revision: 2 })
    assert.deepEqual(await readdir(root), ['state.json'])
  }))
}

test('kalıcı paylaşım kilidi altı denemede durur; özgün hatayı iletir, eski hedefi korur ve geçici dosyayı temizler', async () => withExistingTarget(async (root, target) => {
  const originalError = Object.assign(new Error('Controlled permanent lock'), { code: 'EPERM' })
  let attempts = 0
  const pauses: number[] = []
  await assert.rejects(writeJsonAtomically(target, { revision: 2 }, {
    rename: async () => { attempts++; throw originalError },
    wait: async (milliseconds) => { pauses.push(milliseconds) },
  }), (error) => error === originalError)
  assert.equal(attempts, 6)
  assert.deepEqual(pauses, [25, 50, 100, 200, 400])
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { revision: 1 })
  assert.deepEqual(await readdir(root), ['state.json'])
}))

test('paylaşım kilidi dışındaki rename hataları yeniden denenmez ve hedef korunur', async () => {
  for (const code of ['EXDEV', 'ENOENT', 'EIO']) {
    await withExistingTarget(async (root, target) => {
      const originalError = Object.assign(new Error(`Controlled ${code}`), { code })
      let attempts = 0, pauses = 0
      await assert.rejects(writeJsonAtomically(target, { revision: 2 }, {
        rename: async () => { attempts++; throw originalError },
        wait: async () => { pauses++ },
      }), (error) => error === originalError)
      assert.equal(attempts, 1)
      assert.equal(pauses, 0)
      assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { revision: 1 })
      assert.deepEqual(await readdir(root), ['state.json'])
    })
  }
})
