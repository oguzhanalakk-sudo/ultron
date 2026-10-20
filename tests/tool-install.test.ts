import assert from 'node:assert/strict'
import test from 'node:test'
import { getToolInstallPlan } from '../electron/tool-install.ts'

test('araç kurulum planı mevcut, eksik ve bilinmeyen araçları ayırır', async () => {
  const result = await getToolInstallPlan(['node', 'docker', 'unknown'], async (name) => ({ name, available: name === 'node', path: name === 'node' ? 'node.exe' : null, version: name === 'node' ? 'v22' : null }))
  assert.deepEqual(result.map((item) => item.status), ['available', 'missing', 'blocked'])
  assert.equal(result[1].installCommand, 'winget install Docker.DockerDesktop')
})
