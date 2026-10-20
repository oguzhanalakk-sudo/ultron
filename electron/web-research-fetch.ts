import {
  validateFetchableUrl,
  webResearchLimits,
  type WebFetchResearchClient,
  type WebFetchRequest,
} from './web-research.ts'

/** Forwards caller cancellation to a private controller and returns listener cleanup. */
export function relayAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined
  const abort = () => target.abort(source.reason)
  if (source.aborted) abort()
  else source.addEventListener('abort', abort, { once: true })
  return () => source.removeEventListener('abort', abort)
}

/**
 * The production research transport. Keeping fetch injectable lets tests exercise
 * redirect, timeout, cancellation, and response-size behavior without network calls.
 */
export function createWebFetchResearchClient(fetchImpl: typeof fetch = globalThis.fetch): WebFetchResearchClient {
  return async (request) => {
    const timeoutMs = Math.min(Math.max(Number(request.timeoutMs) || webResearchLimits.pageFetchTimeoutMs, 1_000), 120_000)
    const maxBytes = Math.min(Math.max(Number(request.maxBytes) || webResearchLimits.pageFetchMaxBytes, 1_024), 20 * 1024 * 1024)
    const controller = new AbortController()
    const unlinkCallerAbort = relayAbortSignal(request.signal, controller)
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const maxRedirects = 5
    let currentUrl = request.url
    let method = request.method ?? 'GET'
    let body = method === 'POST' ? request.body : undefined
    const headers: Record<string, string> = {
      'User-Agent': 'UltronResearch/1.0',
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.6',
      'Accept-Language': 'tr,en;q=0.8',
      ...(request.headers ?? {}),
    }

    try {
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        const safe = validateFetchableUrl(currentUrl)
        if (!safe.ok) throw new Error(`URL blocked: ${safe.reason}`)
        if (safe.url.username || safe.url.password) throw new Error('URL credentials are not allowed for web research.')

        request.onRequestAttempt?.()
        const response = await fetchImpl(safe.url.toString(), {
          method,
          headers,
          body,
          redirect: 'manual',
          signal: controller.signal,
        })

        const location = response.headers.get('location')
        const isRedirect = [301, 302, 303, 307, 308].includes(response.status)
        if (isRedirect && location) {
          if (redirectCount === maxRedirects) {
            await response.body?.cancel().catch(() => undefined)
            throw new Error(`Too many redirects (maximum ${maxRedirects}).`)
          }
          let nextUrl: URL
          try { nextUrl = new URL(location, safe.url) }
          catch {
            await response.body?.cancel().catch(() => undefined)
            throw new Error('Redirect URL is invalid.')
          }
          const nextSafe = validateFetchableUrl(nextUrl.toString())
          if (!nextSafe.ok) {
            await response.body?.cancel().catch(() => undefined)
            throw new Error(`Redirect blocked: ${nextSafe.reason}`)
          }
          if (nextSafe.url.username || nextSafe.url.password) {
            await response.body?.cancel().catch(() => undefined)
            throw new Error('Redirect URL credentials are not allowed for web research.')
          }
          if (safe.url.protocol === 'https:' && nextSafe.url.protocol === 'http:') {
            await response.body?.cancel().catch(() => undefined)
            throw new Error('HTTPS to HTTP redirects are blocked for web research.')
          }
          if (nextSafe.url.origin !== safe.url.origin) {
            if (body !== undefined) {
              await response.body?.cancel().catch(() => undefined)
              throw new Error('Cross-origin redirects with a request body are blocked.')
            }
            for (const headerName of Object.keys(headers)) {
              if (/(?:authorization|proxy-authorization|token|api[-_]?key|secret|cookie|credential)/iu.test(headerName)) delete headers[headerName]
            }
          }
          await response.body?.cancel().catch(() => undefined)
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
            method = 'GET'
            body = undefined
            delete headers['Content-Type']
            delete headers['content-type']
            delete headers['Content-Length']
            delete headers['content-length']
          }
          currentUrl = nextSafe.url.toString()
          continue
        }
        if (isRedirect && !location) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(`HTTP ${response.status} redirect did not include a Location header.`)
        }

        const finalUrl = response.url || safe.url.toString()
        const finalSafe = validateFetchableUrl(finalUrl)
        if (!finalSafe.ok || finalSafe.url.username || finalSafe.url.password) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(`Final URL blocked: ${finalSafe.ok ? 'URL credentials are not allowed.' : finalSafe.reason}`)
        }
        const contentType = response.headers.get('content-type')
        const declaredLength = Number(response.headers.get('content-length'))
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          await response.body?.cancel().catch(() => undefined)
          throw new Error(`Response body exceeds the ${maxBytes}-byte limit.`)
        }

        const reader = response.body?.getReader()
        if (!reader) return { status: response.status, contentType, finalUrl: finalSafe.url.toString(), body: '' }
        const decoder = new TextDecoder()
        const byteChunks: Uint8Array[] = []
        let text = ''
        let received = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue
            received += value.byteLength
            if (received > maxBytes) {
              await reader.cancel().catch(() => undefined)
              throw new Error(`Response body exceeds the ${maxBytes}-byte limit.`)
            }
            if (request.responseType === 'binary') byteChunks.push(value)
            else text += decoder.decode(value, { stream: true })
          }
          if (request.responseType !== 'binary') text += decoder.decode()
        } catch (error) {
          await reader.cancel().catch(() => undefined)
          throw error
        }
        if (request.responseType === 'binary') {
          const bodyBytes = new Uint8Array(received)
          let offset = 0
          for (const chunk of byteChunks) {
            bodyBytes.set(chunk, offset)
            offset += chunk.byteLength
          }
          return { status: response.status, contentType, finalUrl: finalSafe.url.toString(), body: '', bodyBytes }
        }
        return { status: response.status, contentType, finalUrl: finalSafe.url.toString(), body: text }
      }
      throw new Error('Redirect handling ended unexpectedly.')
    } catch (error) {
      if (request.signal?.aborted) throw new Error('Research time budget was exhausted.')
      if (timedOut) throw new Error(`Web request timed out after ${timeoutMs} ms.`)
      throw error
    } finally {
      clearTimeout(timeout)
      unlinkCallerAbort()
    }
  }
}

export const webFetchResearchClient = createWebFetchResearchClient()
