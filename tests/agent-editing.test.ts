import assert from 'node:assert/strict'
import test from 'node:test'
import { alignLineEndings, applyPatchToContent, dominantLineEnding, findPatchMatches, paginateContent } from '../electron/agent-editing.ts'

test('birebir eşleşme tekil olduğunda yama uygulanır', () => {
  const result = applyPatchToContent('const a = 1\nconst b = 2\n', 'const b = 2', 'const b = 3')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.strategy, 'exact')
  assert.equal(result.replacements, 1)
  assert.equal(result.content, 'const a = 1\nconst b = 3\n')
})

test('çoklu birebir eşleşme replace_all olmadan reddedilir', () => {
  const result = applyPatchToContent('foo\nbar\nfoo\n', 'foo', 'baz')
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /2 kez bulundu/)
  assert.match(result.error, /replace_all/)
})

test('replace_all tüm eşleşmeleri değiştirir', () => {
  const result = applyPatchToContent('foo\nbar\nfoo\n', 'foo', 'baz', true)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.replacements, 2)
  assert.equal(result.content, 'baz\nbar\nbaz\n')
})

test('CRLF dosyada LF old_text toleransla eşleşir ve yeni metin CRLF olur', () => {
  const content = 'satir1\r\nsatir2\r\nsatir3\r\n'
  const result = applyPatchToContent(content, 'satir1\nsatir2', 'yeni1\nyeni2')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.strategy, 'normalized')
  assert.equal(result.content, 'yeni1\r\nyeni2\r\nsatir3\r\n')
})

test('satır sonu boşluk farkı trimEnd toleransıyla eşleşir', () => {
  const content = 'alpha   \nbeta\t\n'
  const result = applyPatchToContent(content, 'alpha\nbeta', 'tek')
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.strategy, 'trimmed')
  assert.equal(result.content, 'tek\n')
})

test('bulunamayan metin açıklayıcı hata döndürür', () => {
  const result = applyPatchToContent('abc\n', 'yok-boyle-bir-sey', 'x')
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.error, /bulunamadı/)
})

test('boş old_text reddedilir', () => {
  const result = applyPatchToContent('abc\n', '', 'x')
  assert.equal(result.ok, false)
})

test('findPatchMatches strateji ve aralıkları raporlar', () => {
  const exact = findPatchMatches('aa bb aa', 'aa')
  assert.equal(exact.strategy, 'exact')
  assert.equal(exact.ranges.length, 2)
  const trimmed = findPatchMatches('x   \ny', 'x\ny')
  assert.equal(trimmed.strategy, 'trimmed')
  assert.equal(trimmed.ranges.length, 1)
  const none = findPatchMatches('abc', 'zzz')
  assert.equal(none.ranges.length, 0)
})

test('dominantLineEnding ve alignLineEndings dosya stilini korur', () => {
  assert.equal(dominantLineEnding('a\r\nb\r\nc'), '\r\n')
  assert.equal(dominantLineEnding('a\nb\nc'), '\n')
  assert.equal(alignLineEndings('a\r\nb\r\n', 'x\ny\n'), 'x\r\ny\r\n')
  assert.equal(alignLineEndings('a\nb\n', 'x\ny'), 'x\ny')
})

test('paginateContent satır aralığı, toplam satır ve devam bilgisini döndürür', () => {
  const content = Array.from({ length: 10 }, (_, index) => `satir${index + 1}`).join('\n')
  const firstPage = paginateContent(content, 1, 4)
  assert.equal(firstPage.text, 'satir1\nsatir2\nsatir3\nsatir4')
  assert.equal(firstPage.totalLines, 10)
  assert.equal(firstPage.startLine, 1)
  assert.equal(firstPage.endLine, 4)
  assert.equal(firstPage.truncated, true)
  const lastPage = paginateContent(content, 9, 4)
  assert.equal(lastPage.text, 'satir9\nsatir10')
  assert.equal(lastPage.truncated, false)
  const beyond = paginateContent(content, 99, 4)
  assert.equal(beyond.text, '')
  assert.equal(beyond.truncated, false)
})

test('paginateContent varsayılanları ve sınır kırpmasını uygular', () => {
  const content = 'tek satir'
  const page = paginateContent(content)
  assert.equal(page.text, 'tek satir')
  assert.equal(page.startLine, 1)
  assert.equal(page.endLine, 1)
  const negative = paginateContent(content, -5, -2)
  assert.equal(negative.startLine, 1)
  assert.equal(negative.text, 'tek satir')
})
