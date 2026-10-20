import { isIPv4 } from 'node:net'
import type { ModelProvider } from './shared'

// Ultron iki sağlayıcı ailesini destekler:
// - ollama: yalnızca bu bilgisayardaki loopback adres.
// - openai-compatible: HTTPS (veya yalnızca loopback için HTTP) üzerinden
//   OpenAI sohbet/tamamlama protokolünü konuşan herhangi bir uç nokta.
export type { ModelProvider }

export function isLoopbackHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || (isIPv4(host) && Number(host.split('.')[0]) === 127)
}

export function normalizeModelProvider(value: unknown): ModelProvider | null {
  return value === 'ollama' || value === 'openai-compatible' ? value : null
}

export function providerDisplayName(provider: ModelProvider) {
  return provider === 'ollama' ? 'Yerel Ollama' : 'OpenAI uyumlu sağlayıcı'
}

export function normalizeModelProviderUrl(provider: ModelProvider, value: string) {
  const input = value.trim()
  if (!input || input.length > 2048) throw new Error('Model adresi boş veya 2048 karakterden uzun.')
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Model adresi tam bir HTTP(S) URL olmalı; örnek: http://127.0.0.1:11434/v1') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Model adresi yalnızca HTTP veya HTTPS kullanabilir.')
  if (url.username || url.password) throw new Error('Model adresinde kullanıcı adı veya parola bulundurmayın.')
  if (url.search || url.hash) throw new Error('Model adresinde sorgu parametresi veya fragment kullanmayın.')

  if (provider === 'ollama') {
    if (!isLoopbackHost(url.hostname)) throw new Error('Yerel model yalnızca bu bilgisayardaki loopback adresine bağlanabilir; uzak/bulut adresleri reddedilir.')
    return url.toString().replace(/\/+$/, '')
  }

  if (provider !== 'openai-compatible') throw new Error('Bilinmeyen model sağlayıcısı.')

  const loopback = isLoopbackHost(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Uzak sağlayıcı için HTTPS gerekir. HTTP yalnızca 127.0.0.1, localhost veya ::1 adreslerinde kullanılabilir; API anahtarı şifresiz ağ üzerinden gönderilmez.')
  }
  // Kullanıcı sohbet uç noktasını veya /models yolunu yapıştırdıysa taban adrese indir.
  let pathname = url.pathname.replace(/\/+$/, '')
  pathname = pathname.replace(/\/(?:chat\/completions|models)$/i, '')
  url.pathname = pathname || '/'
  return url.toString().replace(/\/+$/, '')
}
