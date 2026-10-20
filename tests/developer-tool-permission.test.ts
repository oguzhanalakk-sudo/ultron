import assert from 'node:assert/strict'
import test from 'node:test'
import { canExecuteDeveloperTool, describeRisk, requiresApprovalForCommand } from '../electron/permission-manager.ts'

const controlled = { mode: 'controlled', editMode: 'review', commandMode: 'confirm', allowPackageInstalls: false, allowSystemChanges: false, allowDesktopControl: false } as const

test('geliştirici aracı izni risk ve profile göre karar verir', () => {
  assert.equal(canExecuteDeveloperTool(controlled, 'node', 'C:/work').allowed, true)
  assert.equal(canExecuteDeveloperTool(controlled, 'docker', 'C:/work').allowed, false)
  assert.equal(canExecuteDeveloperTool(controlled, 'unknown-tool', 'C:/work').allowed, false)
})

test('yan etkili komutlar onay gerektirir ve risk açıklaması üretir', () => {
  assert.equal(requiresApprovalForCommand('git push -u origin feature').toString(), 'true')
  assert.equal(requiresApprovalForCommand('npm run typecheck').toString(), 'false')
  assert.match(describeRisk('npm install'), /Yüksek risk/)
})
