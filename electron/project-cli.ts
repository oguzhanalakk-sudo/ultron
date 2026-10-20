import fs from 'node:fs/promises'
import path from 'node:path'
import { BUILT_IN_TEMPLATE_STACKS } from './project-generators.ts'
import { buildProjectPlan, hasPlanErrors, type ProjectPlan } from './project-plan.ts'
import { writeProjectPlan, type WriteReport } from './project-writer.ts'
import { buildProjectFromSpec, getTemplate as getBuiltInTemplate } from './project-scaffold.ts'
import {
  buildProjectSpec,
  inferStackFromPrompt,
  inferTemplateFromPrompt,
  type ProjectStack,
  type ProjectTemplate,
} from './project-template-registry.ts'

export type NewProjectRequest = {
  name: string
  stack: ProjectStack
  template: ProjectTemplate
  templateId?: string
  targetDir?: string
  workspaceRoot?: string
  description: string
  install?: boolean
  verify?: boolean
  prompt: string
}

export type ProjectArtifact = {
  name: string
  root: string
  stack: ProjectStack
  template: ProjectTemplate | string
  files: string[]
  scripts: Record<string, string>
  envExample?: string
  warnings?: string[]
  /** Dosyalar var olduğu için atlananlar (üzerine yazılmaz). */
  skipped?: string[]
  plan?: ProjectPlan
  write?: WriteReport
}

const stackNames = new Set<ProjectStack>([
  'react', 'vite', 'node', 'express', 'python-fastapi', 'electron', 'next', 'fullstack', 'go', 'rust',
])
const templateNames = new Set<ProjectTemplate>(['web-app', 'api', 'desktop', 'dashboard', 'fullstack'])
const booleanOptions = new Set(['install', 'verify'])

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote = ''
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quote) {
      if (char === quote) quote = ''
      else if (char === '\\' && input[index + 1] === quote) token += input[++index]
      else token += char
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      if (token) tokens.push(token)
      token = ''
    } else {
      token += char
    }
  }
  if (quote) throw new Error('Komut satırında kapatılmamış tırnak var.')
  if (token) tokens.push(token)
  return tokens
}

function slugifyProjectName(value: string): string {
  const name = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60)

  if (!name || name === '.' || name === '..' || /[. ]$/.test(name)) {
    throw new Error('İstekten güvenli bir proje klasör adı çıkarılamadı; --name ile ad belirtin.')
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('Proje adı Windows tarafından ayrılmış bir aygıt adına karşılık geliyor.')
  }
  return name
}

function parseTokens(tokens: string[]): { positionals: string[]; options: Map<string, string> } {
  const positionals: string[] = []
  const options = new Map<string, string>()

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const separator = token.indexOf('=')
    const key = (separator >= 0 ? token.slice(2, separator) : token.slice(2)).toLowerCase()
    if (!['stack', 'template', 'dir', 'directory', 'workspace', 'name', 'description', 'install', 'verify'].includes(key)) {
      throw new Error(`Bilinmeyen seçenek: --${key}`)
    }

    let value = separator >= 0 ? token.slice(separator + 1) : ''
    if (booleanOptions.has(key)) {
      if (!value && ['true', 'false', '1', '0'].includes(tokens[index + 1]?.toLowerCase() ?? '')) value = tokens[++index].toLowerCase()
      options.set(key, value === 'false' || value === '0' ? 'false' : 'true')
      continue
    }

    if (!value) {
      const next = tokens[index + 1]
      if (!next || next.startsWith('--')) throw new Error(`--${key} seçeneği bir değer gerektirir.`)
      value = tokens[++index]
    }
    options.set(key, value)
  }

  return { positionals, options }
}

export function parseProjectRequest(input: string | string[]): NewProjectRequest {
  const tokens = typeof input === 'string'
    ? tokenize(input.trim())
    : input.length === 1
      ? tokenize(input[0])
      : input.slice()
  if (!tokens.length) throw new Error('Proje isteği boş.')

  const { positionals, options } = parseTokens(tokens)
  const prompt = tokens.join(' ').trim()
  const rawName = options.get('name') ?? positionals.join(' ')
  if (!rawName) throw new Error('Proje adı eksik. Örnek: ultron "React dashboard".')
  const name = slugifyProjectName(rawName)

  const stackValue = options.get('stack')
  if (stackValue && !stackNames.has(stackValue as ProjectStack)) {
    throw new Error(`Desteklenmeyen yığın: ${stackValue}. Desteklenenler: ${[...stackNames].join(', ')}`)
  }
  const templateValue = options.get('template')
  const isBuiltInTemplate = Boolean(templateValue && getBuiltInTemplate(templateValue))
  if (templateValue && !templateNames.has(templateValue as ProjectTemplate) && !isBuiltInTemplate) {
    throw new Error(`Bilinmeyen şablon: ${templateValue}. Yerleşik şablonları --list ile görüntüleyin.`)
  }

  const builtInStacks: Record<string, ProjectStack> = { ...BUILT_IN_TEMPLATE_STACKS, 'tauri-react': 'electron' }
  const inferredStack = (stackValue as ProjectStack | undefined) ?? builtInStacks[templateValue ?? ''] ?? inferStackFromPrompt(prompt)
  const genericTemplate = templateValue && templateNames.has(templateValue as ProjectTemplate)
    ? templateValue as ProjectTemplate
    : inferTemplateFromPrompt(prompt)
  const targetDir = options.get('dir')
  const workspaceRoot = options.get('directory') ?? options.get('workspace')
  const description = options.get('description') ?? prompt

  return {
    name,
    stack: inferredStack,
    template: genericTemplate,
    templateId: isBuiltInTemplate ? templateValue : undefined,
    targetDir,
    workspaceRoot,
    description,
    install: options.get('install') === 'true',
    verify: options.get('verify') === 'true',
    prompt,
  }
}

function scriptsForSpec(spec: ReturnType<typeof buildProjectSpec>): Record<string, string> {
  return {
    install: spec.installCommand,
    build: spec.buildCommand,
    ...(spec.testCommand ? { test: spec.testCommand } : {}),
    start: spec.runCommand,
  }
}

export function generateProjectArtifact(request: NewProjectRequest): ProjectArtifact {
  const name = slugifyProjectName(request.name)
  const spec = buildProjectSpec({ stack: request.stack, template: request.template, prompt: request.prompt })
  const defaultRoot = path.join(request.workspaceRoot ? path.resolve(request.workspaceRoot) : process.cwd(), name)
  const root = path.resolve(request.targetDir ?? defaultRoot)
  const template = request.templateId ?? spec.template
  return {
    name,
    root,
    stack: request.stack,
    template,
    files: [],
    scripts: scriptsForSpec(spec),
    envExample: spec.envExample,
  }
}

/** Gömülü üreticisi olmayan yerleşik şablonlar (ör. tauri-react) için açık uyarılı geri düşüş. */
async function createFromBuiltInTemplate(request: NewProjectRequest, artifact: ProjectArtifact): Promise<ProjectArtifact> {
  const template = getBuiltInTemplate(request.templateId!)
  if (!template) throw new Error(`Bilinmeyen yerleşik şablon: ${request.templateId}`)
  const targetRoot = path.resolve(artifact.root)
  const parent = path.dirname(targetRoot)
  const name = path.basename(targetRoot)
  await fs.mkdir(parent, { recursive: true })
  try {
    await fs.lstat(targetRoot)
    throw new Error(`Hedef zaten var; mevcut dosyalara dokunulmadı: ${targetRoot}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Hedef zaten var;')) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const result = await buildProjectFromSpec({
    name,
    description: request.description,
    templateId: request.templateId,
    category: template.category as 'web' | 'api' | 'cli' | 'desktop' | 'mobile' | 'library' | 'monorepo',
    techStack: { ...template.techStack },
    features: [],
  }, { workspaceRoot: parent })
  if (!result.success) throw new Error(result.error ?? 'Yerleşik proje şablonu oluşturulamadı.')
  return { ...artifact, template: result.templateName, files: result.filesCreated, skipped: result.filesSkipped, warnings: result.warnings }
}

/** Plan aşaması: diske yazmaz. */
export function planProject(request: NewProjectRequest): ProjectPlan {
  const stack = (request.templateId && BUILT_IN_TEMPLATE_STACKS[request.templateId]) || request.stack
  return buildProjectPlan({
    name: slugifyProjectName(request.name),
    description: request.description,
    prompt: request.prompt,
    stack,
    template: request.template,
  })
}

export async function createProject(request: NewProjectRequest): Promise<ProjectArtifact> {
  const artifact = generateProjectArtifact(request)
  if (request.templateId && !BUILT_IN_TEMPLATE_STACKS[request.templateId]) return createFromBuiltInTemplate(request, artifact)

  const plan = planProject(request)
  if (hasPlanErrors(plan.issues)) {
    const details = plan.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}: ${issue.message}`).join('; ')
    throw new Error(`Proje planı tutarlılık denetiminden geçemedi; hiçbir dosya yazılmadı. ${details}`)
  }

  const write = await writeProjectPlan(plan, { root: artifact.root })
  if (!write.ok) {
    const failed = write.failed.map((item) => `${item.path}: ${item.error}`).join('; ')
    throw new Error(`Proje kısmen oluşturuldu; mevcut dosyalar korunmuştur. Klasör: ${artifact.root}. ${write.error ?? failed} Oluşturulan: ${write.created.length}, atlanan: ${write.skipped.length}, denenmeyen: ${write.notAttempted.length}.`)
  }

  const warnings = [...plan.warnings, ...plan.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message)]
  if (write.skipped.length) warnings.push(`${write.skipped.length} mevcut dosya atlandı (üzerine yazılmadı).`)
  return {
    ...artifact,
    stack: plan.stack,
    files: write.created,
    skipped: write.skipped.map((item) => item.path),
    warnings,
    plan,
    write,
  }
}
