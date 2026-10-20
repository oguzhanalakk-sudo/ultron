import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebFetchResearchClient, relayAbortSignal, webFetchResearchClient } from '../electron/web-research-fetch.ts'
import { isWebDownloadRequest, parseWebPageToStructured, searchDuckDuckGo } from '../electron/web-research.ts'

const baseRequest = {
  url: 'https://example.com/page',
  timeoutMs: 3_000,
  maxBytes: 2_048,
  method: 'GET' as const,
}

test('web fetch istemcisi özel ağ hedefini fetch çağrısından önce engeller', async () => {
  let fetchCalled = false
  const client = createWebFetchResearchClient(async () => {
    fetchCalled = true
    return new Response('should not be fetched')
  })

  await assert.rejects(client({ ...baseRequest, url: 'http://127.0.0.1:11434/api/tags' }), /URL blocked/u)
  assert.equal(fetchCalled, false)
})

test('web fetch yönlendirmesindeki yerel hedefi ikinci isteği yapmadan engeller', async () => {
  let calls = 0
  const client = createWebFetchResearchClient(async () => {
    calls += 1
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } })
  })

  await assert.rejects(client(baseRequest), /Redirect blocked/u)
  assert.equal(calls, 1)
})

test('başarısız HTTP sayfası çökme yerine durum ve ayrıştırma uyarısı verir', async () => {
  const client = createWebFetchResearchClient(async () => new Response('temporary outage', {
    status: 503,
    headers: { 'content-type': 'text/plain' },
  }))

  const response = await client(baseRequest)
  const parsed = parseWebPageToStructured({
    requestedUrl: baseRequest.url,
    finalUrl: response.finalUrl ?? baseRequest.url,
    status: response.status,
    contentType: response.contentType,
    body: response.body,
  })
  assert.equal(response.status, 503)
  assert.ok(parsed.warnings.includes('http_status_503'))
})

test('web fetch yanıt boyutu sınırını hem Content-Length hem okuma sırasında uygular', async () => {
  const declaredTooLarge = createWebFetchResearchClient(async () => new Response('x'.repeat(1_025), {
    headers: { 'content-type': 'text/plain', 'content-length': '1025' },
  }))
  await assert.rejects(declaredTooLarge({ ...baseRequest, maxBytes: 1_024 }), /exceeds the 1024-byte limit/u)

  const streamedTooLarge = createWebFetchResearchClient(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(700)))
      controller.enqueue(new TextEncoder().encode('y'.repeat(400)))
      controller.close()
    },
  }), { headers: { 'content-type': 'text/plain' } }))
  await assert.rejects(streamedTooLarge({ ...baseRequest, maxBytes: 1_024 }), /exceeds the 1024-byte limit/u)
})

test('ikili web yanıtları UTF-8 dönüşümü olmadan tam baytları korur', async () => {
  const expected = Uint8Array.from([0, 255, 137, 80, 78, 71, 13, 10, 26, 10, 128, 1])
  const client = createWebFetchResearchClient(async () => new Response(expected, {
    headers: { 'content-type': 'image/png' },
  }))
  const response = await client({ ...baseRequest, responseType: 'binary' })

  assert.equal(response.contentType, 'image/png')
  assert.equal(response.body, '')
  assert.deepEqual(response.bodyBytes, expected)
})

test('web indirme isteği Türkçe ve İngilizce fiilleri algılar', () => {
  assert.equal(isWebDownloadRequest('Şu dosyayı indir: https://example.com/file.png'), true)
  assert.equal(isWebDownloadRequest('Please download this file'), true)
  assert.equal(isWebDownloadRequest('Bu sayfayı özetle'), false)
})

test('dış iptal aktif HTTP isteğine aktarılır ve kontrollü iptal hatası döner', async () => {
  const caller = new AbortController()
  let transportSignal: AbortSignal | undefined
  const client = createWebFetchResearchClient((_input, init) => new Promise<Response>((_resolve, reject) => {
    transportSignal = init?.signal as AbortSignal
    transportSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }))
  const pending = client({ ...baseRequest, signal: caller.signal })
  await new Promise((resolve) => setImmediate(resolve))
  caller.abort(new Error('user cancelled'))
  await assert.rejects(pending, /Research time budget was exhausted/u)
  assert.equal(transportSignal?.aborted, true)
})

test('web fetch timeout gerçek HTTP transportunu keser ve timeout olarak raporlar', async () => {
  let transportSignal: AbortSignal | undefined
  const client = createWebFetchResearchClient((_input, init) => new Promise<Response>((_resolve, reject) => {
    transportSignal = init?.signal as AbortSignal
    transportSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }))

  await assert.rejects(client({ ...baseRequest, timeoutMs: 1_000 }), /Web request timed out after 1000 ms/u)
  assert.equal(transportSignal?.aborted, true)
})

test('araştırma iptal sinyali araştırma denetleyicisine aktarılır ve cleanup sonrası aktarılmaz', () => {
  const caller = new AbortController()
  const research = new AbortController()
  const cleanup = relayAbortSignal(caller.signal, research)
  caller.abort('cancel')
  assert.equal(research.signal.aborted, true)
  assert.equal(research.signal.reason, 'cancel')

  const laterCaller = new AbortController()
  const laterResearch = new AbortController()
  const unlink = relayAbortSignal(laterCaller.signal, laterResearch)
  unlink()
  laterCaller.abort()
  assert.equal(laterResearch.signal.aborted, false)
  cleanup()
})

test('gerçek web araştırması: canlı arama ve sonuç sayfası okuma', {
  skip: process.env.ULTRON_RUN_LIVE_WEB_TESTS !== '1' ? 'Canlı ağ doğrulaması ULTRON_RUN_LIVE_WEB_TESTS=1 ile açılır.' : false,
}, async () => {
  const hits = await searchDuckDuckGo({ query: 'TypeScript official documentation latest', limit: 4, language: 'en' }, webFetchResearchClient)
  assert.ok(hits.length > 0, 'canlı arama en az bir sonuç döndürmeli')

  let readable: ReturnType<typeof parseWebPageToStructured> | null = null
  const failures: string[] = []
  for (const hit of hits.slice(0, 4)) {
    try {
      const response = await webFetchResearchClient({ ...baseRequest, url: hit.url, timeoutMs: 12_000, maxBytes: 240_000 })
      if (response.status < 200 || response.status >= 300) {
        failures.push(`${hit.url}: HTTP ${response.status}`)
        continue
      }
      const page = parseWebPageToStructured({
        requestedUrl: hit.url,
        finalUrl: response.finalUrl ?? hit.url,
        status: response.status,
        contentType: response.contentType,
        body: response.body,
        focusTerms: ['TypeScript', 'documentation'],
      })
      if (page.mainText.length >= 80) {
        readable = page
        break
      }
      failures.push(`${hit.url}: okunabilir metin kısa`)
    } catch (error) {
      failures.push(`${hit.url}: ${(error as Error).message}`)
    }
  }
  assert.ok(readable, `arama sonuçlarından okunabilir sayfa alınmalı; denemeler: ${failures.join(' | ')}`)
  assert.ok(readable!.title.length > 0)
  assert.ok(/typescript|documentation|javascript/iu.test(readable!.mainText))
})
