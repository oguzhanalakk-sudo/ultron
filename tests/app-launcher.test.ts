import test from 'node:test'
import assert from 'node:assert/strict'
import { ALLOWED_APPLICATIONS, normalizeAppName, validateAppName, type AllowedApplication } from '../electron/app-launcher.ts'
import { APP_NAME_ALIASES, resolveTrustedApplicationTarget } from '../electron/desktop-control.ts'

test('izin listesinde sistem araçları ve tarayıcılar bulunur', () => {
  for (const name of ['hesap makinesi', 'not defteri', 'dosya gezgini', 'microsoft edge', 'google chrome', 'firefox']) {
    assert.ok(ALLOWED_APPLICATIONS.includes(name as AllowedApplication), `${name} listede olmalı`)
  }
})

test('uygulama adı büyük/küçük harf ve boşluk duyarsız normalleştirilir', () => {
  assert.equal(normalizeAppName('  Not Defteri '), 'not defteri')
  assert.equal(normalizeAppName('HESAP MAKİNESİ'), 'hesap makinesi')
  assert.equal(validateAppName(' Microsoft Edge '), 'microsoft edge')
})

test('listede olmayan uygulama reddedilir ve izinli liste bildirilir', () => {
  assert.throws(() => validateAppName('google'), /izin verilen uygulama adlarını kabul eder/)
  assert.throws(() => validateAppName('cmd'), /izin verilen uygulama adlarını kabul eder/)
  assert.throws(() => validateAppName('C:/Windows/System32/cmd.exe'), /izin verilen uygulama adlarını kabul eder/)
  assert.throws(() => validateAppName(''), /izin verilen uygulama adlarını kabul eder/)
})

test('listede olmayan uygulama için hata mesajı izinli uygulamaları listeler', () => {
  try {
    validateAppName('photos')
    assert.fail('hata bekleniyordu')
  } catch (error) {
    const message = String((error as Error).message)
    assert.ok(message.includes('not defteri'))
    assert.ok(message.includes('microsoft edge'))
  }
})

test('izinli uygulama adları gerçek çalıştırılabilir dosyaya çözülür', () => {
  assert.equal(resolveTrustedApplicationTarget('hesap makinesi'), 'calc.exe')
  assert.equal(resolveTrustedApplicationTarget('not defteri'), 'notepad.exe')
  assert.equal(resolveTrustedApplicationTarget('dosya gezgini'), 'explorer.exe')
  assert.equal(resolveTrustedApplicationTarget('microsoft edge'), 'msedge.exe')
  assert.equal(resolveTrustedApplicationTarget('google chrome'), 'chrome.exe')
  assert.equal(resolveTrustedApplicationTarget('firefox'), 'firefox.exe')
})

test('kabuk yürütücüleri ve ham yollar güvenli modda reddedilir', () => {
  assert.throws(() => resolveTrustedApplicationTarget('powershell'), /güvenli uygulama başlatma listesinde değil/)
  assert.throws(() => resolveTrustedApplicationTarget('cmd'), /güvenli uygulama başlatma listesinde değil/)
  assert.throws(() => resolveTrustedApplicationTarget('C:/Windows/System32/notepad.exe'), /güvenli uygulama başlatma listesinde değil/)
})

test('takma ad tablosu tarayıcıları kapsar', () => {
  assert.equal(APP_NAME_ALIASES['microsoft edge'], 'msedge.exe')
  assert.equal(APP_NAME_ALIASES['google chrome'], 'chrome.exe')
  assert.equal(APP_NAME_ALIASES['vivaldi'], 'vivaldi.exe')
})
