// Minimal GitHub REST client. It deliberately uses the platform fetch API rather
// than a third-party SDK, so authentication, request scope and returned data stay
// visible to Ultron's permission and audit layers.
const apiBase = 'https://api.github.com'
const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const repoPattern = /^[A-Za-z0-9_.-]{1,100}$/

export type GithubFetch = (input: string, init?: RequestInit) => Promise<Response>

export function validateGithubRepo(owner: unknown, repo: unknown): { owner: string; repo: string } {
  if (typeof owner !== 'string' || !ownerPattern.test(owner)) throw new Error('GitHub sahip adı geçersiz.')
  if (typeof repo !== 'string' || !repoPattern.test(repo)) throw new Error('GitHub depo adı geçersiz.')
  return { owner, repo }
}

export function validateGithubPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error('GitHub dosya yolu geçersiz.')
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('GitHub dosya yolu proje dışına çıkamaz.')
  return normalized
}

export async function githubRequest<T>(input: { path: string; method?: string; token?: string | null; body?: unknown; fetcher?: GithubFetch }): Promise<T> {
  if (!input.path.startsWith('/')) throw new Error('GitHub API yolu geçersiz.')
  const fetcher = input.fetcher ?? fetch
  const response = await fetcher(`${apiBase}${input.path}`, {
    method: input.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Ultron-Desktop',
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
      ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  let payload: unknown = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text.slice(0, 800) }
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload ? String((payload as { message: unknown }).message) : `HTTP ${response.status}`
    if (response.status === 401) throw new Error('GitHub kimlik doğrulaması başarısız. ULTRON_GITHUB_TOKEN değerini kontrol edin.')
    if (response.status === 403) throw new Error(`GitHub işlemi yetkilendirilmedi: ${message}`)
    if (response.status === 404) throw new Error('GitHub kaynağı bulunamadı veya bu token için görünür değil.')
    throw new Error(`GitHub API hatası (${response.status}): ${message}`)
  }
  return payload as T
}

export function summarizeGithubUser(value: unknown) {
  const user = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { login: typeof user.login === 'string' ? user.login : null, name: typeof user.name === 'string' ? user.name : null }
}

export function decodeGithubContent(value: unknown): { path: string; content: string } {
  const file = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (typeof file.path !== 'string' || typeof file.content !== 'string' || file.encoding !== 'base64') throw new Error('GitHub dosya yanıtı beklenen base64 biçiminde değil.')
  const content = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8')
  if (content.length > 500_000) throw new Error('GitHub dosyası 500 KB sınırını aşıyor.')
  return { path: file.path, content }
}
