import test from 'node:test'
import assert from 'node:assert/strict'
import { validateToolArguments } from '../electron/tool-validation.ts'

const tools = [{ type: 'function', function: { name: 'build', parameters: {
  type: 'object', required: ['task'], properties: {
    task: { type: 'string', enum: ['assembleDebug', 'test'] },
    ports: { type: 'array', maxItems: 2, items: { type: 'integer', minimum: 1, maximum: 65_535 } },
  },
} } }]

test('geçerli araç çağrısı doğrulanmış nesne olarak döner', () => {
  assert.deepEqual(validateToolArguments('build', '{"task":"assembleDebug","ports":[443]}', tools), { task: 'assembleDebug', ports: [443] })
})

test('bozuk JSON, nesne olmayan argüman, eksik alan ve bilinmeyen alan reddedilir', () => {
  assert.throws(() => validateToolArguments('build', '{', tools), /geçersiz JSON/)
  assert.throws(() => validateToolArguments('build', '[]', tools), /türünde olmalı/)
  assert.throws(() => validateToolArguments('build', '{}', tools), /gerekli/)
  assert.throws(() => validateToolArguments('build', '{"task":"test","command":"Remove-Item"}', tools), /tanınmıyor/)
})

test('enum, iç içe tür ve aralık sınırları gerçek yürütmeden önce doğrulanır', () => {
  assert.throws(() => validateToolArguments('build', '{"task":"delete"}', tools), /izin verilen/)
  assert.throws(() => validateToolArguments('build', '{"task":"test","ports":["443"]}', tools), /integer/)
  assert.throws(() => validateToolArguments('build', '{"task":"test","ports":[65536]}', tools), /üst sınırı/)
  assert.throws(() => validateToolArguments('missing', '{}', tools), /Bilinmeyen araç/)
})

test('açıkça izin veren serbest nesne alanları, kapalı şemayı gevşetmeden kabul edilir', () => {
  const extensible = [{ type: 'function', function: { name: 'spec', parameters: { type: 'object', properties: { metadata: { type: 'object', properties: {}, additionalProperties: true } } } } }]
  assert.deepEqual(validateToolArguments('spec', '{"metadata":{"safe":"value"}}', extensible), { metadata: { safe: 'value' } })
  assert.throws(() => validateToolArguments('spec', '{"unknown":true}', extensible), /tanınmıyor/)
})
