import assert from 'node:assert/strict'
import test from 'node:test'
import { createCommandEnvironment } from '../electron/command-environment.ts'

test('komut ortamı yaygın anahtar ve token değişkenlerini temizler, Windows geliştirme yollarını korur', () => {
  const environment = createCommandEnvironment({
    PATH: 'C:\\Windows\\System32;C:\\Program Files\\nodejs',
    SystemRoot: 'C:\\Windows',
    ANDROID_HOME: 'C:\\Android\\Sdk',
    USERPROFILE: 'C:\\Users\\Developer',
    OPENAI_API_KEY: 'test-openai-key',
    GITHUB_TOKEN: 'test-github-token',
    AWS_SECRET_ACCESS_KEY: 'test-aws-secret',
    'NPM_CONFIG_//registry.npmjs.org/:_authToken': 'test-npm-token',
    SSH_AUTH_SOCK: 'C:\\Users\\Developer\\ssh-agent.sock',
  })

  assert.equal(environment.PATH, 'C:\\Windows\\System32;C:\\Program Files\\nodejs')
  assert.equal(environment.SystemRoot, 'C:\\Windows')
  assert.equal(environment.ANDROID_HOME, 'C:\\Android\\Sdk')
  assert.equal(environment.USERPROFILE, 'C:\\Users\\Developer')
  for (const name of ['OPENAI_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'NPM_CONFIG_//registry.npmjs.org/:_authToken', 'SSH_AUTH_SOCK']) {
    assert.equal(environment[name], undefined, `${name} komut ortamına aktarılmamalı`)
  }
})

test('URL içinde kullanıcı bilgisi olan ortam değişkenleri aktarılmaz', () => {
  const environment = createCommandEnvironment({
    DATABASE_URL: 'postgres://developer:password@example.invalid/app',
    HTTP_PROXY: 'http://proxy-user:proxy-password@proxy.example.invalid:8080',
    PUBLIC_ENDPOINT: 'https://example.invalid/api',
  })

  assert.equal(environment.DATABASE_URL, undefined)
  assert.equal(environment.HTTP_PROXY, undefined)
  assert.equal(environment.PUBLIC_ENDPOINT, 'https://example.invalid/api')
})
