import test from 'node:test'
import assert from 'node:assert/strict'
import { filterSensitiveFileTree, isSensitiveFilePath } from '../electron/sensitive-files.ts'

test('credential files and private-key locations are not readable by the agent', () => {
  for (const file of [
    '.env', '.env.local', 'deploy/.env.production', '.aws/credentials',
    '.ssh/id_ed25519', 'keys/release.pem', 'signing/upload.jks',
    '.npmrc', '.pypirc', '.netrc', '.git-credentials',
    '.config/gcloud/application_default_credentials.json', 'config/service-account.json',
  ]) assert.equal(isSensitiveFilePath(file), true, `${file} should be treated as sensitive`)
})

test('safe environment examples and ordinary source files remain accessible', () => {
  for (const file of ['.env.example', '.env.sample', '.env.template', 'src/config.ts', 'docs/environment.md']) {
    assert.equal(isSensitiveFilePath(file), false, `${file} should remain available`)
  }
})

test('agent file listing removes sensitive files without removing their ordinary parent directories', () => {
  const tree = [{ name: 'config', path: 'config', kind: 'directory' as const, children: [
    { name: '.env', path: 'config/.env', kind: 'file' as const },
    { name: '.env.example', path: 'config/.env.example', kind: 'file' as const },
  ] }, { name: '.ssh', path: '.ssh', kind: 'directory' as const }]
  assert.deepEqual(filterSensitiveFileTree(tree), [{ name: 'config', path: 'config', kind: 'directory', children: [
    { name: '.env.example', path: 'config/.env.example', kind: 'file' },
  ] }])
})
