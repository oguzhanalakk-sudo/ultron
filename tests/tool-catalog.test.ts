import assert from 'node:assert/strict'
import test from 'node:test'
import { detectToolAvailability, isInsideProjectRoot, TOOL_DEFINITIONS, validateCommandSafety } from '../electron/tool-catalog.ts'

test('araç kataloğu tanımlı araçları ve uygunluk sonucunu üretir', async () => {
  assert.ok(TOOL_DEFINITIONS.git)
  assert.equal(isInsideProjectRoot('C:/work', 'C:/work'), true)
  assert.equal(isInsideProjectRoot('C:/work/src', 'C:/work'), true)
  assert.equal(isInsideProjectRoot('C:/other', 'C:/work'), false)
  const result = await detectToolAvailability('node', async () => ({ ok: true, path: 'node.exe', stdout: 'v22.0.0', stderr: '' }))
  assert.deepEqual(result, { name: 'node', available: true, path: 'node.exe', version: 'v22.0.0' })
})

test('araç güvenlik denetimi shell kontrol akışını ve tehlikeli kalıpları reddeder', () => {
  assert.equal(validateCommandSafety('npm run build', 'C:/work').ok, true)
  assert.equal(validateCommandSafety('npm run build && whoami', 'C:/work').ok, false)
  assert.equal(validateCommandSafety('powershell -EncodedCommand abc', 'C:/work').ok, false)
})
