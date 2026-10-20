import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BRAVE_SEARCH_API_KEY_ENV, deleteEncryptedSecret, readEncryptedSecret, writeEncryptedSecret, type SecureStringStorage } from '../electron/secure-secret-store.ts'

const fakeStorage: SecureStringStorage = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
  decryptStringAsync: async (value) => ({ result: Buffer.from([...value.toString('utf8')].reverse().join(''), 'utf8').toString('utf8'), shouldReEncrypt: false }),
}

test('Brave anahtarı şifreli dosyada tutulur, okunur ve silinir', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-secure-secret-'))
  const file = path.join(directory, 'brave-search-key.json')
  const secret = 'brave-test-key-123456'
  try {
    await writeEncryptedSecret(file, secret, fakeStorage)
    const raw = await fs.readFile(file, 'utf8')
    assert.equal(raw.includes(secret), false)
    assert.equal(await readEncryptedSecret(file, fakeStorage), secret)
    await deleteEncryptedSecret(file)
    assert.equal(await readEncryptedSecret(file, fakeStorage), null)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('işletim sistemi şifrelemesi kullanılamıyorsa anahtar düz metin olarak yazılmaz', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-no-secure-secret-'))
  const file = path.join(directory, 'brave-search-key.json')
  const unavailable: SecureStringStorage = { ...fakeStorage, isAsyncEncryptionAvailable: async () => false }
  try {
    await assert.rejects(writeEncryptedSecret(file, 'brave-test-key-123456', unavailable), /güvenli biçimde saklanmadı/u)
    await assert.rejects(fs.access(file))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('Brave API anahtarı için kararlı ortam değişkeni adı tanımlıdır', () => {
  assert.equal(BRAVE_SEARCH_API_KEY_ENV, 'ULTRON_BRAVE_SEARCH_API_KEY')
})
