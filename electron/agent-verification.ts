import { createHash } from 'node:crypto'
import type { AgentErrorAnalysis, VerificationFailure, VerificationReceipt } from './shared.ts'

const commandTools = new Set(['run_command', 'run_tests', 'run_powershell', 'android_install', 'android_launch'])
const structuredTools = new Set(['build_android', 'windows_build', 'web_http_check'])
const resultTools = new Set(['undo_change', 'web_stop_service'])
const approvalTools = new Set(['delete_file', 'rename_path', 'web_database', 'web_start_service', 'network_inventory'])
export const isVerificationTool = (tool: string) => commandTools.has(tool) || structuredTools.has(tool)
type ToolOutcome = { failed: boolean; exitCode?: number; message?: string }
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

// Inspect envelopes produced by our tools, never status-like text inside file/HTTP bodies.
export function assessToolOutcome(tool: string, output: string): ToolOutcome {
  if (!isVerificationTool(tool) && !resultTools.has(tool) && !approvalTools.has(tool)) return { failed: false }
  const denied = /^(?:Kullanıcı işlemin çalıştırılmasını reddetti|İşlem kullanıcı tarafından (?:reddedildi|iptal edildi)|İşlem başarısız:)/i.test(output)
  if (denied) return { failed: true, message: output.slice(0, 1_000) }
  if (approvalTools.has(tool)) return { failed: false }
  if (commandTools.has(tool)) {
    const match = output.match(/^Komut çıkış kodu:\s*(-?\d+)(?:\s|$)/i)
    if (!match) return { failed: true, message: 'Komut sonucu doğrulanamadı: çıkış kodu yok.' }
    const exitCode = Number(match[1])
    return { failed: exitCode !== 0, exitCode, ...(exitCode !== 0 ? { message: output.slice(-2_000) } : {}) }
  }
  let result: Record<string, unknown> | undefined
  try { result = object(JSON.parse(output)) } catch { /* malformed tool envelope is not success */ }
  if (!result) return { failed: true, message: 'Doğrulama aracı geçerli sonuç nesnesi döndürmedi.' }
  if (resultTools.has(tool)) return { failed: result.ok !== true, ...(result.ok !== true ? { message: String(result.message ?? 'İşlem başarısız.') } : {}) }
  if (tool === 'web_http_check') return { failed: result.ok !== true, ...(result.ok !== true ? { message: `Yerel HTTP doğrulaması başarısız: ${String(result.status ?? result.error ?? 'yanıt yok')}` } : {}) }
  const build = object(result.build)
  if (tool === 'windows_build') {
    if (!build && object(result.analysis) && result.success === undefined) return { failed: false } // analyze action
    const failure = object(build?.failure)
    return { failed: result.success !== true || Boolean(failure), ...(result.success !== true || failure ? { message: String(failure?.summary ?? 'Windows derleme/başlatma doğrulaması başarısız.') } : {}) }
  }
  const exitCode = typeof build?.exitCode === 'number' && Number.isFinite(build.exitCode) ? build.exitCode : undefined
  const failure = object(result.analysis) ?? object(object(build?.android)?.failure)
  const failed = exitCode !== 0 || Boolean(failure)
  return { failed, exitCode, ...(failed ? { message: String(failure?.summary ?? 'Android doğrulaması başarısız veya çıkış kodu doğrulanamadı.') } : {}) }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  const data = object(value)
  return data ? Object.fromEntries(Object.keys(data).sort().map((key) => [key, canonical(data[key])])) : value
}

export function verificationKey(tool: string, args: string) {
  let identity: unknown = args
  try {
    const parsed = object(JSON.parse(args))
    if (parsed) identity = canonical(Object.fromEntries(Object.entries(parsed).filter(([key]) => !['reason', 'note', 'timeout_ms'].includes(key))))
  } catch { /* the hash never persists raw malformed arguments */ }
  return createHash('sha256').update(JSON.stringify([tool, identity])).digest('hex')
}

export const acceptanceCommandKey = (command: string) => createHash('sha256').update(command.trim()).digest('hex')
export const isChangeVerification = (receipt: VerificationReceipt) => receipt.tool === 'run_tests' || ['build_android', 'windows_build'].includes(receipt.tool) && ['test', 'build'].includes(receipt.kind ?? '')
export function isExecutableVerification(tool: string, args: string) {
  if (!isVerificationTool(tool)) return false
  if (tool === 'windows_build') {
    try { if (JSON.parse(args).action === 'analyze') return false } catch { return false }
  }
  return true
}

const staleAnalysis = (tool: string): AgentErrorAnalysis => ({ category: 'test', stage: 'testing', tool, retryable: true, message: 'Kontrolün kaynak sürümü artık güncel değil veya güncelliği doğrulanamadı.', nextAction: 'Aynı kontrolü güncel dosyalar üzerinde tekrar çalıştırın.' })

export class VerificationLedger {
  private readonly failures = new Map<string, VerificationFailure>()
  private readonly receipts = new Map<string, VerificationReceipt>()
  constructor(previous: VerificationFailure[] = [], results: VerificationReceipt[] = []) {
    for (const failure of previous) this.failures.set(failure.key, failure)
    for (const receipt of results) if (!this.failures.has(receipt.key)) this.receipts.set(receipt.key, receipt)
  }
  canRun(tool: string, args: string) {
    return !isExecutableVerification(tool, args) || new Set([...this.failures.keys(), ...this.receipts.keys()]).size < 48 || this.failures.has(verificationKey(tool, args)) || this.receipts.has(verificationKey(tool, args))
  }
  record(tool: string, args: string, analysis?: AgentErrorAnalysis, evidence?: { fingerprint?: string; stable: boolean }) {
    if (!isExecutableVerification(tool, args)) return
    if (!this.canRun(tool, args)) throw new Error('Doğrulama kaydı sınırına ulaşıldı; mevcut kontrolleri yeniden kullanın.')
    const key = verificationKey(tool, args)
    this.receipts.delete(key)
    if (analysis) this.failures.set(key, { key, tool, status: 'failed', analysis })
    else if (evidence && (!evidence.stable || !evidence.fingerprint)) this.failures.set(key, { key, tool, status: 'stale', analysis: staleAnalysis(tool) })
    else {
      this.failures.delete(key)
      if (evidence?.fingerprint) {
        let commandKey: string | undefined
        let kind: VerificationReceipt['kind'] = tool === 'run_tests' ? 'test' : tool === 'build_android' ? 'build' : ['web_http_check', 'android_install', 'android_launch'].includes(tool) ? 'runtime' : 'command'
        if (tool === 'build_android') {
          try {
            const task = String(JSON.parse(args).task ?? 'assembleDebug').split(':').at(-1) ?? ''
            kind = ['tasks', 'projects'].includes(task) ? 'configuration' : /^(?:test|connected|lint|check)/.test(task) ? 'test' : 'build'
          } catch { /* schema validated at tool boundary */ }
        }
        if (tool === 'windows_build') {
          try {
            const action = JSON.parse(args).action
            kind = action === 'test' ? 'test' : ['build', 'package', 'installer'].includes(action) ? 'build' : action === 'configure' ? 'configuration' : 'runtime'
          } catch { /* schema validated at tool boundary */ }
        }
        if (tool === 'run_tests') {
          try { const command = JSON.parse(args).command; if (typeof command === 'string') commandKey = acceptanceCommandKey(command) } catch { /* validated at tool boundary */ }
        }
        this.receipts.set(key, { key, tool, kind, fingerprint: evidence.fingerprint, checkedAt: new Date().toISOString(), ...(commandKey ? { commandKey } : {}) })
      }
    }
  }
  // On resume or an unreadable snapshot, previous successes cannot prove current state.
  invalidate(fingerprint?: string) {
    for (const [key, receipt] of this.receipts) if (!fingerprint || receipt.fingerprint !== fingerprint) {
      this.receipts.delete(key)
      this.failures.set(key, { key, tool: receipt.tool, status: 'stale', analysis: staleAnalysis(receipt.tool) })
    }
  }
  hasAcceptance(command: string) { return this.results.some((receipt) => receipt.tool === 'run_tests' && receipt.commandKey === acceptanceCommandKey(command)) }
  get results(): VerificationReceipt[] { return [...this.receipts.values()].map((item) => ({ ...item })) }
  get pending(): VerificationFailure[] { return [...this.failures.values()].map((item) => ({ ...item, analysis: { ...item.analysis } })) }
  get latestError() { return this.pending.filter((item) => item.status !== 'stale').at(-1)?.analysis }
}
