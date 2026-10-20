import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSourceSecurity } from '../electron/source-security.ts'

test('kaynak güvenlik analizi önemli bulguları konum ve öneriyle raporlar, gizli değeri kopyalamaz', () => {
  const findings = analyzeSourceSecurity([{ path: 'src/config.ts', content: [
    'const api_key = "sk_live_this_is_sensitive_123"',
    'const html = input; element.innerHTML = html',
    'const safe = JSON.parse(text)',
  ].join('\n') }])
  assert.deepEqual(findings.map((finding) => [finding.rule, finding.line]), [['hardcoded-credential', 1], ['unsafe-html-injection', 2]])
  assert.ok(findings.every((finding) => !JSON.stringify(finding).includes('sk_live_this_is_sensitive_123')))
})

test('güvenilmeyen serileştirme ve shell komutu oluşturma uyarı verir', () => {
  const findings = analyzeSourceSecurity([{ path: 'app.py', content: 'value = pickle.loads(payload)\nsubprocess.run(command + user_input, shell=True)' }])
  assert.deepEqual(findings.map((finding) => finding.rule), ['unsafe-deserialization', 'shell-command-construction'])
  assert.ok(findings.every((finding) => finding.severity === 'high'))
})
