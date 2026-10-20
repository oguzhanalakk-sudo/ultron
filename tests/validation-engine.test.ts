import test from 'node:test'
import assert from 'node:assert/strict'
import { ValidationEngine } from '../electron/validation-engine.ts'

test('validation engine komut sonuçlarını doğru statüye ve kanıta dönüştürür', async () => {
  const calls: string[] = []
  const engine = new ValidationEngine(async (command) => {
    calls.push(command)
    return command.includes('build') ? { code: 1, stdout: '', stderr: 'Build failed: missing module' } : { code: 0, stdout: 'ok', stderr: '' }
  })
  const results = await engine.runValidationPlan({ projectType: 'generic', changedFiles: ['src/App.tsx'], requiredChecks: ['typecheck', 'build'], optionalChecks: [] })
  assert.deepEqual(calls, ['npm run typecheck', 'npm run build'])
  assert.equal(results[0].status, 'passed')
  assert.equal(results[1].status, 'failed')
  assert.match(results[1].issue ?? '', /Build failed/)
})

test('null çıkış kodu blocked, hata analizi bağımlılık olarak raporlanır', async () => {
  const engine = new ValidationEngine(async () => ({ code: null, stdout: '', stderr: 'Cannot find module react' }))
  const result = (await engine.runValidationPlan({ projectType: 'generic', changedFiles: [], requiredChecks: ['typecheck'], optionalChecks: [] }))[0]
  assert.equal(result.status, 'blocked')
  assert.equal(ValidationEngine.analyzeFailure(result.stderr).category, 'dependency')
})
