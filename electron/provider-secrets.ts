import { promises as fs } from 'node:fs'
import path from 'node:path'

// API anahtarları ayarlar dosyasına, görev kaydına veya loglara yazılmaz.
// Yalnızca kullanıcı veri klasöründeki ayrı bir dosyada ya da ortam değişkeninde tutulur.
export type ProviderSecrets = { version: 1; keys: Record<string, string> }

export const providerApiKeyEnv: Readonly<Record<string, string>> = Object.freeze({
  'openai-compatible': 'ULTRON_OPENAI_API_KEY',
  github: 'ULTRON_GITHUB_TOKEN',
})

const providerIdPattern = /^[a-z][a-z0-9-]{1,40}$/
const maxApiKeyLength = 4_096

export function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (key.length < 8 || key.length > maxApiKeyLength) return null
  if (/[\u0000-\u001f\u007f]/.test(key)) return null
  return key
}

export function normalizeProviderSecrets(value: unknown): ProviderSecrets {
  const keys: Record<string, string> = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const source = record.keys && typeof record.keys === 'object' && !Array.isArray(record.keys)
      ? record.keys as Record<string, unknown>
      : record.providers && typeof record.providers === 'object' && !Array.isArray(record.providers)
        ? record.providers as Record<string, unknown>
        : {}
    for (const [provider, raw] of Object.entries(source)) {
      if (!providerIdPattern.test(provider)) continue
      const candidate = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).apiKey : null
      const key = normalizeApiKey(candidate)
      if (key) keys[provider] = key
    }
  }
  return { version: 1, keys }
}

export async function readProviderSecrets(filePath: string): Promise<ProviderSecrets> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return normalizeProviderSecrets(JSON.parse(raw))
  } catch {
    // Dosya yoksa veya bozuksa sağlayıcı kapalı kalır; hata anahtar içermez.
    return { version: 1, keys: {} }
  }
}

export async function writeProviderSecrets(filePath: string, secrets: ProviderSecrets): Promise<void> {
  const normalized = normalizeProviderSecrets(secrets)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(normalized, null, 2), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporary, filePath)
  } finally {
    await fs.unlink(temporary).catch(() => undefined)
  }
}

export async function setProviderApiKey(filePath: string, provider: string, apiKey: string): Promise<void> {
  if (!providerIdPattern.test(provider)) throw new Error('Sağlayıcı kimliği geçersiz.')
  const key = normalizeApiKey(apiKey)
  if (!key) throw new Error('API anahtarı 8–4096 karakter arasında olmalı ve kontrol karakteri içermemeli.')
  const secrets = await readProviderSecrets(filePath)
  secrets.keys[provider] = key
  await writeProviderSecrets(filePath, secrets)
}

export async function clearProviderApiKey(filePath: string, provider: string): Promise<void> {
  const secrets = await readProviderSecrets(filePath)
  delete secrets.keys[provider]
  await writeProviderSecrets(filePath, secrets)
}

export async function resolveProviderApiKey(input: {
  provider: string
  filePath: string
  env?: NodeJS.ProcessEnv
}): Promise<{ key: string | null; source: 'env' | 'file' | null }> {
  const envName = providerApiKeyEnv[input.provider]
  const env = input.env ?? process.env
  if (envName) {
    const fromEnv = normalizeApiKey(env[envName])
    if (fromEnv) return { key: fromEnv, source: 'env' }
  }
  const secrets = await readProviderSecrets(input.filePath)
  const fromFile = normalizeApiKey(secrets.keys[input.provider])
  return fromFile ? { key: fromFile, source: 'file' } : { key: null, source: null }
}

export function maskSecret(value: string): string {
  if (value.length < 12) return '***'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

export function redactProviderSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let output = text
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) output = output.split(secret).join(maskSecret(secret))
  }
  return output
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"'\s,}]{8,}/gi, '$1***')
}
