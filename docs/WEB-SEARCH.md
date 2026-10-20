# Ultron web search

Ultron's research panel and agent tools share the same search path:

1. Brave Search API is tried first when a Brave key is configured.
2. Existing configured search adapters are tried next for backward compatibility.
3. DuckDuckGo's public HTML search and keyless Stack Exchange, Hacker News, and Wikipedia adapters are fallbacks. A fallback is shown in the research note; it is not reported as a Brave result.
4. `web_research` opens the highest-ranked result pages and extracts readable text. `fetch_web_page` reads an individual result. Only public HTTP(S) URLs pass the URL safety filter; page text is marked as untrusted input.

## Configure Brave Search

1. Create an API key in the [Brave Search API dashboard](https://api-dashboard.search.brave.com/).
2. Open Ultron's **Araştırma** panel and paste the key into **Brave Search API anahtarı**, then choose **Anahtarı kaydet**.
3. Ultron stores the key in `brave-search-key.json` under Electron's per-user `userData` directory, encrypted with Electron `safeStorage` (Windows uses the OS-backed storage). The key is not returned over the renderer bridge. If safe storage is unavailable, saving fails instead of writing a plaintext key.
4. Alternatively, set `ULTRON_BRAVE_SEARCH_API_KEY` in the environment before starting Ultron. The environment value takes precedence over the encrypted local key.

The API key goes to Brave only in `X-Subscription-Token`; it is not placed in the URL. Search requests have a 12-second timeout and include a bounded result count. Search results are not retained in Ultron's local search cache. Common bearer and API-key-looking values in queries are redacted before requests are sent.

## Provider terms and privacy

Brave currently lists Search at **$5 per 1,000 requests** and advertises **$5 in monthly credits**; the account dashboard is authoritative because plans can change. Brave's privacy statement says API search queries may be retained for up to **90 days** for billing and troubleshooting. Do not submit passwords, API keys, private customer data, or other confidential text as a search query. See the current [pricing](https://api-dashboard.search.brave.com/documentation/pricing), [authentication](https://api-dashboard.search.brave.com/documentation/guides/authentication), [Search API terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service), and [privacy policy](https://api-dashboard.search.brave.com/privacy-policy).

## Verification

- `tests/web-research.test.ts` covers Brave request construction, result parsing, URL rejection, HTTP errors, timeout handling, and the DuckDuckGo fallback adapter.
- `tests/secure-secret-store.test.ts` checks encrypted-at-rest storage and fail-closed behavior when OS-backed encryption is unavailable.
- A live, keyless DuckDuckGo search and a fetch of the first result page were run during implementation. Brave's authenticated live endpoint remains unverified until the user configures a key.
