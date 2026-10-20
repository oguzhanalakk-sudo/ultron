import assert from 'node:assert/strict'
import test from 'node:test'
import { validateGitArguments, validateRepoTarget } from '../electron/git-operations.ts'

test('Git argümanları yalnızca tanımlı ve güvenli eylemleri kabul eder', () => {
  assert.equal(validateGitArguments(['status', '--short']).ok, true)
  assert.equal(validateGitArguments(['commit', '-m', 'güvenli değişiklik']).ok, true)
  assert.equal(validateGitArguments(['push', '--force']).ok, false)
  assert.equal(validateGitArguments(['commit', '--amend']).ok, false)
  assert.equal(validateGitArguments(['config', '--global', 'x=y']).ok, false)
})

test('GitHub repo hedefi biçimsel olarak doğrulanır', () => {
  assert.equal(validateRepoTarget('oguzhanalakk-sudo', 'ultron').ok, true)
  assert.equal(validateRepoTarget('../owner', 'repo').ok, false)
})
