import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function isTrustedRendererUrl(candidate: string, expected: string): boolean {
  try {
    const actualUrl = new URL(candidate)
    const expectedUrl = new URL(expected)
    if (actualUrl.username || actualUrl.password || actualUrl.protocol !== expectedUrl.protocol) return false
    if (expectedUrl.protocol === 'file:') {
      const actualFile = path.resolve(fileURLToPath(actualUrl))
      const expectedFile = path.resolve(fileURLToPath(expectedUrl))
      const normalize = (value: string) => process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value
      return normalize(actualFile) === normalize(expectedFile)
    }
    return actualUrl.origin === expectedUrl.origin
  } catch { return false }
}

export function isAllowedExternalUrl(value: string): boolean {
  try {
    if (!value || value.length > 2_048 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return false
    const url = new URL(value)
    if (url.username || url.password) return false
    if (url.protocol === 'http:' || url.protocol === 'https:') return Boolean(url.hostname)
    return url.protocol === 'mailto:'
  }
  catch { return false }
}

export function normalizeDevelopmentRendererUrl(value: string, packaged: boolean): string | null {
  if (packaged || !value) return null
  try {
    const url = new URL(value)
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname.toLowerCase()) || url.username || url.password || url.search || url.hash) return null
    return url.href
  } catch { return null }
}
