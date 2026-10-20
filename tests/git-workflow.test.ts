import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGitBranchName, normalizeGitCommitMessage, taskBranchName } from '../electron/git-workflow.ts'

test('güvenli Git dal adları kabul edilir, tehlikeli adlar reddedilir', () => {
  assert.equal(normalizeGitBranchName('ultron/task-1234'), 'ultron/task-1234')
  assert.equal(normalizeGitBranchName('  fix_1.2/deneme  '), 'fix_1.2/deneme')
  assert.equal(normalizeGitBranchName('-bad'), null)
  assert.equal(normalizeGitBranchName('bad..name'), null)
  assert.equal(normalizeGitBranchName('bad//name'), null)
  assert.equal(normalizeGitBranchName('bad/'), null)
  assert.equal(normalizeGitBranchName('.hidden'), null)
  assert.equal(normalizeGitBranchName('a/.hidden'), null)
  assert.equal(normalizeGitBranchName('a/b.lock'), null)
  assert.equal(normalizeGitBranchName('HEAD'), null)
  assert.equal(normalizeGitBranchName('main'), null)
  assert.equal(normalizeGitBranchName('master'), null)
  assert.equal(normalizeGitBranchName('a@{b}'), null)
  assert.equal(normalizeGitBranchName('x'.repeat(81)), null)
})

test('commit mesajı tek satıra indirgenir ve kontrol karakterleri reddedilir', () => {
  assert.equal(normalizeGitCommitMessage('  Testleri düzelt\nve tekrar çalıştır  '), 'Testleri düzelt ve tekrar çalıştır')
  assert.equal(normalizeGitCommitMessage('kısa'), 'kısa')
  assert.equal(normalizeGitCommitMessage('üç'), null)
  assert.equal(normalizeGitCommitMessage('x'.repeat(201)), null)
  assert.equal(normalizeGitCommitMessage('geçerli mesaj\u0000gizli'), null)
  assert.equal(normalizeGitCommitMessage(123), null)
})

test('görev kimliğinden güvenli görev dalı adı üretilir', () => {
  assert.equal(taskBranchName('4d2b5cd3-d822-439e-b675-32d8b6caf910'), 'ultron/4d2b5cd3-d822-439e-b675-32d8b6caf910')
  assert.equal(taskBranchName('ABC_DEF 123456'), 'ultron/abc-def-123456')
  assert.equal(taskBranchName('x'), null)
  assert.equal(taskBranchName(null), null)
})
