import { chromium } from 'playwright-core'

// Kurulu Ultron'un CANLI durumunu derinlemesine inceler: görevler, model durumu,
// son aktiviteler ve açık projenin dosya ağacı.
const debugPort = process.env.INSPECT_DEBUG_PORT || '9333'

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
try {
  const page = browser.contexts()[0]?.pages()[0]
  if (!page) throw new Error('Ultron penceresi bulunamadı')
  await page.waitForSelector('.app-shell', { timeout: 20_000 })

  const data = await page.evaluate(async () => {
    const api = window.kodAtolyesi
    const safe = async (name, args) => {
      try { return await api[name](...(args ?? [])) } catch (error) { return { __error: String(error) } }
    }
    const tasks = await safe('getTasks')
    const status = await safe('getStatus')
    const localAi = await safe('getLocalAIStatus')
    const tree = await safe('getTree')
    const audit = await safe('getAudit')
    return {
      tasks: Array.isArray(tasks) ? tasks.slice(-8).map((t) => ({
        id: t.id, title: (t.title ?? t.request ?? '').slice(0, 110), status: t.status,
        createdAt: t.createdAt, updatedAt: t.updatedAt, error: (t.error ?? t.reason ?? '')?.slice?.(0, 200) ?? null,
        plan: Array.isArray(t.plan) ? t.plan.length : undefined
      })) : tasks,
      status: status?.__error ? status : { project: status?.project?.root, model: status?.model?.name, provider: status?.model?.provider },
      localAi: localAi?.__error ? localAi : {
        provider: localAi?.provider, ready: localAi?.ready, models: Array.isArray(localAi?.models) ? localAi.models.map((m) => m.name) : undefined,
        error: localAi?.error
      },
      tree: tree?.__error ? tree : (Array.isArray(tree) ? tree.length : Object.keys(tree ?? {}).slice(0, 20)),
      auditTail: Array.isArray(audit) ? audit.slice(-12).map((a) => ({ kind: a.kind, title: a.title, detail: (a.detail ?? '').slice(0, 160), time: a.time, result: a.result, error: a.error?.slice?.(0, 160) })) : audit
    }
  })
  console.log(JSON.stringify(data, null, 2))
} finally {
  await browser.close().catch(() => undefined)
}
