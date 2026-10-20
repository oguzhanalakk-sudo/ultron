import test from 'node:test'
import assert from 'node:assert/strict'
import { canAccessExternalUrl, canPerformAutomatically, canUseDesktopAutomation, canLaunchApplication, canReadOrWriteAnyPath, createPermissionGrant, findPermissionGrant, findResourceRoot, isValidApprovalDecision, requestDesktopAutomationApproval, requestExternalUrlApproval, sanitizePermissionGrants, sanitizeResourceRoots } from '../electron/permission-manager.ts'
import type { PermissionProfile } from '../electron/shared.ts'

const projectPath = 'C:\\work\\demo'
const controlled: PermissionProfile = { mode: 'controlled', editMode: 'review', commandMode: 'confirm', allowPackageInstalls: false, allowSystemChanges: false, allowDesktopControl: false, allowUnrestrictedAccess: false }

test('dış URL politikası güvenli adresi profil ve merkezi onay akışına göre sınırlar', () => {
  assert.equal(canAccessExternalUrl('https://example.com', controlled, projectPath).allowed, false)
  assert.equal(canAccessExternalUrl('http://127.0.0.1:3000', controlled, projectPath).allowed, false)
  const personal = { ...controlled, mode: 'personal' as const }
  assert.equal(canAccessExternalUrl('https://example.com', personal, projectPath).allowed, true)
  assert.equal(requestExternalUrlApproval('https://example.com', projectPath).approved, false)
  assert.equal(requestExternalUrlApproval('file:///C:/secret.txt', projectPath).approved, false)
})

test('masaüstü otomasyonu profil kapısını ve merkezi kullanıcı onayını atlayamaz', () => {
  assert.equal(canUseDesktopAutomation(controlled, 'app-launch', projectPath).allowed, false)
  const enabled = { ...controlled, allowDesktopControl: true }
  assert.equal(canUseDesktopAutomation(enabled, 'app-launch', projectPath).allowed, true)
  assert.equal(canUseDesktopAutomation(enabled, 'system', projectPath).allowed, true)
  assert.equal(requestDesktopAutomationApproval('app-launch', projectPath).approved, false)
})

test('açık erişim yardımcıları kapsam kapısını kaldırır ancak URL güvenliğini korur', () => {
  const unrestricted = { ...controlled, allowUnrestrictedAccess: true }
  assert.equal(canLaunchApplication(unrestricted, projectPath).allowed, true)
  assert.equal(canReadOrWriteAnyPath(unrestricted, projectPath).allowed, true)
  assert.equal(canAccessExternalUrl('https://example.com', unrestricted, projectPath).allowed, true)
  assert.equal(canAccessExternalUrl('file:///C:/secret.txt', unrestricted, projectPath).allowed, false)
})

test('onay kararları boolean ve kapsam/kaydetme alanları arasında tutarlı olmalı', () => {
  assert.equal(isValidApprovalDecision({ approved: true, scope: 'operation', remember: false }), true)
  assert.equal(isValidApprovalDecision({ approved: true, scope: 'project', remember: true }), true)
  assert.equal(isValidApprovalDecision({ approved: false, scope: 'operation', remember: false }), true)
  for (const value of [
    null, {}, { approved: 'true', scope: 'operation', remember: false },
    { approved: true, scope: 'operation', remember: true },
    { approved: true, scope: 'project', remember: false },
    { approved: false, scope: 'project', remember: true },
    { approved: true, scope: 'invalid', remember: true },
  ]) assert.equal(isValidApprovalDecision(value), false)
})

test('gelişmiş profil yalnızca güvenli geliştirme komutlarını varsayılan olarak otomatik çalıştırır', () => {
  const advanced = { ...controlled, mode: 'advanced' as const, editMode: 'automatic' as const, commandMode: 'automatic' as const }
  const context = { profile: advanced, grants: [], projectPath, category: 'development' as const, risk: 'development' as const }
  assert.equal(canPerformAutomatically(context), true)
  assert.equal(canPerformAutomatically({ ...context, category: 'package', risk: 'package' }), false)
  assert.equal(canPerformAutomatically({ ...context, category: 'destructive', risk: 'destructive' }), false)
})

test('görev izni aynı görevde ve aynı işlem kategorisinde geçerlidir', () => {
  const grant = createPermissionGrant({ scope: 'task', category: 'package', projectPath, taskId: 'task-1', label: 'Bağımlılık kur' })
  assert.ok(findPermissionGrant({ profile: controlled, grants: [grant], projectPath, taskId: 'task-1', category: 'package' }))
  assert.equal(findPermissionGrant({ profile: controlled, grants: [grant], projectPath, taskId: 'task-2', category: 'package' }), undefined)
  assert.equal(findPermissionGrant({ profile: controlled, grants: [grant], projectPath, taskId: 'task-1', category: 'system' }), undefined)
})

test('proje izni proje içindeki uygun kategorileri kapsar fakat yıkıcı komutu otomatikleştirmez', () => {
  const grant = createPermissionGrant({ scope: 'project', category: 'package', projectPath, label: 'Proje izni' })
  assert.equal(grant.category, 'package')
  assert.ok(findPermissionGrant({ profile: controlled, grants: [grant], projectPath, category: 'package' }))
  assert.equal(findPermissionGrant({ profile: controlled, grants: [grant], projectPath, category: 'file-delete' }), undefined)
  assert.equal(canPerformAutomatically({ profile: controlled, grants: [grant], projectPath, category: 'destructive', risk: 'destructive' }), false)
  assert.equal(findPermissionGrant({ profile: controlled, grants: [grant], projectPath: 'C:\\work\\other', category: 'package' }), undefined)
})

test('kalıcı kategori izni tüm projelerde aynı kategoriye uygulanır', () => {
  const grant = createPermissionGrant({ scope: 'category', category: 'security-audit', projectPath, label: 'npm audit' })
  assert.equal(grant.projectPath, '*', 'Tüm proje izni kullanıcı kapsamındaki izin dosyasında tutulmalı')
  assert.ok(findPermissionGrant({ profile: controlled, grants: [grant], projectPath, category: 'security-audit', forceApproval: true }))
  assert.equal(findPermissionGrant({ profile: controlled, grants: [grant], projectPath, category: 'system' }), undefined)
  assert.ok(findPermissionGrant({ profile: controlled, grants: [grant], projectPath: 'C:\\work\\other', category: 'security-audit' }))
})

test('kayıt yükleyici başka proje, bozuk ve yıkıcı kalıcı izin kayıtlarını atlar', () => {
  const valid = createPermissionGrant({ scope: 'category', category: 'development', projectPath, label: 'Test' })
  const loaded = sanitizePermissionGrants([
    valid,
    { ...valid, id: 'foreign', projectPath: 'C:\\work\\other' },
    { ...valid, id: 'danger', category: 'destructive' },
    { ...valid, id: 'wildcard', category: '*' },
    { ...valid, id: 'broken', scope: 'unknown' },
  ], projectPath)
  assert.deepEqual(loaded.map((item) => item.id), [valid.id])
  assert.throws(() => createPermissionGrant({ scope: 'task', category: 'development', projectPath, label: 'Missing task' }), /Görev kapsamlı/)
  assert.throws(() => createPermissionGrant({ scope: 'category', category: 'destructive', projectPath, label: 'Never persist' }), /kalıcı izin/)
})

test('ek kaynak kapsamı sadece seçilen ağaç derinliğine izin verir ve proje kapsamı önceliklidir', () => {
  const roots = sanitizeResourceRoots([
    { id: 'shared', path: 'C:\\work\\shared', recursive: false, access: 'read' },
    { id: 'nested', path: 'C:\\work\\demo\\private', recursive: true, access: 'read-write' },
  ], projectPath)
  assert.equal(roots.length, 1, 'Proje içindeki klasörler zaten proje kapsamındadır')
  assert.equal(findResourceRoot('C:\\work\\shared\\index.ts', projectPath, roots)?.root.id, 'shared')
  assert.equal(findResourceRoot('C:\\work\\shared\\nested\\index.ts', projectPath, roots), undefined)
  assert.equal(findResourceRoot('C:\\work\\demo\\src\\index.ts', projectPath, roots)?.root.id, 'project')
})
