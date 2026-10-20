import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentLimitError, AgentOrchestrator, analyzeAgentError, compactAgentContext, computeAgentContextBudget, DEFAULT_AGENT_LIMITS, shouldStopForIdleTurns } from '../electron/agent-orchestrator.ts'

test('üst üste araçsız turlar açık plan varken güvenli durma eşiğine ulaşır', () => {
  assert.equal(shouldStopForIdleTurns(1, 2), false)
  assert.equal(shouldStopForIdleTurns(2, 2), false)
  assert.equal(shouldStopForIdleTurns(3, 2), true)
  assert.equal(shouldStopForIdleTurns(3, 0), false, 'Açık adım yoksa boş tur sayacı durdurmamalı')
  assert.equal(shouldStopForIdleTurns(3, 2, 5), false)
  assert.equal(shouldStopForIdleTurns(3, 0, 3, true), true, 'Çalıştırılmamış kabul testi veya başarısız kontrol varken boş turlar durdurmalı')
  assert.equal(shouldStopForIdleTurns(2, 0, 3, true), false, 'Doğrulama eksik olsa da durma eşiği korunur')
  assert.equal(shouldStopForIdleTurns(3, 0, 5, true), false, 'Özel tur eşiği doğrulama eksikliğinde de geçerli')
})

test('bir yanıttaki çoklu çağrı, görev araç ve parametre bütçelerini atomik denetler', () => {
  const limits = { ...DEFAULT_AGENT_LIMITS, maxToolCalls: 3, maxToolCallsPerTurn: 2, maxToolArgumentsPerTurn: 10 }
  const agent = new AgentOrchestrator(limits)
  agent.reserveToolBatch(2, 8)
  assert.equal(agent.snapshot.toolCalls, 2)
  assert.throws(() => agent.reserveToolBatch(2, 8), (error) => error instanceof AgentLimitError && error.limit === 'tool-calls')
  assert.equal(agent.snapshot.toolCalls, 2, 'Reddedilen batch bütçeyi tüketmemeli')
  assert.throws(() => agent.reserveToolBatch(3, 8), (error) => error instanceof AgentLimitError && error.limit === 'tool-batch')
  assert.throws(() => agent.reserveToolBatch(1, 11), (error) => error instanceof AgentLimitError && error.limit === 'tool-arguments')
})

test('süre sınırı aşılırsa yeni araç batchi yürütülmez', () => {
  let now = 100
  const limits = { ...DEFAULT_AGENT_LIMITS, maxDurationMs: 50 }
  const agent = new AgentOrchestrator(limits, () => now, 100)
  agent.reserveToolBatch(1, 1)
  now = 151
  assert.throws(() => agent.reserveToolBatch(1, 1), (error) => error instanceof AgentLimitError && error.limit === 'duration')
})

test('başarısız çağrılar düzeltme sayacına yazılır ama görevi kesmez', () => {
  const limits = { ...DEFAULT_AGENT_LIMITS, maxCorrectionAttempts: 2 }
  const agent = new AgentOrchestrator(limits)
  assert.equal(agent.recordToolFailure('read_file:{bad}').shouldBlock, false)
  assert.equal(agent.recordToolFailure('read_file:{bad}').shouldBlock, false)
  assert.equal(agent.recordToolFailure('read_file:{bad}').shouldBlock, false, 'Tekrarlanan hatalı çağrı görev bütçesi bitmeden kesilmemeli')
  const separate = new AgentOrchestrator(limits)
  assert.equal(separate.recordToolFailure('a').shouldBlock, false)
  assert.equal(separate.recordToolFailure('b').shouldBlock, false)
  assert.equal(separate.recordToolFailure('c').shouldBlock, false, 'Farklı hatalar düzeltme sayacına yazılsa da görev kesilmemeli')
})

test('araç çıktısını tanımlı maksimum boyutta kısaltır', () => {
  const agent = new AgentOrchestrator({ ...DEFAULT_AGENT_LIMITS, maxToolOutputChars: 100 })
  const output = agent.limitOutput('x'.repeat(400))
  assert.ok(output.length <= 100)
  assert.match(output, /kısaltıldı/)
})

test('hata analizörü istenen hata kategorilerini ayırır', () => {
  assert.equal(analyzeAgentError({ message: 'EACCES: permission denied', stage: 'executing' }).category, 'permission')
  assert.equal(analyzeAgentError({ message: 'Cannot find module react', stage: 'testing' }).category, 'dependency')
  assert.equal(analyzeAgentError({ message: "ModuleNotFoundError: No module named 'jsonper'", stage: 'executing' }).category, 'dependency')
  assert.equal(analyzeAgentError({ message: 'ImportError: cannot import name toplam', stage: 'executing' }).category, 'dependency')
  assert.equal(analyzeAgentError({ message: 'IndentationError: unexpected indent', stage: 'correcting' }).category, 'syntax')
  assert.equal(analyzeAgentError({ message: "NameError: name 'toplam' is not defined", stage: 'evaluating' }).category, 'runtime')
  assert.equal(analyzeAgentError({ message: 'Test failed: expected 2 got 1', stage: 'testing' }).category, 'test')
  assert.equal(analyzeAgentError({ message: 'Gradle BUILD FAILED: compilation error', stage: 'testing' }).category, 'build')
  assert.equal(analyzeAgentError({ message: 'TypeError exception in runtime', stage: 'evaluating' }).category, 'runtime')
  assert.equal(analyzeAgentError({ message: 'SyntaxError: unexpected token', stage: 'correcting' }).category, 'syntax')
  assert.equal(analyzeAgentError({ message: 'Invalid configuration value', stage: 'planning' }).category, 'configuration')
  assert.equal(analyzeAgentError({ message: 'ENOENT: no such file or directory', stage: 'executing' }).category, 'filesystem')
  assert.equal(analyzeAgentError({ message: "ENOENT: no such file or directory, realpath 'C:\\proje\\mobileconnectionapp\\MainActivity.java'", stage: 'executing' }).category, 'filesystem')
  assert.equal(analyzeAgentError({ message: 'ECONNREFUSED network request', stage: 'analyzing' }).category, 'network')
  assert.equal(analyzeAgentError({ message: 'JavaScript heap out of memory', stage: 'testing' }).category, 'resources')
  assert.equal(analyzeAgentError({ message: 'Something unexpected happened', stage: 'evaluating' }).category, 'unknown')
})

test('bağlam budama araç çağrısı ile sonuç kimlik eşleşmesini korur', () => {
  const toolCall = { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old'.repeat(100) },
    { role: 'assistant', content: 'old response'.repeat(100) },
    toolCall,
    { role: 'tool', tool_call_id: 't1', name: 'read_file', content: 'result'.repeat(100) },
  ]
  const compacted = compactAgentContext(messages, 300)
  assert.equal(compacted[0], messages[0])
  assert.ok(compacted.includes(messages[1]), 'En yeni kullanıcı mesajı aşırı küçük bütçede bile korunmalı')
  assert.ok(compacted.some((item) => item.tool_calls === toolCall.tool_calls))
  const toolResult = compacted.find((item) => item.role === 'tool' && item.tool_call_id === 't1')
  assert.ok(toolResult, 'araç çağrısı sonucu korunmalı')
  assert.ok(String(toolResult.content).length < 'result'.repeat(100).length, 'eski araç çıktısı bütçeye göre kısaltılmalı')
})

test('bağlam bütçesi aşılırsa en yeni kullanıcı görevi ve etkin araç turu korunur', () => {
  const toolCall = { role: 'assistant', content: '', tool_calls: [{ id: 't2', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }
  const latestRequest = { role: 'user', content: 'verification-recover: dosyayı düzelt ve testi tekrar çalıştır' }
  const messages = [
    { role: 'system', content: 'system'.repeat(500) },
    { role: 'user', content: 'çok eski konuşma'.repeat(100) },
    latestRequest,
    toolCall,
    { role: 'tool', tool_call_id: 't2', name: 'read_file', content: 'dosya içeriği' },
  ]

  const compacted = compactAgentContext(messages, 250)
  assert.ok(compacted.includes(latestRequest), 'çok büyük sistem istemi son kullanıcı görevini silememeli')
  assert.ok(compacted.includes(toolCall), 'etkin araç çağrısı korunmalı')
  assert.ok(compacted.some((item) => item.role === 'tool' && item.tool_call_id === 't2'), 'etkin araç sonucu korunmalı')
  assert.ok(!compacted.some((item) => item.content?.includes('çok eski konuşma')), 'eski sohbet bağlamı önce atılmalı')
})

test('bağlam bütçesi araç şeması ve çıktı payını gerçek pencereye göre düşürür', () => {
  const fullSchema = computeAgentContextBudget({ contextWindow: 16_384, toolSchemaCharacters: 28_372 })
  const filteredSchema = computeAgentContextBudget({ contextWindow: 16_384, toolSchemaCharacters: 13_000 })
  assert.ok(fullSchema >= 6_000)
  assert.ok(fullSchema < 10_000, `tam şema bütçesi çok yüksek: ${fullSchema}`)
  assert.ok(filteredSchema > fullSchema)
  assert.ok(filteredSchema < DEFAULT_AGENT_LIMITS.maxContextChars)
})

test('bağlam bütçesi üst sınırı aşmaz ve çok küçük pencerede güvenli tabanı korur', () => {
  assert.equal(computeAgentContextBudget({ contextWindow: 131_072, toolSchemaCharacters: 0 }), DEFAULT_AGENT_LIMITS.maxContextChars)
  assert.equal(computeAgentContextBudget({ contextWindow: 4_096, toolSchemaCharacters: 60_000 }), 6_000)
})
