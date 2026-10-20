import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFile(path.join(root, relative), 'utf8')

const forbiddenHosts = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.cohere.ai',
  'api.mistral.ai',
  'openrouter.ai',
  'api.together.xyz',
  'huggingface.co',
  'api.groq.com',
  'api.deepseek.com',
]

const forbiddenPackages = ['openai', '@anthropic-ai/sdk', '@google/generative-ai', 'cohere-ai', '@mistralai/mistralai', 'groq-sdk']
const telemetryPackages = ['@sentry/node', '@sentry/electron', 'posthog-node', 'amplitude', 'mixpanel', 'newrelic']

test('uygulama kaynağında harici yapay zekâ uç noktası veya SDK bağımlılığı yoktur', async () => {
  const codeFiles = [
    ...(await fs.readdir(path.join(root, 'electron'))).filter((name) => name.endsWith('.ts')).map((name) => `electron/${name}`),
    ...(await fs.readdir(path.join(root, 'src'))).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => `src/${name}`),
  ]
  for (const file of codeFiles) {
    const source = (await read(file)).toLocaleLowerCase('en-US')
    for (const host of forbiddenHosts) assert.equal(source.includes(host), false, `${file} harici yapay zekâ adresi içermemeli: ${host}`)
  }
  const pkg = JSON.parse(await read('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  const allPackages = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  for (const name of [...forbiddenPackages, ...telemetryPackages]) assert.equal(name in allPackages, false, `Harici AI/telemetri paketi bulunmamalı: ${name}`)
})

test('ana süreçteki tüm HTTP istekleri yapılandırılmış modele yönelir; sabit dış URL yoktur', async () => {
  const source = (await Promise.all(['electron/main.ts', 'electron/openai-provider.ts', 'electron/provider-secrets.ts'].map(read))).join('\n')
  const fetchLines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => /\bfetch\s*\(/.test(line))
  assert.ok(fetchLines.length > 0, 'Yerel model istemcisi fetch kullanmalı')
  for (const line of fetchLines) {
    const fixedHttp = line.match(/fetch\s*\(\s*[`'"]https?:\/\/[^`'"]+/i)?.[0]
    if (!fixedHttp) continue
    assert.match(fixedHttp, /127\.0\.0\.1|localhost|\[::1\]/i, `Sabit HTTP hedefi yalnızca loopback olabilir: ${fixedHttp}`)
  }
  // Sadece fetch/http istek satırlarında sabit HTTPS kontrolü, description/example URL'leri değil
  const httpCallLines = source.split(/\r?\n/).filter((line) => /\b(fetch|http\.request|axios|request)\s*\(/.test(line))
  for (const line of httpCallLines) {
    const match = line.match(/[`'"]https?:\/\/[^`'"]+/i)
    if (match) {
      assert.match(match[0], /127\.0\.0\.1|localhost|\[::1\]/i, `HTTP çağrısında sabit dış URL: ${match[0]}`)
    }
  }
})

test('ayarlar sağlayıcı seçimini taşır ama API anahtarı taşımaz; anahtar ayrı ve maskeli saklanır', async () => {
  const shared = await read('electron/shared.ts')
  assert.match(shared, /export type ModelProvider = 'ollama' \| 'openai-compatible'/)
  assert.match(shared, /export type AppConfig = \{ provider: ModelProvider;/)
  assert.equal(/apiKey\s*:/.test(shared), false, 'API anahtarı alanı ayar tipinde kalmamalı')
  const secrets = await read('electron/provider-secrets.ts')
  assert.match(secrets, /normalizeApiKey|resolveProviderApiKey/)
  assert.equal(/console\.(log|info|debug|warn|error)/.test(secrets), false, 'Sır modülü log yazmamalı')
  const preload = await read('electron/preload.ts')
  assert.equal(preload.includes('provider-secrets'), false, 'Sır modülü renderer köprüsüne sızmamalı')
  const renderer = await read('src/App.tsx')
  assert.equal(renderer.includes('provider-secrets.json'), true, 'Arayüz anahtarın nerede saklandığını açıklamalı')
  assert.equal(renderer.includes('ULTRON_OPENAI_API_KEY'), true, 'Ortam değişkeni yolu arayüzde belgelenmeli')
  for (const file of ['electron/main.ts', 'electron/provider-secrets.ts', 'electron/openai-provider.ts']) {
    const source = await read(file)
    assert.equal(/['"]sk-[A-Za-z0-9_-]{20,}['"]/.test(source), false, `${file} sabit API anahtarı içermemeli`)
  }
})
