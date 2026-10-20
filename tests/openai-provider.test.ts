import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { extractSseEvents, fetchOpenAiModels, streamOpenAiCompletion, toOpenAiMessages } from '../electron/openai-provider.ts'

async function withServer(handler: (request: http.IncomingMessage, response: http.ServerResponse) => void) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

test('araç mesajları OpenAI biçimine tool_call_id ve adla çevrilir', () => {
  const converted = toOpenAiMessages([
    { role: 'system', content: 'sistem' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: 'içerik' },
  ])
  assert.deepEqual(converted[0], { role: 'system', content: 'sistem' })
  assert.equal((converted[1] as { tool_calls: Array<{ id: string }> }).tool_calls[0]!.id, 'call_1')
  assert.deepEqual(converted[2], { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: 'içerik' })
})

test('SSE ayrıştırıcısı parçalı veriyi olaylara böler ve artığı saklar', () => {
  const first = extractSseEvents('data: {"a":1}\n\ndata: {"b"')
  assert.deepEqual(first.events, ['{"a":1}'])
  assert.equal(first.rest, 'data: {"b"')
  const second = extractSseEvents(`${first.rest}:2}\n\ndata: [DONE]\n\n`)
  assert.deepEqual(second.events, ['{"b":2}', '[DONE]'])
  assert.equal(second.rest, '')
})

test('OpenAI uyumlu akış içerik parçalarını birleştirir', async () => {
  const server = await withServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"content":"Merhaba"}}]}\n\n')
    response.write('data: {"choices":[{"delta":{"content":" dünya"},"finish_reason":"stop"}]}\n\n')
    response.write('data: [DONE]\n\n')
    response.end()
  })
  try {
    const pieces: string[] = []
    const result = await streamOpenAiCompletion({
      baseUrl: server.baseUrl, model: 'test-model', apiKey: 'sk-test-key-1234567890',
      messages: [{ role: 'user', content: 'selam' }], tools: [], signal: AbortSignal.timeout(5_000),
      onDelta: (piece) => pieces.push(piece),
    })
    assert.equal(result.content, 'Merhaba dünya')
    assert.deepEqual(pieces, ['Merhaba', ' dünya'])
    assert.equal(result.finishReason, 'stop')
  } finally {
    await server.close()
  }
})

test('OpenAI uyumlu akış parçalı araç çağrısını birleştirir', async () => {
  const server = await withServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n')
    response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n')
    response.write('data: [DONE]\n\n')
    response.end()
  })
  try {
    const result = await streamOpenAiCompletion({
      baseUrl: server.baseUrl, model: 'test-model', apiKey: null,
      messages: [{ role: 'user', content: 'dosyayı oku' }], tools: [{ type: 'function', function: { name: 'read_file' } }], signal: AbortSignal.timeout(5_000),
    })
    assert.equal(result.finishReason, 'tool_calls')
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.toolCalls[0]!.id, 'call_9')
    assert.equal(result.toolCalls[0]!.function.name, 'read_file')
    assert.deepEqual(JSON.parse(result.toolCalls[0]!.function.arguments), { path: 'a.txt' })
  } finally {
    await server.close()
  }
})

test('kimlik doğrulama hatası API anahtarını sızdırmaz', async () => {
  const key = 'sk-very-secret-1234567890'
  const server = await withServer((_request, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: `invalid api key ${key}` } }))
  })
  try {
    await assert.rejects(
      () => streamOpenAiCompletion({
        baseUrl: server.baseUrl, model: 'test-model', apiKey: key,
        messages: [{ role: 'user', content: 'selam' }], tools: [], signal: AbortSignal.timeout(5_000),
      }),
      (error: Error) => {
        assert.equal(error.message.includes(key), false)
        assert.match(error.message, /kimlik doğrulaması/i)
        return true
      },
    )
  } finally {
    await server.close()
  }
})

test('boş akış boş veya geçersiz yanıt hatası verir', async () => {
  const server = await withServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write('data: [DONE]\n\n')
    response.end()
  })
  try {
    await assert.rejects(
      () => streamOpenAiCompletion({
        baseUrl: server.baseUrl, model: 'test-model', apiKey: null,
        messages: [{ role: 'user', content: 'selam' }], tools: [], signal: AbortSignal.timeout(5_000),
      }),
      /boş veya geçersiz/i,
    )
  } finally {
    await server.close()
  }
})

test('akışı yok sayan sunucunun tek JSON yanıtı da işlenir', async () => {
  const server = await withServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'tek yanıt' }, finish_reason: 'stop' }] }))
  })
  try {
    const result = await streamOpenAiCompletion({
      baseUrl: server.baseUrl, model: 'test-model', apiKey: null,
      messages: [{ role: 'user', content: 'selam' }], tools: [], signal: AbortSignal.timeout(5_000),
    })
    assert.equal(result.content, 'tek yanıt')
  } finally {
    await server.close()
  }
})

test('model listesi /models yanıtından sıralı ve tekrarsız okunur', async () => {
  const server = await withServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'b-model' }] }))
  })
  try {
    const models = await fetchOpenAiModels({ baseUrl: server.baseUrl, apiKey: 'sk-test-key-1234567890', signal: AbortSignal.timeout(5_000) })
    assert.deepEqual(models, ['a-model', 'b-model'])
  } finally {
    await server.close()
  }
})
