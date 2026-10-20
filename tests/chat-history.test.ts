import test from 'node:test'
import assert from 'node:assert/strict'
import { chatHistoryLimits, sanitizeChatMessages } from '../electron/chat-history.ts'

test('sanitizeChatMessages yalnızca geçerli kullanıcı/assistant mesajlarını kabul eder', () => {
  const result = sanitizeChatMessages([
    { role: 'user', content: 'Merhaba' },
    { role: 'system', content: 'yok sayılmalı' },
    { role: 'assistant', content: 'Selam!' },
    { role: 'user', content: '   ' },
    { role: 'assistant', content: 42 },
    null,
    'metin',
  ])
  assert.deepEqual(result, [
    { role: 'user', content: 'Merhaba' },
    { role: 'assistant', content: 'Selam!' },
  ])
})

test('sanitizeChatMessages son 200 mesajı ve içerik sınırını uygular', () => {
  const long = Array.from({ length: 260 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}` }))
  const trimmed = sanitizeChatMessages(long)
  assert.equal(trimmed.length, chatHistoryLimits.total)
  assert.equal(trimmed[0].content, 'm60')
  assert.equal(trimmed.at(-1)?.content, 'm259')
  const huge = sanitizeChatMessages([{ role: 'user', content: 'x'.repeat(50_000) }])
  assert.equal(huge[0].content.length, chatHistoryLimits.textLength)
})

test('sanitizeChatMessages geçersiz veya eksik girdide boş liste döner', () => {
  assert.deepEqual(sanitizeChatMessages(null), [])
  assert.deepEqual(sanitizeChatMessages({}), [])
  assert.deepEqual(sanitizeChatMessages([]), [])
})
