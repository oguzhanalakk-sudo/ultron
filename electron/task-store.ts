import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentErrorAnalysis, AgentStage, VerificationFailure, VerificationReceipt } from './shared'
import { normalizeAgentDecision, type DecisionState, type ExecutionEvidence, type PlanStep } from './ai-core.ts'
import { writeJsonAtomically } from './atomic-json.ts'
import { acceptanceCommandKey, isChangeVerification, isVerificationTool } from './agent-verification.ts'

export type JournalStatus = 'running' | 'waiting_approval' | 'interrupted' | 'paused' | 'blocked' | 'needs_review' | 'completed' | 'failed' | 'cancelled'
export type JournalEvent = { at: string; type: 'tool' | 'approval' | 'result' | 'error'; name: string; status?: string; detail?: string }
export type JournalTask = {
  id: string
  projectPath: string
  request: string
  title: string
  objective: string
  summary?: string
  plan: string[]
  completedSteps: string[]
  acceptanceTests?: string[]
  completedStepIds?: string[]
  /** Locally suggested steps are informational until the model commits a real task plan. */
  planIsAdvisory?: boolean
  pendingSteps: string[]
  usedTools: string[]
  events: JournalEvent[]
  errors: string[]
  status: JournalStatus
  stage: AgentStage
  currentTool?: string
  toolCalls: number
  correctionAttempts: number
  errorAnalysis?: AgentErrorAnalysis
  verificationFailures?: VerificationFailure[]
  verificationResults?: VerificationReceipt[]
  verificationRequired?: boolean
  aiDecision?: DecisionState
  createdAt: string
  updatedAt: string
}

const MAX_TASKS = 80
const MAX_EVENTS = 120
const MAX_TEXT = 4_000
const clean = (value: unknown, max = MAX_TEXT) => redact(String(value ?? '').slice(0, max))
function redact(value: string) {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/(\b(?:api[_-]?key|token|password|passwd|secret|client[_-]?secret)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
}

function cleanList(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, limit).map((item) => clean(item, maxLength).slice(0, maxLength))
}

const cleanAcceptanceTests = (value: unknown) => cleanList(value, 30, 1_000)
const cleanCompletedStepIds = (value: unknown) => [...new Set(cleanList(value, 40, 120).map((item) => item.trim()))]
function cleanDecision(value: unknown): DecisionState | undefined {
  const decision = normalizeAgentDecision(value)
  if (!decision) return undefined
  return {
    ...decision,
    intent: {
      ...decision.intent,
      primaryGoal: clean(decision.intent.primaryGoal, 600),
      constraints: decision.intent.constraints.map((item) => clean(item, 300)),
      desiredOutcomes: decision.intent.desiredOutcomes.map((item) => clean(item, 300)),
      unknowns: decision.intent.unknowns.map((item) => clean(item, 300)),
      risks: decision.intent.risks.map((item) => clean(item, 300)),
    },
    plan: decision.plan.map((step: PlanStep) => ({
      ...step, id: clean(step.id, 80), title: clean(step.title, 300), objective: clean(step.objective, 600),
      tools: step.tools.map((item) => clean(item, 100)), dependsOn: step.dependsOn.map((item) => clean(item, 80)),
      validation: step.validation.map((item) => clean(item, 300)),
    })),
    evidence: decision.evidence.map((item: ExecutionEvidence) => ({ source: clean(item.source, 120), ok: item.ok, detail: clean(item.detail, 1_000) })),
    uncertainty: decision.uncertainty.map((item) => clean(item, 300)),
    nextAction: clean(decision.nextAction, 500),
  }
}
const cleanSummary = (value: unknown, fallback = '') => {
  const summary = typeof value === 'string' ? value.trim() : ''
  return summary ? clean(summary, 600).slice(0, 600) : fallback
}
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

function validTask(value: unknown, projectPath: string): value is JournalTask {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<JournalTask>
  return typeof task.id === 'string' && typeof task.request === 'string' && typeof task.title === 'string'
    && typeof task.objective === 'string' && typeof task.projectPath === 'string'
    && path.resolve(task.projectPath).toLocaleLowerCase('en-US') === path.resolve(projectPath).toLocaleLowerCase('en-US')
    && ['running', 'waiting_approval', 'interrupted', 'paused', 'blocked', 'needs_review', 'completed', 'failed', 'cancelled'].includes(String(task.status))
}

function cleanFailures(value: unknown): VerificationFailure[] {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && isHash(item.key) && isVerificationTool(item.tool) && item.analysis && ['syntax', 'build', 'runtime', 'dependency', 'configuration', 'permission', 'filesystem', 'network', 'test', 'resources', 'unknown'].includes(item.analysis.category)
    && typeof item.analysis.message === 'string' && typeof item.analysis.nextAction === 'string')
    .slice(-48).map((item) => ({ key: item.key, tool: clean(item.tool, 100), status: item.status === 'stale' ? 'stale' : 'failed', analysis: {
      category: item.analysis.category, stage: 'testing', message: clean(item.analysis.message, 1_000), nextAction: clean(item.analysis.nextAction, 1_000), tool: clean(item.tool, 100), retryable: Boolean(item.analysis.retryable),
      ...(typeof item.analysis.exitCode === 'number' && Number.isFinite(item.analysis.exitCode) ? { exitCode: item.analysis.exitCode } : {}),
    } }))
}

function cleanReceipts(value: unknown): VerificationReceipt[] {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && isHash(item.key) && isHash(item.fingerprint)
    && isVerificationTool(item.tool) && typeof item.checkedAt === 'string' && Number.isFinite(Date.parse(item.checkedAt))
    && (item.commandKey === undefined || isHash(item.commandKey)))
    .slice(-48).map((item) => ({ key: item.key, tool: clean(item.tool, 100), checkedAt: new Date(item.checkedAt).toISOString(), fingerprint: item.fingerprint,
      ...(item.commandKey === undefined ? {} : { commandKey: item.commandKey }),
      ...(['test', 'build', 'runtime', 'command'].includes(item.kind) ? { kind: item.kind } : {}),
    }))
}

export class TaskStore {
  private readonly file: string
  private writeQueue: Promise<void> = Promise.resolve()
  private mutationQueue: Promise<void> = Promise.resolve()
  readonly projectPath: string

  constructor(projectPath: string) {
    this.projectPath = projectPath
    this.file = path.join(projectPath, '.codex-local', 'tasks.json')
  }

  async list() {
    await this.writeQueue
    try {
      const value: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      if (!Array.isArray(value)) return []
      return value.filter((item): item is JournalTask => validTask(item, this.projectPath)).slice(-MAX_TASKS).reverse().map((task) => ({
        ...task,
        request: clean(task.request), title: clean(task.title, 180), objective: clean(task.objective),
        summary: cleanSummary(task.summary, clean(task.request, 600)),
        plan: Array.isArray(task.plan) ? task.plan.slice(0, 40).map((item) => clean(item, 300)) : [],
        completedSteps: Array.isArray(task.completedSteps) ? task.completedSteps.slice(0, 40).map((item) => clean(item, 300)) : [],
        acceptanceTests: cleanAcceptanceTests(task.acceptanceTests),
        completedStepIds: cleanCompletedStepIds(task.completedStepIds),
        planIsAdvisory: task.planIsAdvisory === true,
        pendingSteps: Array.isArray(task.pendingSteps) ? task.pendingSteps.slice(0, 40).map((item) => clean(item, 300)) : [],
        usedTools: Array.isArray(task.usedTools) ? task.usedTools.slice(-80).map((item) => clean(item, 100)) : [],
        events: Array.isArray(task.events) ? task.events.slice(-MAX_EVENTS).filter((event) => event && typeof event.name === 'string' && ['tool', 'approval', 'result', 'error'].includes(event.type))
          .map((event) => ({ ...event, at: clean(event.at, 40), type: event.type, name: clean(event.name, 120), status: event.status ? clean(event.status, 80) : undefined, detail: event.detail ? clean(event.detail, 1_000) : undefined })) : [],
        errors: Array.isArray(task.errors) ? task.errors.slice(-30).map((item) => clean(item, 1_000)) : [],
        verificationFailures: cleanFailures(task.verificationFailures),
        verificationResults: cleanReceipts(task.verificationResults),
        verificationRequired: task.verificationRequired === true,
        aiDecision: cleanDecision(task.aiDecision),
        stage: (['analyzing', 'planning', 'awaiting_approval', 'executing', 'evaluating', 'correcting', 'testing', 'finalizing', 'paused', 'interrupted', 'blocked', 'completed', 'failed', 'cancelled'] as const).includes(String(task.stage) as any)
          ? String(task.stage) as any
          : 'analyzing',
        currentTool: typeof task.currentTool === 'string' ? clean(task.currentTool, 100) : undefined,
        toolCalls: Number.isInteger(task.toolCalls) && task.toolCalls >= 0 ? Math.min(task.toolCalls, 10_000) : 0,
        correctionAttempts: Number.isInteger(task.correctionAttempts) && task.correctionAttempts >= 0 ? Math.min(task.correctionAttempts, 1_000) : 0,
        errorAnalysis: task.errorAnalysis && typeof task.errorAnalysis === 'object' && ['syntax', 'build', 'runtime', 'dependency', 'configuration', 'permission', 'filesystem', 'network', 'test', 'resources', 'unknown'].includes(task.errorAnalysis.category)
          ? { ...task.errorAnalysis, message: clean(task.errorAnalysis.message, 1_000), nextAction: clean(task.errorAnalysis.nextAction, 1_000), tool: task.errorAnalysis.tool ? clean(task.errorAnalysis.tool, 100) : undefined }
          : undefined,
      }))
    } catch { return [] }
  }

  async get(id: string) {
    return (await this.list()).find((task) => task.id === id) ?? null
  }

  async create(request: string) {
    return this.serialize(async () => {
      const now = new Date().toISOString()
      const title = clean(request.split(/\r?\n/, 1)[0], 180) || 'Kodlama görevi'
      const summary = cleanSummary(request, title)
      const task: JournalTask = {
        id: randomUUID(), projectPath: this.projectPath, request: clean(request), title,
        objective: clean(request), summary, plan: [], completedSteps: [], acceptanceTests: [], completedStepIds: [], pendingSteps: [], usedTools: [], events: [], errors: [],
        status: 'running', stage: 'analyzing', toolCalls: 0, correctionAttempts: 0, verificationRequired: false, createdAt: now, updatedAt: now,
      }
      await this.upsert(task)
      return task
    })
  }

  async resume(id: string) {
    return this.serialize(async () => {
      const task = (await this.list()).find((entry) => entry.id === id)
      if (!task) throw new Error('Sürdürülecek görev bulunamadı veya başka bir projeye ait.')
      const hasPendingWork = (!task.planIsAdvisory && task.pendingSteps.length > 0) || (!task.planIsAdvisory && task.plan.length > 0 && task.status !== 'completed')
      if (!['interrupted', 'paused', 'blocked', 'needs_review', 'failed', 'cancelled'].includes(task.status) && !hasPendingWork) throw new Error('Yalnızca yarım kalmış veya plan adımı bulunan görevler sürdürülebilir; doğrulama bekleyen, blokeli ya da başarısız görevler de sürdürülebilir.')
      return this.updateUnsafe(id, { status: 'running', stage: 'analyzing', currentTool: '', errors: [], events: [...task.events, { at: new Date().toISOString(), type: 'result', name: 'task-resumed', detail: 'Görev sürdürüldü.' }] })
    })
  }

  async update(id: string, patch: Partial<JournalTask>) {
    return this.serialize(() => this.updateUnsafe(id, patch))
  }

  private async updateUnsafe(id: string, patch: Partial<JournalTask>) {
    const tasks = await this.list()
    const current = tasks.find((task) => task.id === id)
    if (!current) throw new Error('Görev kaydı bulunamadı.')
    const next: JournalTask = {
      ...current, ...patch, id: current.id, projectPath: this.projectPath,
      request: clean(patch.request ?? current.request), title: clean(patch.title ?? current.title, 180),
      objective: clean(patch.objective ?? current.objective),
      summary: cleanSummary(patch.summary ?? current.summary ?? current.request, clean(patch.request ?? current.request, 600)),
      plan: (patch.plan ?? current.plan).slice(0, 40).map((item) => clean(item, 300)),
      completedSteps: (patch.completedSteps ?? current.completedSteps).slice(0, 40).map((item) => clean(item, 300)),
      acceptanceTests: cleanAcceptanceTests(patch.acceptanceTests ?? current.acceptanceTests),
      completedStepIds: cleanCompletedStepIds(patch.completedStepIds ?? current.completedStepIds),
      planIsAdvisory: (patch.planIsAdvisory ?? current.planIsAdvisory) === true,
      pendingSteps: (patch.pendingSteps ?? current.pendingSteps).slice(0, 40).map((item) => clean(item, 300)),
      usedTools: [...new Set((patch.usedTools ?? current.usedTools).slice(-80).map((item) => clean(item, 100)))],
      events: (patch.events ?? current.events).slice(-MAX_EVENTS).map((event) => ({ ...event, at: clean(event.at, 40), type: event.type, name: clean(event.name, 120), status: event.status ? clean(event.status, 80) : undefined, detail: event.detail ? clean(event.detail, 1_000) : undefined })),
      errors: (patch.errors ?? current.errors).slice(-30).map((item) => clean(item, 1_000)),
      status: patch.status ?? current.status, createdAt: current.createdAt, updatedAt: new Date().toISOString(),
      stage: patch.stage ?? current.stage,
      currentTool: patch.currentTool === undefined ? current.currentTool : patch.currentTool ? clean(patch.currentTool, 100) : undefined,
      toolCalls: patch.toolCalls === undefined ? current.toolCalls : Math.max(0, Math.min(10_000, Math.floor(patch.toolCalls))),
      correctionAttempts: patch.correctionAttempts === undefined ? current.correctionAttempts : Math.max(0, Math.min(1_000, Math.floor(patch.correctionAttempts))),
      errorAnalysis: !Object.hasOwn(patch, 'errorAnalysis') ? current.errorAnalysis : patch.errorAnalysis ? { ...patch.errorAnalysis, message: clean(patch.errorAnalysis.message, 1_000), nextAction: clean(patch.errorAnalysis.nextAction, 1_000), tool: patch.errorAnalysis.tool ? clean(patch.errorAnalysis.tool, 100) : undefined } : undefined,
      verificationFailures: cleanFailures(patch.verificationFailures ?? current.verificationFailures),
      verificationResults: cleanReceipts(patch.verificationResults ?? current.verificationResults),
      verificationRequired: (patch.verificationRequired ?? current.verificationRequired) === true,
      aiDecision: Object.hasOwn(patch, 'aiDecision') ? cleanDecision(patch.aiDecision) : cleanDecision(current.aiDecision),
    }
    await this.upsert(next, tasks)
    return next
  }

  async record(id: string, event: JournalEvent) {
    return this.serialize(async () => {
      const task = (await this.list()).find((entry) => entry.id === id)
      if (!task) return null
      const usedTools = event.type === 'tool' ? [...task.usedTools, event.name] : task.usedTools
      const errors = event.type === 'error' ? [...task.errors, event.detail ?? event.name] : task.errors
      const events = [...task.events, { ...event, detail: event.detail ? clean(event.detail, 1_000) : undefined }]
      return this.updateUnsafe(id, { usedTools, errors, events })
    })
  }

  async finish(id: string, status: Extract<JournalStatus, 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'paused' | 'blocked' | 'needs_review'>, detail?: string) {
    return this.serialize(async () => {
      const task = (await this.list()).find((entry) => entry.id === id)
      if (!task) return null
      if (status === 'completed') {
        const failed = task.verificationFailures?.filter((failure) => failure.status !== 'stale') ?? []
        const stale = task.verificationFailures?.filter((failure) => failure.status === 'stale') ?? []
        const missingAcceptanceTests = (task.acceptanceTests ?? []).filter((command) => !(task.verificationResults ?? []).some((receipt) => receipt.tool === 'run_tests' && receipt.commandKey === acceptanceCommandKey(command)))
        const missingChangeVerification = task.verificationRequired && !(task.verificationResults ?? []).some(isChangeVerification)
        if (failed.length || task.errorAnalysis) {
          status = 'failed'
          detail = failed.length ? `${failed.length} doğrulama hatası çözülmeden görev tamamlanamaz.` : 'Açık araç veya yürütme hatası çözülmeden görev tamamlanamaz.'
        } else if (stale.length || (!task.planIsAdvisory && task.pendingSteps.length) || missingAcceptanceTests.length || missingChangeVerification) {
          status = 'needs_review'
          const pendingPlanSteps = task.planIsAdvisory ? 0 : task.pendingSteps.length
          detail = `${pendingPlanSteps} açık plan adımı, ${stale.length} eski doğrulama ve ${missingAcceptanceTests.length} çalıştırılmamış kabul kontrolü nedeniyle görev doğrulama bekliyor.`
        }
      }
      return this.updateUnsafe(id, {
        status,
        stage: status === 'needs_review' ? 'finalizing' : status,
        currentTool: '',
        errors: status === 'failed' && detail ? [...task.errors, clean(detail, 1_000)] : task.errors,
        events: [...task.events, { at: new Date().toISOString(), type: status === 'failed' ? 'error' : 'result', name: `task-${status}`, detail: detail ? clean(detail, 1_000) : undefined }],
      })
    })
  }

  async interruptActive() {
    const tasks = await this.list()
    for (const task of tasks) if (task.status === 'running' || task.status === 'waiting_approval') await this.finish(task.id, 'interrupted', 'Uygulama kapandığında görev tamamlanmamıştı.')
  }

  private async upsert(task: JournalTask, known?: JournalTask[]) {
    const tasks = (known ?? await this.list()).reverse()
    const updated = [...tasks.filter((item) => item.id !== task.id), task].slice(-MAX_TASKS)
    const write = this.writeQueue.then(async () => {
      await writeJsonAtomically(this.file, updated)
    })
    this.writeQueue = write.catch(() => undefined)
    await write
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

export function planTaskRecord(task: JournalTask, plan: { title: string; objective: string; steps: string[]; tests?: string[] }) {
  const steps = cleanList(plan.steps, 40, 300)
  return {
    title: clean(plan.title, 180), objective: clean(plan.objective),
    summary: cleanSummary(plan.objective || task.objective || task.request, clean(plan.objective || task.objective || task.request, 600)),
    plan: steps,
    acceptanceTests: cleanAcceptanceTests(plan.tests),
    completedSteps: [] as string[],
    completedStepIds: [] as string[],
    pendingSteps: steps.slice(),
  }
}
