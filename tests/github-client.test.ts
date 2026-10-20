import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeGithubContent, githubRequest, summarizeGithubUser, validateGithubPath, validateGithubRepo } from '../electron/github-client.ts'

test('GitHub sahip, depo ve dosya yolları doğrulanır', () => {
  assert.deepEqual(validateGithubRepo('ultron-dev', 'desktop.app'), { owner: 'ultron-dev', repo: 'desktop.app' })
  assert.throws(() => validateGithubRepo('../bad', 'repo'))
  assert.equal(validateGithubPath('src\\App.tsx'), 'src/App.tsx')
  assert.throws(() => validateGithubPath('../secret'))
})

test('GitHub REST isteği tokenı yalnız headerda taşır ve yetki hatasını açıklar', async () => {
  let seen: RequestInit | undefined
  const fetcher = async (_url: string, init?: RequestInit) => { seen = init; return new Response(JSON.stringify({ login: 'ada' }), { status: 200 }) }
  assert.deepEqual(await githubRequest({ path: '/user', token: 'secret-token', fetcher }), { login: 'ada' })
  assert.equal((seen?.headers as Record<string, string>).Authorization, 'Bearer secret-token')
  await assert.rejects(() => githubRequest({ path: '/user', fetcher: async () => new Response(JSON.stringify({ message: 'Requires authentication' }), { status: 401 }) }), /kimlik doğrulaması/i)
})

test('GitHub dosya içeriği ve kullanıcı özeti güvenle ayrıştırılır', () => {
  assert.deepEqual(decodeGithubContent({ path: 'README.md', encoding: 'base64', content: 'bWVy aGFiYQ=='.replace(' ', '') }), { path: 'README.md', content: 'merhaba' })
  assert.deepEqual(summarizeGithubUser({ login: 'ada', name: 'Ada' }), { login: 'ada', name: 'Ada' })
})
