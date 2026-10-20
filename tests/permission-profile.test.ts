import test from 'node:test'
import assert from 'node:assert/strict'
import { broadAccessPermissions, defaultPermissions, type PermissionProfile } from '../electron/shared.ts'
import { isBroadAccessEnabled } from '../electron/permission-manager.ts'

test('varsayılan izin profili tüm riskli kapıları kapalı tutar', () => {
  assert.equal(defaultPermissions.allowPackageInstalls, false)
  assert.equal(defaultPermissions.allowSystemChanges, false)
  assert.equal(defaultPermissions.allowDesktopControl, false)
  assert.equal(defaultPermissions.allowBroadAccess, false)
  assert.equal(defaultPermissions.broadAccessConfirmedAt, null)
  assert.equal(defaultPermissions.editMode, 'review')
  assert.equal(defaultPermissions.commandMode, 'confirm')
})

test('tam erişim profili tüm kapıları açar ve onay zaman damgası taşır', () => {
  assert.equal(broadAccessPermissions.allowPackageInstalls, true)
  assert.equal(broadAccessPermissions.allowSystemChanges, true)
  assert.equal(broadAccessPermissions.allowDesktopControl, true)
  assert.equal(broadAccessPermissions.allowBroadAccess, true)
  assert.equal(typeof broadAccessPermissions.broadAccessConfirmedAt, 'string')
  assert.ok(Number.isFinite(Date.parse(String(broadAccessPermissions.broadAccessConfirmedAt))))
})

test('açık erişim yalnız geçerli onay zaman damgasıyla etkin sayılır', () => {
  assert.equal(isBroadAccessEnabled(broadAccessPermissions), true)
  assert.equal(isBroadAccessEnabled(defaultPermissions), false)
  const withoutTimestamp: PermissionProfile = { ...broadAccessPermissions, broadAccessConfirmedAt: null }
  assert.equal(isBroadAccessEnabled(withoutTimestamp), false)
  const invalidTimestamp: PermissionProfile = { ...broadAccessPermissions, broadAccessConfirmedAt: 'gecersiz' }
  assert.equal(isBroadAccessEnabled(invalidTimestamp), false)
})
