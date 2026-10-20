// Aşama 1 – Plan: prompt/spec -> ProjectPlan. Diske hiçbir şey yazmaz.
// Mevcut inferStackFromPrompt / PROJECT_TEMPLATES / buildProjectSpec yeniden kullanılır;
// plan, yazma aşamasından önce bellek içi statik tutarlılık denetiminden geçer.
import { analyzeProjectFiles, checkPlannedPaths, collectDependencies, type DependencySummary, type PlanIssue } from './project-analysis.ts'
import { generateStackFiles, STACK_LANGUAGE } from './project-generators.ts'
import { getLanguageInfo } from './language-knowledge.ts'
import { buildProjectSpec, inferStackFromPrompt, PROJECT_TEMPLATES, type ProjectStack, type ProjectTemplate } from './project-template-registry.ts'

export type PlannedFile = { path: string; purpose: string; content: string }

export type ProjectPlan = {
  name: string
  description: string
  stack: ProjectStack
  template: ProjectTemplate
  selection: {
    language: string
    framework: string
    rationale: string
    testFrameworks: string[]
    buildTools: string[]
  }
  directories: string[]
  files: PlannedFile[]
  dependencies: DependencySummary
  envVariables: Array<{ name: string; example: string }>
  commands: { install: string; build: string; test?: string; run: string }
  entryFiles: string[]
  warnings: string[]
  /** Plan oluşturulurken yapılan statik denetimin bulguları. */
  issues: PlanIssue[]
}

export type PlanRequest = {
  name: string
  description?: string
  prompt?: string
  stack?: ProjectStack
  template?: ProjectTemplate
  /** Sağlanırsa üreticinin dosyalarına ek/üstüne yazan, kullanıcı tanımlı dosyalar. */
  extraFiles?: PlannedFile[]
}

export function hasPlanErrors(issues: readonly PlanIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

function dedupe(issues: PlanIssue[]): PlanIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.severity}|${issue.code}|${issue.path ?? ''}|${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Bellek içi tutarlılık denetimi: yazma aşamasından önce (ve yazıcı tarafından yeniden) çalıştırılır. */
export function checkProjectPlan(plan: Pick<ProjectPlan, 'files' | 'entryFiles' | 'commands'>): PlanIssue[] {
  const paths = plan.files.map((file) => file.path)
  const pathIssues = checkPlannedPaths(paths)
  if (pathIssues.some((issue) => issue.code === 'unsafe-path')) return pathIssues
  const files = new Map(plan.files.map((file) => [file.path, file.content]))
  return dedupe([...pathIssues, ...analyzeProjectFiles(files, { entryFiles: plan.entryFiles, commands: plan.commands })])
}

function parentDirectories(paths: string[]): string[] {
  const directories = new Set<string>()
  for (const file of paths) {
    const parts = file.split('/')
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/'))
  }
  return [...directories].sort()
}

function parseEnv(content: string | undefined): Array<{ name: string; example: string }> {
  const result: Array<{ name: string; example: string }> = []
  for (const line of (content ?? '').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (match) result.push({ name: match[1], example: match[2] })
  }
  return result
}

export function buildProjectPlan(request: PlanRequest): ProjectPlan {
  const prompt = request.prompt ?? request.description ?? ''
  const explicit = request.stack !== undefined
  const stack = request.stack ?? inferStackFromPrompt(prompt)
  const spec = buildProjectSpec({ stack, template: request.template, prompt })
  const language = STACK_LANGUAGE[stack]
  const languageInfo = getLanguageInfo(language)
  const description = request.description?.trim() || spec.description
  const warnings: string[] = []
  if (!languageInfo) warnings.push(`language-knowledge içinde "${language}" için kayıt bulunamadı.`)

  const generated = generateStackFiles(stack, { name: request.name, description })
  const byPath = new Map<string, { path: string; purpose: string; content: string }>()
  const files: PlannedFile[] = []
  for (const file of [...generated, ...(request.extraFiles ?? [])]) {
    // Aynı yol iki kez gelirse sessizce ezilmez; denetim "duplicate-path" olarak yakalar.
    const entry = { path: file.path, purpose: file.purpose, content: file.content }
    byPath.set(file.path, entry)
    files.push(entry)
  }

  const commands = { install: spec.installCommand, build: spec.buildCommand, test: spec.testCommand, run: spec.runCommand }
  const plan: ProjectPlan = {
    name: request.name,
    description,
    stack,
    template: spec.template,
    selection: {
      language,
      framework: spec.framework,
      rationale: explicit
        ? `Yığın açıkça belirtildi: ${stack} (${spec.framework}).`
        : `İstekten çıkarıldı: "${prompt.slice(0, 120)}" -> ${stack} (${spec.framework}); ana dil ${language}.`,
      testFrameworks: languageInfo?.testFrameworks ?? [],
      buildTools: languageInfo?.buildTools ?? [],
    },
    directories: parentDirectories(files.map((file) => file.path).filter((file) => !file.startsWith('/') && !file.includes('..'))),
    files,
    dependencies: collectDependencies(new Map(files.map((file) => [file.path, file.content]))),
    envVariables: parseEnv(byPath.get('.env.example')?.content),
    commands,
    entryFiles: spec.entryFiles,
    warnings,
    issues: [],
  }
  plan.issues = checkProjectPlan(plan)
  return plan
}

export function listPlanStacks(): ProjectStack[] {
  return Object.keys(PROJECT_TEMPLATES) as ProjectStack[]
}
