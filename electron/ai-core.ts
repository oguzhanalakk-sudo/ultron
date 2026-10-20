export type ToolDescriptor = {
  name: string
  kind: 'read' | 'write' | 'run' | 'search' | 'network' | 'browser' | 'system' | 'test' | 'git'
  tags: string[]
  risk: 'low' | 'medium' | 'high'
}

export type IntentProfile = {
  primaryGoal: string
  constraints: string[]
  desiredOutcomes: string[]
  unknowns: string[]
  risks: string[]
  approach: 'verify-first' | 'incremental' | 'parallel' | 'safe-fallback'
  complexity: 'simple' | 'moderate' | 'complex'
  confidence: 'low' | 'medium' | 'high'
}

export type ExecutionEvidence = {
  source: string
  ok: boolean
  detail: string
}

export type PlanStep = {
  id: string
  title: string
  objective: string
  tools: string[]
  dependsOn: string[]
  validation: string[]
  risk: 'low' | 'medium' | 'high'
}

export type EngineContext = {
  projectType?: string
  projectPath?: string
  resourceRoots?: string[]
  constraints?: string[]
  priorContext?: string[]
  knownFacts?: string[]
  availableTools?: ToolDescriptor[]
}

export type DecisionState = {
  intent: IntentProfile
  plan: PlanStep[]
  evidence: ExecutionEvidence[]
  uncertainty: string[]
  nextAction: string
  shouldReplan: boolean
}

export class AIEngine {
  private readonly toolRegistry: ToolDescriptor[]

  constructor(toolRegistry: ToolDescriptor[] = []) {
    this.toolRegistry = toolRegistry
  }

  analyzeIntent(request: string, context: EngineContext = {}): IntentProfile {
    const normalized = request.trim()
    const lower = normalized.toLowerCase()

    const constraints = [...(context.constraints ?? []), ...extractConstraints(lower)]
    const desiredOutcomes = extractDesiredOutcomes(lower)
    const unknowns = extractUnknowns(lower)
    const risks = extractRisks(lower)
    const primaryGoal = extractPrimaryGoal(normalized)

    const complexity =
      lower.includes('çok') || lower.includes('tam') || lower.includes('bileşen') || lower.includes('sistem')
        ? 'complex'
        : lower.includes('kontrol') || lower.includes('hata') || lower.includes('araştır')
          ? 'moderate'
          : 'simple'

    const approach =
      lower.includes('test') || lower.includes('doğrul') || lower.includes('hata') || lower.includes('düzelt')
        ? 'verify-first'
        : lower.includes('aynı anda') || lower.includes('çoklu')
          ? 'parallel'
          : 'incremental'

    const confidence = unknowns.length === 0 && desiredOutcomes.length > 0
      ? 'high'
      : unknowns.length <= 2 ? 'medium' : 'low'

    return {
      primaryGoal: primaryGoal || 'amacı doğru şekilde tamamla',
      constraints,
      desiredOutcomes: desiredOutcomes.length ? desiredOutcomes : ['çözüm üret', 'uygulamayı doğrula'],
      unknowns,
      risks,
      approach,
      complexity,
      confidence,
    }
  }

  decomposeTask(request: string, context: EngineContext = {}): PlanStep[] {
    const intent = this.analyzeIntent(request, context)
    const steps: PlanStep[] = []
    const titles = buildStepTitles(intent.primaryGoal)

    titles.forEach((title, index) => {
      const toolNames = inferToolsForStep(title, intent, this.toolRegistry)
      steps.push({
        id: `step-${index + 1}`,
        title,
        objective: `${intent.primaryGoal} için ${title.toLowerCase()} tamamlanır.`,
        tools: toolNames,
        dependsOn: index === 0 ? [] : [steps[index - 1]?.id ?? ''],
        validation: buildValidationHints(title, intent),
        risk: inferRisk(title, intent),
      })
    })

    if (!steps.length) {
      steps.push({
        id: 'step-1',
        title: 'İhtiyacı anla',
        objective: intent.primaryGoal,
        tools: inferToolsForStep('analyze', intent, this.toolRegistry),
        dependsOn: [],
        validation: ['hedef ve kısıtlar doğrulandı'],
        risk: 'low',
      })
    }

    return steps
  }

  selectToolsForStep(step: PlanStep): string[] {
    const available = new Set(this.toolRegistry.map((tool) => tool.name))
    const selected = step.tools.filter((name) => available.has(name))
    return selected.length ? selected : this.toolRegistry.filter((tool) => tool.kind === 'read' || tool.kind === 'search' || tool.kind === 'test').slice(0, 3).map((tool) => tool.name)
  }

  updatePlanWithEvidence(plan: PlanStep[], evidence: ExecutionEvidence[]): PlanStep[] {
    const next = [...plan]
    const failed = evidence.filter((item) => !item.ok)

    if (failed.length > 0 && !next.some((step) => step.id === 'step-recovery')) {
      next.push({
        id: 'step-recovery',
        title: 'Başarısız adımı yeniden değerlendir',
        objective: 'Hata nedenini doğrula ve alternatif çözüm dene.',
        tools: this.toolRegistry.filter((tool) => tool.kind === 'read' || tool.kind === 'search' || tool.kind === 'test').slice(0, 3).map((tool) => tool.name),
        dependsOn: next.length ? [next[next.length - 1].id] : [],
        validation: ['alternatif çözüm doğrulandı'],
        risk: 'high',
      })
    }

    return next
  }

  recordEvidence(decision: DecisionState, evidence: ExecutionEvidence, nextAction?: string): DecisionState {
    const collected = [...decision.evidence, { ...evidence, detail: evidence.detail.slice(0, 1_000) }].slice(-80)
    const failed = !evidence.ok
    const uncertainty = failed
      ? [...new Set([...decision.uncertainty, `${evidence.source}: ${evidence.detail.slice(0, 240)}`])].slice(-20)
      : decision.uncertainty
    return {
      ...decision,
      evidence: collected,
      plan: failed ? this.updatePlanWithEvidence(decision.plan, [evidence]) : decision.plan,
      uncertainty,
      nextAction: (nextAction || (failed ? 'Araç hatasını incele ve güvenli bir düzeltme belirle.' : 'Araç sonucunu değerlendir ve sonraki adımı seç.')).slice(0, 500),
      shouldReplan: failed || decision.shouldReplan,
    }
  }

  verifyOutcome(result: ExecutionEvidence[], expected: string[]): { pass: boolean; issues: string[] } {
    const issues: string[] = []
    const successful = result.filter((item) => item.ok)

    if (!successful.length) {
      issues.push('Hiçbir doğrulama işareti üretilemedi.')
    }

    for (const requirement of expected) {
      const match = successful.some((item) =>
        item.detail.toLowerCase().includes(requirement.toLowerCase())
      )
      if (!match) {
        issues.push(`Beklenen doğrulama yok: ${requirement}`)
      }
    }

    return { pass: issues.length === 0, issues }
  }

  buildDecisionState(request: string, context: EngineContext = {}): DecisionState {
    const intent = this.analyzeIntent(request, context)
    const plan = this.decomposeTask(request, context)
    const uncertainty = intent.unknowns.length ? intent.unknowns : []
    const nextAction = plan[0]?.title ?? 'İçerik ve koşullar doğrulanıyor'
    const evidence: ExecutionEvidence[] = []

    return {
      intent,
      plan,
      evidence,
      uncertainty,
      nextAction,
      shouldReplan: uncertainty.length > 0 || intent.confidence !== 'high',
    }
  }
}

function buildStepTitles(primaryGoal: string): string[] {
  const goal = primaryGoal.toLowerCase()

  if (goal.includes('hata') || goal.includes('sorun') || goal.includes('düzelt')) {
    return ['Sorunu tanımla', 'Kök nedeni bul', 'Düzeltmeyi uygula', 'Doğrula']
  }

  if (goal.includes('ekle') || goal.includes('oluştur') || goal.includes('yap')) {
    return ['İhtiyacı tanımla', 'Yapıyı planla', 'Uygulamayı geliştir', 'Doğrula']
  }

  if (goal.includes('araştır') || goal.includes('incele') || goal.includes('analiz')) {
    return ['Bağlamı topla', 'Öncelikleri belirle', 'Alternatifleri değerlendir', 'Sonuç bildir']
  }

  return ['İhtiyacı anla', 'Plan oluştur', 'Uygula', 'Doğrula']
}

function inferToolsForStep(title: string, intent: IntentProfile, registry: ToolDescriptor[]): string[] {
  const lower = title.toLowerCase()
  const priorities: string[] = []

  if (lower.includes('tanımla') || lower.includes('anla')) priorities.push('read_file', 'search')
  if (lower.includes('plan') || lower.includes('değerlendir')) priorities.push('search', 'read_file')
  if (lower.includes('düzelt') || lower.includes('geliştir') || lower.includes('uygula')) priorities.push('read_file', 'write_file', 'run_tests')
  if (lower.includes('doğrul') || lower.includes('kontrol')) priorities.push('run_tests', 'read_file')

  if (!registry.length) return []

  const toolNames = new Set<string>()
  for (const tool of registry) {
    const matches = tool.tags.some((tag) => lower.includes(tag) || intent.primaryGoal.toLowerCase().includes(tag))
    if (matches) toolNames.add(tool.name)
  }

  const available = new Set(registry.map((tool) => tool.name))
  return [...new Set([...toolNames, ...priorities.filter((name) => available.has(name))])].slice(0, 4)
}

function buildValidationHints(title: string, intent: IntentProfile): string[] {
  const lower = title.toLowerCase()
  const hints: string[] = []

  if (lower.includes('doğrul') || lower.includes('kontrol')) hints.push('çalışma sonucu doğrulandı')
  if (lower.includes('düzelt') || lower.includes('geliştir')) hints.push('değişiklikler uygulandı')
  if (intent.constraints.length) hints.push('kısıtlar korundu')
  if (!hints.length) hints.push('hedef ve sonuç tutarlılığı kontrol edildi')

  return hints
}

function inferRisk(title: string, intent: IntentProfile): PlanStep['risk'] {
  const lower = `${title} ${intent.primaryGoal}`.toLowerCase()
  if (lower.includes('sil') || lower.includes('kaldır') || lower.includes('yeniden yaz')) return 'high'
  if (lower.includes('düzelt') || lower.includes('doğrul') || lower.includes('kontrol')) return 'medium'
  return 'low'
}

function extractPrimaryGoal(request: string): string {
  const match = request.match(/^(?:lütfen|please|lutfen|yardım|help|yardımcı|devam)/i)
  if (match) return request.replace(match[0], '').trim() || 'işi tamamla'
  return request.trim() || 'işi tamamla'
}

function extractConstraints(lower: string): string[] {
  const constraints: string[] = []
  const patterns = [
    ['hızlı', 'hızlı olmalı'],
    ['güvenli', 'güvenli çözüm'],
    ['küçük', 'küçük değişiklik'],
    ['önce', 'önce doğrula'],
    ['tek adım', 'tek adımda'],
    ['uygulama', 'uygulama içi'],
    ['sınırlı', 'sınırlı kaynak'],
    ['güncel', 'güncel bilgi'],
  ]

  for (const [token, phrase] of patterns) {
    if (lower.includes(token)) constraints.push(phrase)
  }

  return constraints
}

function extractDesiredOutcomes(lower: string): string[] {
  const outcomes: string[] = []
  if (lower.includes('düzelt')) outcomes.push('hata çözüldü')
  if (lower.includes('ekle')) outcomes.push('özellik eklendi')
  if (lower.includes('oluştur')) outcomes.push('yeni yapı üretildi')
  if (lower.includes('test')) outcomes.push('doğrulama yapıldı')
  if (lower.includes('araştır')) outcomes.push('bilgi toparlandı')
  if (!outcomes.length) outcomes.push('çözüm üretildi')
  return outcomes
}

function extractUnknowns(lower: string): string[] {
  const unknowns: string[] = []
  if (lower.includes('bilinmiyor') || lower.includes('bilmiyorum') || lower.includes('ne yapmalıyım')) unknowns.push('amaç tam anlaşılmadı')
  if (lower.includes('kısıt') && !lower.includes('kısıtlı')) unknowns.push('kısıtlar net değil')
  if (lower.includes('nasıl') && !lower.includes('nasıl yapılır')) unknowns.push('yöntem belirsiz')
  return unknowns
}

function extractRisks(lower: string): string[] {
  const risks: string[] = []
  if (lower.includes('hata') || lower.includes('kırıl')) risks.push('çözüm yan etki oluşturabilir')
  if (lower.includes('güvenlik') || lower.includes('izin')) risks.push('güvenlik ve yetki kısıtları var')
  if (lower.includes('veri') || lower.includes('dosya')) risks.push('veri kaybı riski')
  if (!risks.length) risks.push('değişiklikte küçük riskler olabilir')
  return risks
}

export function defaultToolRegistry(): ToolDescriptor[] {
  return [
    { name: 'read_file', kind: 'read', tags: ['oku', 'incele', 'analiz', 'dosya'], risk: 'low' },
    { name: 'search_code', kind: 'search', tags: ['ara', 'bul', 'arama', 'incele', 'kod'], risk: 'low' },
    { name: 'write_file', kind: 'write', tags: ['yaz', 'düzenle', 'değiştir', 'ekle'], risk: 'medium' },
    { name: 'run_tests', kind: 'test', tags: ['test', 'doğrula', 'kontrol', 'validate'], risk: 'medium' },
    { name: 'run_command', kind: 'run', tags: ['çalıştır', 'çalıştırma', 'komut', 'işle'], risk: 'medium' },
    { name: 'git_status', kind: 'git', tags: ['git', 'değişiklik', 'versiyon'], risk: 'low' },
    { name: 'web_search', kind: 'network', tags: ['web', 'internet', 'araştır', 'güncel', 'kaynak'], risk: 'medium' },
  ]
}

export function buildAgentDecision(request: string, context: EngineContext = {}): DecisionState {
  return new AIEngine(context.availableTools ?? defaultToolRegistry()).buildDecisionState(request, context)
}

type AgentToolSchema = { function: { name: string; description?: string } }

/** Build a decision catalog from tools that are actually registered for this request. */
export function describeAgentTools(tools: readonly AgentToolSchema[]): ToolDescriptor[] {
  return tools.map(({ function: descriptor }) => {
    const name = descriptor.name
    const text = `${name} ${descriptor.description ?? ''}`.toLocaleLowerCase('tr-TR')
    const kind: ToolDescriptor['kind'] = /^git_/.test(name) ? 'git'
      : /(?:run_tests|build_|_build|_install|_launch|web_http_check)/.test(name) ? 'test'
        : /(?:web_search|fetch_web_page|web_research|web_follow_link|web_download|github_)/.test(name) ? 'network'
          : /(?:browser|open_url)/.test(name) ? 'browser'
            : /(?:desktop_|open_application|application)/.test(name) ? 'system'
              : /(?:search|find_)/.test(name) ? 'search'
                : /(?:write|apply_patch|create_|rename|delete|undo_change|propose_)/.test(name) ? 'write'
                  : /(?:run_|powershell)/.test(name) ? 'run'
                    : /(?:read|list_|inspect|analyze|get_)/.test(name) ? 'read'
                      : /test|validate|verify|check/.test(text) ? 'test' : 'read'
    const risk: ToolDescriptor['risk'] = /delete|revert|push|install|desktop_|open_application|system|kill/.test(name) ? 'high'
      : /write|apply_patch|create_|rename|run_|powershell|commit|open_url|web_/.test(name) ? 'medium' : 'low'
    const commonTags: Record<ToolDescriptor['kind'], string[]> = {
      read: ['oku', 'incele', 'analiz', 'dosya', 'read'],
      write: ['yaz', 'düzenle', 'değiştir', 'ekle', 'oluştur', 'uygula', 'write'],
      run: ['çalıştır', 'komut', 'run'],
      search: ['ara', 'bul', 'arama', 'search'],
      network: ['web', 'internet', 'araştır', 'güncel', 'kaynak'],
      browser: ['web', 'sayfa', 'internet', 'url', 'browser'],
      system: ['masaüstü', 'uygulama', 'pencere', 'sistem', 'desktop'],
      test: ['test', 'doğrula', 'kontrol', 'validate', 'build'],
      git: ['git', 'commit', 'dal', 'değişiklik'],
    }
    return { name, kind, tags: [...new Set([...commonTags[kind], ...name.split(/[_-]+/).filter((part) => part.length > 2)])], risk }
  })
}

export function prioritizeAgentTools<T extends { function: { name: string } }>(tools: T[], preferredNames: string[]): T[] {
  const preferred = new Set(preferredNames)
  return [...tools.filter((tool) => preferred.has(tool.function.name)), ...tools.filter((tool) => !preferred.has(tool.function.name))]
}

export function alignDecisionWithPlan(decision: DecisionState, plan: { title?: unknown; objective?: unknown; steps: unknown[] }): DecisionState {
  const sourceSteps = decision.plan
  const normalized = plan.steps.filter((step): step is string => typeof step === 'string' && step.trim().length > 0).slice(0, 40)
  const steps = normalized.map((title, index): PlanStep => {
    const guidance = sourceSteps[index]
    const id = `step-${index + 1}`
    return {
      id,
      title: title.trim().slice(0, 300),
      objective: `${String(plan.objective ?? decision.intent.primaryGoal).slice(0, 450)} — ${title.trim()}`.slice(0, 600),
      tools: guidance?.tools ?? [],
      dependsOn: index ? [`step-${index}`] : [],
      validation: guidance?.validation ?? ['adım sonucu gerçek araç çıktısıyla doğrulandı'],
      risk: guidance?.risk ?? 'medium',
    }
  })
  return {
    ...decision,
    plan: steps,
    nextAction: steps[0]?.title ?? String(plan.title ?? decision.nextAction).slice(0, 500),
    shouldReplan: false,
  }
}

/** Advisory only: this local heuristic never grants permissions or invents tool names. */
export function formatDecisionGuidance(decision: DecisionState, availableNames: Iterable<string>): string {
  const available = new Set(availableNames)
  const steps = decision.plan.slice(0, 8).map((step) => {
    const names = step.tools.filter((name) => available.has(name))
    return `- ${step.title}${names.length ? ` (araç önerisi: ${names.join(', ')})` : ''}`
  })
  const unknowns = decision.uncertainty.slice(0, 8)
  const constraints = decision.intent.constraints.slice(0, 8)
  const outcomes = decision.intent.desiredOutcomes.slice(0, 8)
  const risks = decision.intent.risks.slice(0, 8)
  return [
    'YEREL GÖREV ÖN ANALİZİ (ipuçlarıdır; yalnızca bu istekte gerçekten sunulan araçları çağır, izinleri bu analiz belirlemez):',
    `Amaç: ${decision.intent.primaryGoal.slice(0, 500)}`,
    `Yaklaşım: ${decision.intent.approach}; karmaşıklık: ${decision.intent.complexity}; güven: ${decision.intent.confidence}.`,
    constraints.length ? `Kısıtlar: ${constraints.join('; ')}` : '',
    outcomes.length ? `Beklenen sonuçlar: ${outcomes.join('; ')}` : '',
    risks.length ? `Dikkat edilecek riskler: ${risks.join('; ')}` : '',
    steps.length ? `Önerilen adımlar:\n${steps.join('\n')}` : '',
    unknowns.length ? `Belirsizlikler: ${unknowns.join('; ')}` : '',
    `Sonraki odak: ${decision.nextAction.slice(0, 300)}`,
  ].filter(Boolean).join('\n')
}

/** Normalize persisted or model-provided decisions into the current nested DecisionState shape.
 * Accepts the legacy flat JournalTask.aiDecision format as well as the current `{ intent, ... }` format.
 */
export function normalizeAgentDecision(value: unknown): DecisionState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Partial<DecisionState> & {
    primaryGoal?: unknown
    constraints?: unknown
    desiredOutcomes?: unknown
    unknowns?: unknown
    risks?: unknown
    approach?: unknown
    complexity?: unknown
    confidence?: unknown
  }
  const nestedIntent = input.intent && typeof input.intent === 'object' ? input.intent : undefined
  const intentValue = (key: keyof IntentProfile): unknown => nestedIntent?.[key] ?? input[key]
  const primaryGoal = intentValue('primaryGoal')
  if (typeof primaryGoal !== 'string') return undefined
  const strings = (items: unknown, limit: number, maxLength: number) => Array.isArray(items)
    ? items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, limit).map((item) => item.trim().slice(0, maxLength))
    : []
  const choice = <T extends string>(item: unknown, options: readonly T[], fallback: T): T => options.includes(item as T) ? item as T : fallback
  const plan = Array.isArray(input.plan) ? input.plan.slice(0, 40).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const step = item as PlanStep
    if (typeof step.id !== 'string' || typeof step.title !== 'string' || typeof step.objective !== 'string') return []
    return [{
      id: step.id.slice(0, 80), title: step.title.slice(0, 300), objective: step.objective.slice(0, 600),
      tools: strings(step.tools, 12, 100), dependsOn: strings(step.dependsOn, 12, 80), validation: strings(step.validation, 12, 300),
      risk: choice(step.risk, ['low', 'medium', 'high'] as const, 'low'),
    }]
  }) : []
  const evidence = Array.isArray(input.evidence) ? input.evidence.slice(-80).flatMap((item) => {
    if (!item || typeof item !== 'object' || typeof (item as ExecutionEvidence).source !== 'string' || typeof (item as ExecutionEvidence).ok !== 'boolean') return []
    const entry = item as ExecutionEvidence
    return [{ source: entry.source.slice(0, 120), ok: entry.ok, detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 1_000) : '' }]
  }) : []
  return {
    intent: {
      primaryGoal: primaryGoal.slice(0, 600), constraints: strings(intentValue('constraints'), 20, 300),
      desiredOutcomes: strings(intentValue('desiredOutcomes'), 20, 300), unknowns: strings(intentValue('unknowns'), 20, 300), risks: strings(intentValue('risks'), 20, 300),
      approach: choice(intentValue('approach'), ['verify-first', 'incremental', 'parallel', 'safe-fallback'] as const, 'incremental'),
      complexity: choice(intentValue('complexity'), ['simple', 'moderate', 'complex'] as const, 'moderate'),
      confidence: choice(intentValue('confidence'), ['low', 'medium', 'high'] as const, 'medium'),
    },
    plan, evidence, uncertainty: strings(input.uncertainty, 20, 300),
    nextAction: typeof input.nextAction === 'string' ? input.nextAction.slice(0, 500) : 'Araç sonucunu değerlendir.',
    shouldReplan: input.shouldReplan === true,
  }
}

export function sanitizeDecisionState(value: unknown): DecisionState | undefined {
  return normalizeAgentDecision(value)
}
