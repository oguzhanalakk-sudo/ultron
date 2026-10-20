import test from 'node:test'
import assert from 'node:assert/strict'
import {
  answerLocally,
  estimateModelFit,
  evaluateMathExpression,
  formatJsonDocument,
  isValidLocalModelReference,
  parseOllamaMetrics,
  parseOllamaPs,
  parseOllamaTags,
  recommendLocalModels,
} from '../electron/local-ai.ts'
import type { LocalHardware } from '../electron/shared.ts'

const GB = 1024 ** 3
const hardware: LocalHardware = {
  os: 'Windows_NT 10.0.26100',
  architecture: 'x64',
  cpu: 'Intel Core i7-13620H',
  cpuCores: 16,
  memoryTotalBytes: 16 * GB,
  memoryFreeBytes: 8 * GB,
  gpu: 'NVIDIA GeForce RTX 4060 Laptop GPU',
  gpuMemoryBytes: 8 * GB,
  diskFreeBytes: 120 * GB,
  diskTotalBytes: 500 * GB,
  detectedAt: '2026-10-18T10:00:00.000Z',
}

test('Ollama model kataloğu ad, boyut ve nicemleme bilgisini okur', () => {
  const models = parseOllamaTags({
    models: [
      { name: 'qwen3:8b', size: 5 * GB, digest: 'sha256:abc', modified_at: '2026-10-01T10:00:00Z', details: { family: 'qwen3', parameter_size: '8.2B', quantization_level: 'Q4_K_M' } },
      { name: 'llama3.2:3b', size: 2 * GB, details: { family: 'llama', parameter_size: '3.2B' } },
      { name: '', size: 1 },
      { size: 1 },
    ],
  })
  assert.equal(models.length, 2)
  assert.deepEqual(models.map((model) => model.name), ['llama3.2:3b', 'qwen3:8b'])
  assert.equal(models[1].parameterSize, '8.2B')
  assert.equal(models[1].quantization, 'Q4_K_M')
  assert.equal(models[0].quantization, null)
})

test('geçersiz Ollama yüklenmiş model yanıtı boş liste döndürür', () => {
  assert.deepEqual(parseOllamaPs(null), [])
  assert.deepEqual(parseOllamaPs({ models: 'x' }), [])
  assert.deepEqual(parseOllamaTags({ models: [{ name: 'a:1', size: 10, size_vram: 8, expires_at: 'soon' }] }), [
    { name: 'a:1', sizeBytes: 10, digest: null, modifiedAt: null, family: null, parameterSize: null, quantization: null },
  ])
})

test('model bellek uyumu GPU, kısmi GPU, CPU ve yetersiz durumlarını ayırır', () => {
  assert.equal(estimateModelFit({ sizeBytes: 5 * GB }, hardware).level, 'gpu')
  assert.equal(estimateModelFit({ sizeBytes: 4 * GB }, { ...hardware, gpuMemoryBytes: 3 * GB }).level, 'partial')
  assert.equal(estimateModelFit({ sizeBytes: 9 * GB }, { ...hardware, gpuMemoryBytes: null }).level, 'cpu')
  assert.equal(estimateModelFit({ sizeBytes: 40 * GB }, { ...hardware, gpuMemoryBytes: null }).level, 'too-large')
  assert.equal(estimateModelFit({ sizeBytes: 0 }, hardware).level, 'unknown')
})

test('donanıma göre önerilen yerel modeller gerçekçi boyutlarda kalır', () => {
  const strong = recommendLocalModels(hardware)
  assert.ok(strong.some((item) => item.name === 'qwen2.5-coder:7b'))
  assert.ok(strong.some((item) => item.name === 'qwen3:8b'))
  const weak = recommendLocalModels({ gpuMemoryBytes: null, memoryTotalBytes: 4 * GB, memoryFreeBytes: 2 * GB })
  assert.deepEqual(weak.map((item) => item.name), ['qwen2.5-coder:1.5b', 'llama3.2:1b'])
})

test('model adı doğrulaması kabuk enjeksiyonunu ve yol kaçışını reddeder', () => {
  assert.equal(isValidLocalModelReference('qwen2.5-coder:7b'), true)
  assert.equal(isValidLocalModelReference('library/llama3.2:latest'), true)
  assert.equal(isValidLocalModelReference(''), false)
  assert.equal(isValidLocalModelReference('qwen3:8b; rm -rf /'), false)
  assert.equal(isValidLocalModelReference('../../secret'), false)
  assert.equal(isValidLocalModelReference('-bad'), false)
  assert.equal(isValidLocalModelReference('model with space'), false)
})

test('yerel hesap makinesi işlem önceliğini ve parantezleri doğru uygular', () => {
  assert.deepEqual(evaluateMathExpression('2 + 3 * 4'), { ok: true, value: 14, formatted: '14' })
  assert.deepEqual(evaluateMathExpression('(2 + 3) * 4'), { ok: true, value: 20, formatted: '20' })
  assert.deepEqual(evaluateMathExpression('2 ^ 3 ^ 2'), { ok: true, value: 512, formatted: '512' })
  assert.deepEqual(evaluateMathExpression('-3 + 5'), { ok: true, value: 2, formatted: '2' })
  assert.deepEqual(evaluateMathExpression('10 % 4'), { ok: true, value: 2, formatted: '2' })
  assert.equal(evaluateMathExpression('1 / 0').ok, false)
  assert.equal(evaluateMathExpression('alert(1)').ok, false)
})

test('JSON doğrulama geçerli belgeyi biçimlendirir, geçersizi reddeder', () => {
  const valid = formatJsonDocument('{"b":2,"a":[1,2]}')
  assert.equal(valid.ok, true)
  if (valid.ok) {
    assert.match(valid.formatted, /\n  "b": 2/)
    assert.equal(valid.summary, 'Nesne · 2 alan')
  }
  const array = formatJsonDocument('[1,2,3]')
  assert.equal(array.ok, true)
  if (array.ok) assert.equal(array.summary, 'Dizi · 3 öğe')
  assert.equal(formatJsonDocument('{"a":}').ok, false)
  assert.equal(formatJsonDocument('5').ok, false)
})

test('akıllı işlem motoru model çağrısı gerektirmeyen istekleri yanıtlar', () => {
  const math = answerLocally('hesapla: 6*7', {})
  assert.equal(math.handled, true)
  assert.match(math.content ?? '', /42/)

  const direct = answerLocally('2+2', {})
  assert.equal(direct.handled, true)
  assert.match(direct.content ?? '', /4/)

  const json = answerLocally('json doğrula: {"a":1}', {})
  assert.equal(json.handled, true)
  assert.match(json.content ?? '', /JSON geçerli/)

  const files = answerLocally('dosyaları listele', { files: ['src/', 'package.json'] })
  assert.equal(files.handled, true)
  assert.match(files.content ?? '', /src\//)
  assert.match(files.content ?? '', /package\.json/)

  const system = answerLocally('sistem durumu', { hardware })
  assert.equal(system.handled, true)
  assert.match(system.content ?? '', /RTX 4060/)
  assert.match(system.content ?? '', /16\.0 GB/)

  assert.equal(answerLocally('bana bir React bileşeni yaz', {}).handled, false)
})

test('Ollama akış ölçümleri token hızını gerçek alanlardan hesaplar', () => {
  const metrics = parseOllamaMetrics({ eval_count: 10, eval_duration: 2_000_000_000, prompt_eval_count: 7, total_duration: 3_500_000_000 })
  assert.equal(metrics.evaluatedTokens, 10)
  assert.equal(metrics.promptTokens, 7)
  assert.equal(metrics.tokensPerSecond, 5)
  assert.equal(metrics.totalDurationMs, 3500)
  assert.equal(parseOllamaMetrics({}).tokensPerSecond, null)
})
