import { AgentMemoryStore, type MemoryItem } from './agent-memory.ts'
import { AIEngine, ReflectionEngine, type AgentEvidence, type IntentProfile, type PlanStep, type ReflectionReport, type ToolDescriptor } from './ai-core.ts'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type AgentGoal = {
  id: string
  objective: string
  constraints: string[]
  successCriteria: string[]
  riskProfile: RiskLevel
  createdAt: string
}

export type AgentPlanStep = PlanStep

export type AgentDecision = {
  goal: AgentGoal
  plan: AgentPlanStep[]
  memory: MemoryItem[]
  evidence: AgentEvidence[]
  nextAction: string
  shouldReplan: boolean
  riskScore: number
}

const riskWeight: Record<RiskLevel, number> = { low: 0, medium: 30, high: 60, critical: 80 }

function maxRisk(...risks: RiskLevel[]): RiskLevel {
  return risks.reduce((highest, risk) => riskWeight[risk] > riskWeight[highest] ? risk : highest, 'low')
}

function cleanEvidence(value: AgentEvidence): AgentEvidence {
  const timestamp = typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp))
    ? new Date(value.timestamp).toISOString()
    : new Date().toISOString()
  return {
    source: String(value.source ?? '').slice(0, 120),
    ok: value.ok === true,
    detail: String(value.detail ?? '').slice(0, 1_000),
    timestamp,
  }
}

function riskForIntent(intent: IntentProfile, plan: PlanStep[], tools: ToolDescriptor[]): RiskLevel {
  const normalized = intent.primaryGoal.toLocaleLowerCase('tr-TR')
  if (/\b(delete|sil|format|production|deploy|git push|install|kurulum|paket yükle)\b/u.test(normalized)) return 'critical'
  const usedToolNames = new Set(plan.flatMap((step) => step.tools))
  const toolRisk = tools
    .filter((tool) => usedToolNames.has(tool.name))
    .map((tool) => tool.risk)
  const planRisk = plan.map((step) => step.risk)
  return maxRisk(...toolRisk, ...planRisk, intent.risks.length ? 'medium' : 'low')
}

/** Compatibility facade over Ultron's existing planner, memory, and reflection engines. */
export class UltraAgentCore {
  private readonly tools: ToolDescriptor[]
  private readonly memoryStore: AgentMemoryStore
  private readonly engine: AIEngine
  private readonly reflection = new ReflectionEngine()

  constructor(tools: ToolDescriptor[], memoryStore = new AgentMemoryStore()) {
    this.tools = tools.slice()
    this.memoryStore = memoryStore
    this.engine = new AIEngine(this.tools, this.memoryStore)
  }

  resolveGoal(request: string, constraints: string[] = []): AgentGoal {
    const objective = String(request ?? '').trim().slice(0, 2_000)
    const safeConstraints = constraints
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 20)
    const context = { constraints: safeConstraints, availableTools: this.tools }
    const intent = this.engine.analyzeIntent(objective, context)
    const plan = this.engine.decomposeTask(objective, context)

    return {
      id: `goal-${crypto.randomUUID()}`,
      objective,
      constraints: safeConstraints,
      successCriteria: intent.desiredOutcomes.slice(0, 20),
      riskProfile: riskForIntent(intent, plan, this.tools),
      createdAt: new Date().toISOString(),
    }
  }

  retrieveRelevantMemory(goal: AgentGoal, limit = 12): MemoryItem[] {
    const tokens = new Set(`${goal.objective} ${goal.constraints.join(' ')}`
      .toLocaleLowerCase('tr-TR')
      .match(/[\p{L}\p{N}]{3,}/gu)?.slice(0, 40) ?? [])
    const matches = new Map<string, MemoryItem>()
    for (const token of tokens) {
      for (const item of this.memoryStore.recall(token, 4)) matches.set(item.id, item)
    }
    return [...matches.values()]
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, Math.max(0, Math.min(24, Math.floor(limit))))
  }

  decide(goal: AgentGoal, evidence: AgentEvidence[] = []): AgentDecision {
    const context = {
      projectPath: undefined,
      constraints: goal.constraints,
      availableTools: this.tools,
      agentMemory: this.memoryStore,
    }
    let state = this.engine.buildDecisionState(goal.objective, context)
    const normalizedEvidence = evidence.slice(-80).map(cleanEvidence)
    for (const item of normalizedEvidence) {
      state = this.engine.recordEvidence(state, { source: item.source, ok: item.ok, detail: item.detail })
    }

    const riskScore = Math.max(state.riskScore, riskWeight[goal.riskProfile])
    return {
      goal,
      plan: state.plan,
      memory: this.retrieveRelevantMemory(goal),
      evidence: normalizedEvidence,
      nextAction: state.nextAction,
      shouldReplan: state.shouldReplan || riskScore >= 60 || normalizedEvidence.some((item) => !item.ok),
      riskScore,
    }
  }

  reflectFailure(evidence: AgentEvidence): ReflectionReport {
    return this.reflection.analyzeFailure(cleanEvidence(evidence))
  }

  remember(kind: MemoryItem['kind'], tag: string, summary: string, source: string, confidence = 0.75): MemoryItem {
    return this.memoryStore.remember(kind, tag, summary, source, confidence)
  }
}
