import test from 'node:test'
import assert from 'node:assert/strict'
import { broadAccessPermissions, defaultPermissions, type PermissionProfile } from '../electron/shared.ts'
import {
  canAccessExternalUrl,
  canLaunchApplication,
  canReadOrWriteAnyPath,
  canUseDesktopAutomation,
  classifyRiskFromPath,
  classifyRiskFromUrl,
} from '../electron/permission-manager.ts'

const controlled: PermissionProfile = { ...defaultPermissions, mode: 'controlled' }
const advanced: PermissionProfile = { ...defaultPermissions, mode: 'advanced' }
const personal: PermissionProfile = { ...defaultPermissions, mode: 'personal' }
const broad = broadAccessPermissions

test('URL ve Windows yol risk sınıflandırması geçerli girdileri doğru etiketler', () => {
  assert.equal(classifyRiskFromUrl('https://example.com/path'), 'low')
  assert.equal(classifyRiskFromUrl('http://localhost:3000'), 'medium')
  assert.equal(classifyRiskFromUrl('http://[::1]:3000'), 'medium')
  assert.equal(classifyRiskFromUrl('not a url'), 'high')
  assert.equal(classifyRiskFromPath('C:\\Windows\\System32\\drivers'), 'high')
  assert.equal(classifyRiskFromPath('C:\\Users\\Ada\\Documents\\notes.txt'), 'medium')
  assert.equal(classifyRiskFromPath('C:\\work\\ultron\\src\\main.ts'), 'low')
})

test('geniş erişim dış ağ, uygulama, dosya ve masaüstü kapılarını açar', () => {
  assert.equal(canAccessExternalUrl('https://example.com', broad, 'C:/proje').allowed, true)
  assert.equal(canLaunchApplication(broad).allowed, true)
  assert.equal(canReadOrWriteAnyPath(broad).allowed, true)
  assert.equal(canUseDesktopAutomation(broad, 'input-control').allowed, true)
})

test('kontrollü profilde dış ağ erişimi kapalıdır', () => {
  const result = canAccessExternalUrl('https://example.com', controlled, 'C:/proje')
  assert.equal(result.allowed, false)
  assert.match(String(result.reason), /izin gerekiyor|kapalı/)
})

test('ileri profil dış ağ erişimine izin verir', () => {
  assert.equal(canAccessExternalUrl('https://example.com', advanced, 'C:/proje').allowed, true)
  assert.equal(canAccessExternalUrl('https://example.com', personal, 'C:/proje').allowed, true)
})

test('özel ağ adresleri (localhost) hiçbir profilde açılmaz', () => {
  for (const profile of [controlled, advanced, personal, broad]) {
    const result = canAccessExternalUrl('http://127.0.0.1:8080/secret', profile, 'C:/proje')
    assert.equal(result.allowed, false, 'localhost açılmamalı')
  }
})

test('kontrollü profilde uygulama başlatma onay ister, gelişmiş profilde çalışır', () => {
  assert.equal(canLaunchApplication(controlled).allowed, false)
  assert.match(String(canLaunchApplication(controlled).reason), /onay.*gerekir/)
  assert.equal(canLaunchApplication(advanced).allowed, true)
  assert.equal(canLaunchApplication(personal).allowed, true)
})

test('proje dışı doğrudan dosya erişimi yalnız geniş erişimde açıktır', () => {
  assert.equal(canReadOrWriteAnyPath(controlled).allowed, false)
  assert.equal(canReadOrWriteAnyPath(advanced).allowed, false)
  assert.equal(canReadOrWriteAnyPath(broad).allowed, true)
})

test('masaüstü otomasyonu yalnız açık onay veya geniş erişimde çalışır', () => {
  assert.equal(canUseDesktopAutomation(controlled, 'input-control').allowed, false)
  assert.equal(canUseDesktopAutomation(controlled, 'screen-capture').allowed, false)
  assert.equal(canUseDesktopAutomation(controlled, 'app-launch').allowed, false)
  assert.equal(canUseDesktopAutomation(advanced, 'input-control').allowed, false)
  const enabled = { ...advanced, allowDesktopControl: true }
  assert.equal(canUseDesktopAutomation(enabled, 'input-control').allowed, true)
})

test('izin onayı olmadan hiçbir kapı kendiliğinden açılmaz', () => {
  assert.equal(canAccessExternalUrl('https://example.com', controlled, 'C:/proje').allowed, false)
  assert.equal(canLaunchApplication(controlled).allowed, false)
  assert.equal(canReadOrWriteAnyPath(controlled).allowed, false)
  assert.equal(canUseDesktopAutomation(controlled, 'input-control').allowed, false)
})
