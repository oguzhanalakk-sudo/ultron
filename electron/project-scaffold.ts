import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { renderTemplateString } from './project-template-engine.ts'
import { buildProjectPlan, hasPlanErrors } from './project-plan.ts'
import { ancestorStaysInside, writeProjectPlan } from './project-writer.ts'
import type { ProjectStack } from './project-template-registry.ts'

export interface ProjectSpec {
  name: string
  description: string
  templateId?: string
  category: 'web' | 'api' | 'cli' | 'desktop' | 'mobile' | 'library' | 'monorepo'
  techStack: {
    language: string
    framework: string
    runtime?: string
    database?: string
    orm?: string
    auth?: string
    styling?: string
    testing?: string
    deployment?: string
    ci?: string
    packageManager?: string
  }
  features: FeatureSpec[]
  structure?: DirectoryStructure
  config?: Record<string, unknown>
}

export interface FeatureSpec {
  name: string
  description: string
  type: 'auth' | 'crud' | 'api' | 'realtime' | 'background' | 'file' | 'search' | 'payment' | 'email' | 'custom'
  spec: Record<string, unknown>
}

export interface DirectoryStructure {
  directories: string[]
  files: FileSpec[]
}

export interface FileSpec {
  path: string
  content?: string
  template?: string
  templateData?: Record<string, unknown>
}

export interface ScaffoldResult {
  success: boolean
  projectPath: string
  filesCreated: string[]
  filesSkipped: string[]
  error?: string
  templateName: string
  warnings: string[]
  nextSteps: string[]
}

export interface ProjectTemplate {
  name: string
  category: string
  techStack: ProjectSpec['techStack']
  files: FileSpec[]
  /** Gömülü üretici yığını; varsa şablon diske bağımlı değildir. */
  stack?: ProjectStack
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(moduleDir, '..', 'templates', 'projects')

// Yerleşik şablonlar. `stack` olanlar gömülü TypeScript üreticileriyle (çok dosyalı,
// diske bağımlı değil) üretilir; `files` içinde `.hbs` başvurusu olanlar yalnızca
// `templates/projects` klasörü varsa kullanılabilir ve aksi halde "kullanılamaz" raporlanır.
const BUILT_IN_TEMPLATES: Record<string, ProjectTemplate> = {
  'nextjs-react': {
    name: 'Next.js + React + TypeScript',
    category: 'web',
    stack: 'next',
    techStack: { language: 'typescript', framework: 'nextjs', runtime: 'node', packageManager: 'npm' },
    files: [],
  },
  'fastapi-python': {
    name: 'FastAPI + Python + SQLAlchemy',
    category: 'api',
    stack: 'python-fastapi',
    techStack: { language: 'python', framework: 'fastapi', runtime: 'python', database: 'sqlite', orm: 'sqlalchemy', testing: 'pytest', packageManager: 'pip' },
    files: [],
  },
  'go-api': {
    name: 'Go + net/http',
    category: 'api',
    stack: 'go',
    techStack: { language: 'go', framework: 'net/http', runtime: 'go', testing: 'go test', packageManager: 'go' },
    files: [],
  },
  'rust-axum': {
    name: 'Rust + Axum',
    category: 'api',
    stack: 'rust',
    techStack: { language: 'rust', framework: 'axum', runtime: 'rust', testing: 'cargo test', packageManager: 'cargo' },
    files: [],
  },
  'tauri-react': {
    name: 'Tauri + React + TypeScript',
    category: 'desktop',
    techStack: {
      language: 'typescript',
      framework: 'tauri',
      runtime: 'node',
      styling: 'tailwind',
      testing: 'vitest',
      packageManager: 'pnpm'
    },
    files: [
      { path: 'package.json', template: 'tauri/package.json.hbs' },
      { path: 'tsconfig.json', template: 'tauri/tsconfig.json.hbs' },
      { path: 'vite.config.ts', template: 'tauri/vite.config.ts.hbs' },
      { path: 'tailwind.config.ts', template: 'tauri/tailwind.config.ts.hbs' },
      { path: 'src/App.tsx', template: 'tauri/src/App.tsx.hbs' },
      { path: 'src/main.tsx', template: 'tauri/src/main.tsx.hbs' },
      { path: 'src/App.css', template: 'tauri/src/App.css.hbs' },
      { path: 'src-tauri/Cargo.toml', template: 'tauri/src-tauri/Cargo.toml.hbs' },
      { path: 'src-tauri/tauri.conf.json', template: 'tauri/src-tauri/tauri.conf.json.hbs' },
      { path: 'src-tauri/src/main.rs', template: 'tauri/src-tauri/src/main.rs.hbs' },
      { path: 'src-tauri/src/commands.rs', template: 'tauri/src-tauri/src/commands.rs.hbs' },
      { path: '.github/workflows/ci.yml', template: 'tauri/.github/workflows/ci.yml.hbs' },
      { path: 'README.md', template: 'tauri/README.md.hbs' }
    ]
  },
  'electron-react': {
    name: 'Electron + React + TypeScript',
    category: 'desktop',
    stack: 'electron',
    techStack: { language: 'typescript', framework: 'electron', runtime: 'node', packageManager: 'npm' },
    files: [],
  },
  'node-cli': {
    name: 'Node.js CLI (ESM)',
    category: 'cli',
    stack: 'node',
    techStack: { language: 'javascript', framework: 'node', runtime: 'node', testing: 'node:test', packageManager: 'npm' },
    files: [],
  },
}

function getTemplate(templateName: string): ProjectTemplate | undefined {
  return BUILT_IN_TEMPLATES[templateName]
}

function listTemplates(): Array<{ id: string; name: string; category: string; available: boolean }> {
  return Object.entries(BUILT_IN_TEMPLATES).map(([id, template]) => ({
    id,
    name: template.name,
    category: template.category,
    available: templateFilesAvailable(template),
  }))
}

/** Bir şablonun diskteki dosyaları gerçekten var mı? Eksik şablon dosyası,
 *  boş dosya üretmek yerine şablonun kullanılamaz sayılmasına yol açar. */
function templateFilesAvailable(template: ProjectTemplate): boolean {
  if (template.stack) return true
  return template.files.every((file) => {
    if (!file.template) return true
    return existsSync(path.join(TEMPLATES_DIR, file.template))
  })
}

function missingTemplateFiles(template: ProjectTemplate): string[] {
  return template.files
    .filter((file) => Boolean(file.template) && !existsSync(path.join(TEMPLATES_DIR, file.template!)))
    .map((file) => file.template!)
}

async function renderTemplate(templatePath: string, data: Record<string, unknown>): Promise<string> {
  // Şablon dosyası yoksa sessizce boş içerik döndürmek, "oluşturuldu" denilen
  // ama içi boş dosyalar bırakırdı. Bunun yerine açık bir hata fırlatılır.
  let template: string
  try {
    template = await fs.readFile(templatePath, 'utf-8')
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'bulunamadı' : 'okunamadı'
    throw new Error(`Şablon dosyası ${reason}: ${templatePath}`)
  }
  return renderTemplateString(template, data)
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function writeFileIfNotExists(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return false
  } catch {
    await ensureDir(path.dirname(filePath))
    await fs.writeFile(filePath, content, 'utf-8')
    return true
  }
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app'
}

function safeRelativePath(value: string, label: string): string {
  const normalized = value.replace(/\\/g, '/').trim()
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').some((part) => part === '..' || part === '.')) throw new Error(`${label} proje kapsamı dışına çıkamaz.`)
  return normalized
}

export async function buildProjectFromSpec(spec: ProjectSpec, options: { workspaceRoot: string }): Promise<ScaffoldResult> {
  const projectName = safeRelativePath(spec.name, 'Proje adı')
  if (projectName.includes('/')) throw new Error('Proje adı tek bir klasör adı olmalı.')
  const workspaceRoot = path.resolve(options.workspaceRoot)
  const projectRoot = path.resolve(workspaceRoot, projectName)
  if (path.relative(workspaceRoot, projectRoot).startsWith('..') || path.isAbsolute(path.relative(workspaceRoot, projectRoot))) throw new Error('Proje kökü seçili çalışma alanı dışında olamaz.')
  const filesCreated: string[] = []
  const filesSkipped: string[] = []
  const warnings: string[] = []
  const nextSteps: string[] = []
  let commands: { install: string; build: string; test?: string; run: string } | undefined

  try {
    // Şablonu belirle
    let template: ProjectTemplate | undefined

    if (spec.templateId) {
      template = getTemplate(spec.templateId)
      if (!template) throw new Error(`Bilinmeyen proje şablonu: ${spec.templateId}`)
    }

    if (!template && spec.techStack.framework) {
      const language = spec.techStack.language.toLowerCase()
      const framework = spec.techStack.framework.toLowerCase().replace(/\s+/g, '-')
      template = Object.values(BUILT_IN_TEMPLATES).find((candidate) =>
        templateFilesAvailable(candidate) && candidate.techStack.language === language && candidate.techStack.framework.toLowerCase() === framework)
    }

    if (!template && spec.category) {
      template = Object.values(BUILT_IN_TEMPLATES).find((candidate) => candidate.category === spec.category && templateFilesAvailable(candidate))
    }

    // Seçilen şablonun dosyaları diskte yoksa boş dosya üretmek yerine minimal
    // iskelet üretilir ve durum açıkça uyarı olarak bildirilir.
    if (template && !templateFilesAvailable(template)) {
      const missing = missingTemplateFiles(template)
      warnings.push(`"${template.name}" şablonunun ${missing.length} dosyası bu kurulumda bulunamadı (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}); bunun yerine minimal iskelet oluşturuldu.`)
      template = undefined
    }

    if (!template) {
      if (warnings.length === 0) warnings.push(`"${spec.category}" / "${spec.techStack.framework || spec.techStack.language}" için yerleşik şablon bulunamadı; minimal iskelet oluşturuldu.`)
      template = {
        name: 'Minimal Project',
        category: spec.category,
        techStack: spec.techStack,
        files: [
          { path: 'README.md', content: `# ${spec.name}\n\n${spec.description}` },
          { path: '.gitignore', content: 'node_modules\n.env\n*.log\n.DS_Store' }
        ]
      }
    }

    const mergedTechStack = { ...template.techStack, ...spec.techStack }

    const templateData = {
      projectName: spec.name,
      projectDescription: spec.description,
      projectCategory: spec.category,
      ...mergedTechStack,
      features: spec.features,
      year: new Date().getFullYear(),
      uuid: randomUUID()
    }

    // Tüm kullanıcı denetimli yolları yazmadan önce doğrula. Böylece geçersiz bir
    // yapı girdisi, kısmi proje oluşturup sonra hata vermek yerine hiç yazılmaz.
    for (const fileSpec of spec.structure?.files ?? []) safeRelativePath(fileSpec.path, 'Dosya yolu')
    for (const directory of spec.structure?.directories ?? []) safeRelativePath(directory, 'Klasör yolu')

    // Yapı dosyalarının içeriğini hazırla (eksik şablona işaret edenler atlanır).
    const structureFiles: Array<{ path: string; purpose: string; content: string }> = []
    for (const fileSpec of spec.structure?.files ?? []) {
      let content = fileSpec.content ?? ''
      if (fileSpec.template) {
        const templateFullPath = path.join(TEMPLATES_DIR, fileSpec.template)
        if (!existsSync(templateFullPath)) {
          warnings.push(`Şablon dosyası bulunamadı, dosya atlandı: ${fileSpec.template}`)
          filesSkipped.push(fileSpec.path)
          continue
        }
        content = await renderTemplate(templateFullPath, { ...templateData, ...fileSpec.templateData })
      }
      structureFiles.push({ path: safeRelativePath(fileSpec.path, 'Dosya yolu'), purpose: 'Kullanıcı tanımlı dosya', content })
    }

    if (template.stack) {
      // Plan (diske yazmaz) -> statik denetim -> yazma (üzerine yazmaz).
      const generatedPlan = buildProjectPlan({ name: slugify(spec.name), description: spec.description, stack: template.stack })
      const taken = new Set(generatedPlan.files.map((file) => file.path.toLowerCase()))
      const extraFiles = structureFiles.filter((file) => {
        if (!taken.has(file.path.toLowerCase())) return true
        filesSkipped.push(file.path)
        warnings.push(`"${file.path}" şablon tarafından zaten üretiliyor; mevcut dosya korundu, yapı girdisi atlandı.`)
        return false
      })
      const plan = buildProjectPlan({ name: slugify(spec.name), description: spec.description, stack: template.stack, extraFiles })
      warnings.push(...plan.warnings, ...plan.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message))
      if (hasPlanErrors(plan.issues)) {
        const details = plan.issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}: ${issue.message}`).join('; ')
        throw new Error(`Proje planı tutarlılık denetiminden geçemedi; hiçbir dosya yazılmadı. ${details}`)
      }
      const write = await writeProjectPlan(plan, { root: projectRoot })
      filesCreated.push(...write.created)
      filesSkipped.push(...write.skipped.map((item) => item.path))
      if (!write.ok) throw new Error(`${write.error ?? 'Yazma başarısız.'} Oluşturulan: ${write.created.length}, denenmeyen: ${write.notAttempted.length}.`)
      commands = plan.commands
    } else {
      await ensureDir(projectRoot)
      const legacy: Array<{ path: string; content: string }> = []
      for (const fileSpec of template.files) {
        let content = fileSpec.content ?? ''
        if (fileSpec.template) {
          content = await renderTemplate(path.join(TEMPLATES_DIR, fileSpec.template), { ...templateData, ...fileSpec.templateData })
        }
        legacy.push({ path: safeRelativePath(fileSpec.path, 'Şablon dosya yolu'), content })
      }
      for (const file of [...legacy, ...structureFiles]) {
        const created = await writeFileIfNotExists(path.join(projectRoot, file.path), file.content)
        if (created) filesCreated.push(file.path)
        else filesSkipped.push(file.path)
      }
    }

    if (spec.structure?.directories) {
      const realRoot = await fs.realpath(projectRoot)
      for (const dir of spec.structure.directories) {
        const target = path.join(realRoot, safeRelativePath(dir, 'Klasör yolu'))
        if (!(await ancestorStaysInside(realRoot, target))) throw new Error(`Klasör yolu proje kapsamı dışına çıkıyor: ${dir}`)
        await ensureDir(target)
      }
    }

    if (filesCreated.length > 0) {
      nextSteps.push(`cd ${spec.name}`)
      if (commands) {
        nextSteps.push(commands.install)
        nextSteps.push(commands.build)
        if (commands.test) nextSteps.push(commands.test)
        nextSteps.push(commands.run)
      } else {
        nextSteps.push('Bağımlılıkları kurun ve geliştirme/test komutlarını projeye göre çalıştırın.')
      }
    }

    return {
      success: true,
      projectPath: projectRoot,
      filesCreated,
      filesSkipped,
      templateName: template.name,
      warnings,
      nextSteps
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      projectPath: projectRoot,
      filesCreated,
      filesSkipped,
      error: message,
      templateName: 'bilinmiyor',
      warnings,
      nextSteps: []
    }
  }
}

export { BUILT_IN_TEMPLATES, listTemplates, getTemplate }
