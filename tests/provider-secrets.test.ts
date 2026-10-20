import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearProviderApiKey,
  maskSecret,
  normalizeApiKey,
  normalizeProviderSecrets,
  readProviderSecrets,
  redactProviderSecrets,
  resolveProviderApiKey,
  setProviderApiKey,
  writeProviderSecrets,
} from '../electron/provider-secrets.ts'

async function temporarySecretFile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-secrets-'))
  return { directory, file: path.join(directory, 'provider-secrets.json') }
}

test('API anahtarı doğrulaması kısa, kontrol karakterli ve aşırı uzun değerleri reddeder', () => {
  assert.equal(normalizeApiKey('sk-1234567890'), 'sk-1234567890')
  assert.equal(normalizeApiKey('  sk-1234567890  '), 'sk-1234567890')
  assert.equal(normalizeApiKey('short'), null)
  assert.equal(normalizeApiKey('sk-1234\n567890'), null)
  assert.equal(normalizeApiKey('x'.repeat(4_097)), null)
  assert.equal(normalizeApiKey(123), null)
})

test('bozuk veya eski biçimli sır dosyası güvenli biçimde normalize edilir', () => {
  assert.deepEqual(normalizeProviderSecrets(null), { version: 1, keys: {} })
  assert.deepEqual(normalizeProviderSecrets({ keys: { 'openai-compatible': 'sk-1234567890', '../bad': 'sk-abcdefgh' } }), {
    version: 1,
    keys: { 'openai-compatible': 'sk-1234567890' },
  })
  assert.deepEqual(normalizeProviderSecrets({ providers: { 'openai-compatible': { apiKey: 'sk-1234567890' } } }), {
    version: 1,
    keys: { 'openai-compatible': 'sk-1234567890' },
  })
})

test('anahtar dosyası atomik yazılır, okunur ve silinir', async () => {
  const { directory, file } = await temporarySecretFile()
  try {
    await setProviderApiKey(file, 'openai-compatible', 'sk-1234567890')
    assert.deepEqual(await readProviderSecrets(file), { version: 1, keys: { 'openai-compatible': 'sk-1234567890' } })
    await clearProviderApiKey(file, 'openai-compatible')
    assert.deepEqual(await readProviderSecrets(file), { version: 1, keys: {} })
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('ortam değişkeni dosyadaki anahtardan önce gelir ve anahtar loglanmaz', async () => {
  const { directory, file } = await temporarySecretFile()
  try {
    await writeProviderSecrets(file, { version: 1, keys: { 'openai-compatible': 'sk-file-key-1234' } })
    assert.deepEqual(await resolveProviderApiKey({ provider: 'openai-compatible', filePath: file, env: {} }), { key: 'sk-file-key-1234', source: 'file' })
    assert.deepEqual(await resolveProviderApiKey({ provider: 'openai-compatible', filePath: file, env: { ULTRON_OPENAI_API_KEY: 'sk-env-key-5678' } }), { key: 'sk-env-key-5678', source: 'env' })
    assert.deepEqual(await resolveProviderApiKey({ provider: 'ollama', filePath: file, env: {} }), { key: null, source: null })
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('hata ve gövde metinlerindeki anahtarlar maskelenir', () => {
  const key = 'sk-very-secret-1234567890'
  const redacted = redactProviderSecrets(`Authorization: Bearer ${key}; api_key=${key}; sk-abcdefghijkl`, [key])
  assert.equal(redacted.includes(key), false)
  assert.equal(redacted.includes('sk-abcdefghijkl'), false)
  assert.match(redacted, /\*\*\*/)
  assert.equal(maskSecret('short'), '***')
  assert.equal(maskSecret(key).includes(key), false)
})
