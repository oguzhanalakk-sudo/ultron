import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { isAllowedExternalUrl, isTrustedRendererUrl, normalizeDevelopmentRendererUrl } from '../electron/renderer-security.ts'

test('dev renderer yalnızca aynı yerel origin içinde kalır', () => {
  const expected = 'http://127.0.0.1:5173/'
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/settings', expected), true)
  assert.equal(isTrustedRendererUrl('http://localhost:5173/settings', expected), false)
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5174/', expected), false)
  assert.equal(isTrustedRendererUrl('http://attacker@127.0.0.1:5173/', expected), false)
  assert.equal(isTrustedRendererUrl('file:///C:/tmp/index.html', expected), false)
})

test('paketlenmiş renderer yalnızca beklenen index dosyasıysa güvenilir', () => {
  const expected = pathToFileURL('C:\\Program Files\\Ultron\\resources\\app\\out\\renderer\\index.html').href
  const sameFile = pathToFileURL('c:\\program files\\ultron\\resources\\app\\out\\renderer\\index.html').href
  const otherFile = pathToFileURL('C:\\Users\\Public\\index.html').href
  assert.equal(isTrustedRendererUrl(sameFile, expected), process.platform === 'win32')
  assert.equal(isTrustedRendererUrl(otherFile, expected), false)
  assert.equal(isTrustedRendererUrl('https://example.com/', expected), false)
})

test('yeni pencereler yalnızca web ve mail bağlantılarını dışarı açabilir', () => {
  assert.equal(isAllowedExternalUrl('https://example.com/path'), true)
  assert.equal(isAllowedExternalUrl('mailto:developer@example.com'), true)
  assert.equal(isAllowedExternalUrl('file:///C:/Windows/win.ini'), false)
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedExternalUrl('data:text/html,hi'), false)
})

test('renderer geliştirme URLsi paketli uygulamada ve loopback dışındaki hedeflerde kapalıdır', () => {
  assert.equal(normalizeDevelopmentRendererUrl('http://127.0.0.1:5173/', false), 'http://127.0.0.1:5173/')
  assert.equal(normalizeDevelopmentRendererUrl('http://localhost:5173/', false), 'http://localhost:5173/')
  assert.equal(normalizeDevelopmentRendererUrl('http://[::1]:5173/', false), 'http://[::1]:5173/')
  assert.equal(normalizeDevelopmentRendererUrl('https://127.0.0.1:5173/', false), null)
  assert.equal(normalizeDevelopmentRendererUrl('http://0.0.0.0:5173/', false), null)
  assert.equal(normalizeDevelopmentRendererUrl('http://example.com/', false), null)
  assert.equal(normalizeDevelopmentRendererUrl('http://127.0.0.1:5173/', true), null)
})
