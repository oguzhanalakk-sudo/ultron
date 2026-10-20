import test from 'node:test'
import assert from 'node:assert/strict'
import { requiresCommandExecution } from '../electron/agent-intent.ts'

test('komut çalıştırma istekleri terminal aracı gerektirir', () => {
  assert.equal(requiresCommandExecution('PowerShell ile "UltronTest" yazan bir komut çalıştır ve çıktıyı bana bildir.'), true)
  assert.equal(requiresCommandExecution('Terminalde npm run build komutunu koş'), true)
  assert.equal(requiresCommandExecution('cmd komutunu çalıştır'), true)
  assert.equal(requiresCommandExecution('bir script execute et'), true)
  assert.equal(requiresCommandExecution('powershell komutu ile çıktısını göster'), true)
})

test('komut çalıştırma olmayan istekler tetiklenmez', () => {
  assert.equal(requiresCommandExecution('Hesap Makinesi uygulamasını aç'), false)
  assert.equal(requiresCommandExecution('rapor.txt dosyası oluştur ve oku'), false)
  assert.equal(requiresCommandExecution('web sayfasını oku'), false)
  assert.equal(requiresCommandExecution('komut çalıştırma'), false)
})

test('olumsuz komut istekleri tetiklenmez', () => {
  assert.equal(requiresCommandExecution('hiçbir komut çalıştırma'), false)
  assert.equal(requiresCommandExecution('do not run any command'), false)
})
