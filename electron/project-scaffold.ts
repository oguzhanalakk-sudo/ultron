import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export interface ProjectSpec {
  name: string
  description: string
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
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(moduleDir, '..', 'templates', 'projects')

// Built-in templates for common project types
const BUILT_IN_TEMPLATES: Record<string, ProjectTemplate> = {
  'nextjs-react': {
    name: 'Next.js + React + TypeScript',
    category: 'web',
    techStack: {
      language: 'typescript',
      framework: 'nextjs',
      runtime: 'node',
      styling: 'tailwind',
      testing: 'vitest',
      packageManager: 'pnpm'
    },
    files: [
      { path: 'package.json', template: 'nextjs/package.json.hbs' },
      { path: 'tsconfig.json', template: 'nextjs/tsconfig.json.hbs' },
      { path: 'next.config.js', template: 'nextjs/next.config.js.hbs' },
      { path: 'tailwind.config.ts', template: 'nextjs/tailwind.config.ts.hbs' },
      { path: '.eslintrc.json', template: 'nextjs/.eslintrc.json.hbs' },
      { path: '.prettierrc', template: 'nextjs/.prettierrc.hbs' },
      { path: 'vitest.config.ts', template: 'nextjs/vitest.config.ts.hbs' },
      { path: 'src/app/layout.tsx', template: 'nextjs/src/app/layout.tsx.hbs' },
      { path: 'src/app/page.tsx', template: 'nextjs/src/app/page.tsx.hbs' },
      { path: 'src/app/globals.css', template: 'nextjs/src/app/globals.css.hbs' },
      { path: 'src/lib/utils.ts', template: 'nextjs/src/lib/utils.ts.hbs' },
      { path: 'src/components/ui/button.tsx', template: 'nextjs/src/components/ui/button.tsx.hbs' },
      { path: '.github/workflows/ci.yml', template: 'nextjs/.github/workflows/ci.yml.hbs' },
      { path: 'Dockerfile', template: 'nextjs/Dockerfile.hbs' },
      { path: 'README.md', template: 'nextjs/README.md.hbs' }
    ]
  },
  'fastapi-python': {
    name: 'FastAPI + Python + SQLAlchemy',
    category: 'api',
    techStack: {
      language: 'python',
      framework: 'fastapi',
      runtime: 'python',
      database: 'postgresql',
      orm: 'sqlalchemy',
      auth: 'jwt',
      testing: 'pytest',
      packageManager: 'uv'
    },
    files: [
      { path: 'pyproject.toml', template: 'fastapi/pyproject.toml.hbs' },
      { path: 'Dockerfile', template: 'fastapi/Dockerfile.hbs' },
      { path: 'docker-compose.yml', template: 'fastapi/docker-compose.yml.hbs' },
      { path: 'alembic.ini', template: 'fastapi/alembic.ini.hbs' },
      { path: 'app/__init__.py', template: 'fastapi/app/__init__.py.hbs' },
      { path: 'app/main.py', template: 'fastapi/app/main.py.hbs' },
      { path: 'app/core/config.py', template: 'fastapi/app/core/config.py.hbs' },
      { path: 'app/core/security.py', template: 'fastapi/app/core/security.py.hbs' },
      { path: 'app/core/database.py', template: 'fastapi/app/core/database.py.hbs' },
      { path: 'app/api/__init__.py', template: 'fastapi/app/api/__init__.py.hbs' },
      { path: 'app/api/v1/__init__.py', template: 'fastapi/app/api/v1/__init__.py.hbs' },
      { path: 'app/api/v1/auth.py', template: 'fastapi/app/api/v1/auth.py.hbs' },
      { path: 'app/api/v1/users.py', template: 'fastapi/app/api/v1/users.py.hbs' },
      { path: 'app/models/__init__.py', template: 'fastapi/app/models/__init__.py.hbs' },
      { path: 'app/models/user.py', template: 'fastapi/app/models/user.py.hbs' },
      { path: 'app/schemas/__init__.py', template: 'fastapi/app/schemas/__init__.py.hbs' },
      { path: 'app/schemas/user.py', template: 'fastapi/app/schemas/user.py.hbs' },
      { path: 'app/crud/__init__.py', template: 'fastapi/app/crud/__init__.py.hbs' },
      { path: 'app/crud/user.py', template: 'fastapi/app/crud/user.py.hbs' },
      { path: 'tests/__init__.py', template: 'fastapi/tests/__init__.py.hbs' },
      { path: 'tests/test_auth.py', template: 'fastapi/tests/test_auth.py.hbs' },
      { path: 'tests/test_users.py', template: 'fastapi/tests/test_users.py.hbs' },
      { path: '.github/workflows/ci.yml', template: 'fastapi/.github/workflows/ci.yml.hbs' },
      { path: 'README.md', template: 'fastapi/README.md.hbs' }
    ]
  },
  'go-api': {
    name: 'Go + Chi + SQLC',
    category: 'api',
    techStack: {
      language: 'go',
      framework: 'chi',
      runtime: 'go',
      database: 'postgresql',
      orm: 'sqlc',
      auth: 'jwt',
      testing: 'testify',
      packageManager: 'go modules'
    },
    files: [
      { path: 'go.mod', template: 'go/go.mod.hbs' },
      { path: 'go.sum', template: 'go/go.sum.hbs' },
      { path: 'Makefile', template: 'go/Makefile.hbs' },
      { path: 'Dockerfile', template: 'go/Dockerfile.hbs' },
      { path: 'docker-compose.yml', template: 'go/docker-compose.yml.hbs' },
      { path: 'cmd/server/main.go', template: 'go/cmd/server/main.go.hbs' },
      { path: 'internal/config/config.go', template: 'go/internal/config/config.go.hbs' },
      { path: 'internal/database/database.go', template: 'go/internal/database/database.go.hbs' },
      { path: 'internal/handler/handler.go', template: 'go/internal/handler/handler.go.hbs' },
      { path: 'internal/middleware/auth.go', template: 'go/internal/middleware/auth.go.hbs' },
      { path: 'internal/repository/user.go', template: 'go/internal/repository/user.go.hbs' },
      { path: 'internal/service/user.go', template: 'go/internal/service/user.go.hbs' },
      { path: 'migrations/001_create_users.sql', template: 'go/migrations/001_create_users.sql.hbs' },
      { path: 'sqlc.yaml', template: 'go/sqlc.yaml.hbs' },
      { path: '.github/workflows/ci.yml', template: 'go/.github/workflows/ci.yml.hbs' },
      { path: 'README.md', template: 'go/README.md.hbs' }
    ]
  },
  'rust-axum': {
    name: 'Rust + Axum + SQLx',
    category: 'api',
    techStack: {
      language: 'rust',
      framework: 'axum',
      runtime: 'rust',
      database: 'postgresql',
      orm: 'sqlx',
      auth: 'jwt',
      testing: 'built-in',
      packageManager: 'cargo'
    },
    files: [
      { path: 'Cargo.toml', template: 'rust/Cargo.toml.hbs' },
      { path: 'Dockerfile', template: 'rust/Dockerfile.hbs' },
      { path: 'docker-compose.yml', template: 'rust/docker-compose.yml.hbs' },
      { path: 'src/main.rs', template: 'rust/src/main.rs.hbs' },
      { path: 'src/config.rs', template: 'rust/src/config.rs.hbs' },
      { path: 'src/db.rs', template: 'rust/src/db.rs.hbs' },
      { path: 'src/handlers.rs', template: 'rust/src/handlers.rs.hbs' },
      { path: 'src/middleware/auth.rs', template: 'rust/src/middleware/auth.rs.hbs' },
      { path: 'src/models.rs', template: 'rust/src/models.rs.hbs' },
      { path: 'src/routes.rs', template: 'rust/src/routes.rs.hbs' },
      { path: 'migrations/20240101000000_create_users.sql', template: 'rust/migrations/20240101000000_create_users.sql.hbs' },
      { path: '.github/workflows/ci.yml', template: 'rust/.github/workflows/ci.yml.hbs' },
      { path: 'README.md', template: 'rust/README.md.hbs' }
    ]
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
    techStack: {
      language: 'typescript',
      framework: 'electron',
      runtime: 'node',
      styling: 'tailwind',
      testing: 'vitest',
      packageManager: 'pnpm'
    },
    files: [
      { path: 'package.json', template: 'electron/package.json.hbs' },
      { path: 'tsconfig.json', template: 'electron/tsconfig.json.hbs' },
      { path: 'vite.config.ts', template: 'electron/vite.config.ts.hbs' },
      { path: 'tailwind.config.ts', template: 'electron/tailwind.config.ts.hbs' },
      { path: 'electron/main.ts', template: 'electron/electron/main.ts.hbs' },
      { path: 'electron/preload.ts', template: 'electron/electron/preload.ts.hbs' },
      { path: 'src/App.tsx', template: 'electron/src/App.tsx.hbs' },
      { path: 'src/main.tsx', template: 'electron/src/main.tsx.hbs' },
      { path: 'src/App.css', template: 'electron/src/App.css.hbs' },
      { path: '.github/workflows/ci.yml', template: 'electron/.github/workflows/ci.yml.hbs' },
      { path: 'README.md', template: 'electron/README.md.hbs' }
    ]
  },
  'node-cli': {
    name: 'Node.js CLI + TypeScript',
    category: 'cli',
    techStack: {
      language: 'typescript',
      framework: 'commander',
      runtime: 'node',
      testing: 'vitest',
      packageManager: 'pnpm'
    },
    files: [
      { path: 'package.json', template: 'cli/package.json.hbs' },
      { path: 'tsconfig.json', template: 'cli/tsconfig.json.hbs' },
      { path: 'src/cli.ts', template: 'cli/src/cli.ts.hbs' },
      { path: 'src/commands/__init__.ts', template: 'cli/src/commands/__init__.ts.hbs' },
      { path: 'src/commands/init.ts', template: 'cli/src/commands/init.ts.hbs' },
      { path: 'src/utils/__init__.ts', template: 'cli/src/utils/__init__.ts.hbs' },
      { path: 'src/utils/fs.ts', template: 'cli/src/utils/fs.ts.hbs' },
      { path: '.github/workflows/ci.yml', template: 'cli/.github/workflows/ci.yml.hbs' },
      { path: 'README.md', template: 'cli/README.md.hbs' }
    ]
  }
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
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return String(data[key] ?? '')
  })
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

  try {
    // Determine template
    let template: ProjectTemplate | undefined

    if (spec.techStack.framework) {
      const templateKey = `${spec.techStack.language}-${spec.techStack.framework}`
        .replace(/\s+/g, '-')
        .toLowerCase()
      template = getTemplate(templateKey)
    }

    if (!template && spec.category) {
      for (const t of Object.values(BUILT_IN_TEMPLATES)) {
        if (t.category === spec.category) {
          template = t
          break
        }
      }
    }

    // Seçilen şablonun dosyaları diskte yoksa boş dosya üretmek yerine minimal
    // iskelet üretilir ve durum açıkça uyarı olarak bildirilir.
    if (template && !templateFilesAvailable(template)) {
      const missing = missingTemplateFiles(template)
      warnings.push(`"${template.name}" şablonunun ${missing.length} dosyası bu kurulumda bulunamadı (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}); bunun yerine minimal iskelet oluşturuldu.`)
      template = undefined
    }

    if (!template) {
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
      uuid: () => randomUUID()
    }

    // Tüm kullanıcı denetimli yolları yazmadan önce doğrula. Böylece geçersiz bir
    // yapı girdisi, kısmi proje oluşturup sonra hata vermek yerine hiç yazılmaz.
    for (const fileSpec of spec.structure?.files ?? []) safeRelativePath(fileSpec.path, 'Dosya yolu')
    for (const directory of spec.structure?.directories ?? []) safeRelativePath(directory, 'Klasör yolu')

    await ensureDir(projectRoot)

    for (const fileSpec of template.files) {
      const fullPath = path.join(projectRoot, safeRelativePath(fileSpec.path, 'Şablon dosya yolu'))
      let content = fileSpec.content ?? ''

      if (fileSpec.template) {
        const templateFullPath = path.join(TEMPLATES_DIR, fileSpec.template)
        content = await renderTemplate(templateFullPath, {
          ...templateData,
          ...fileSpec.templateData
        })
      }

      const created = await writeFileIfNotExists(fullPath, content)
      if (created) {
        filesCreated.push(fileSpec.path)
      } else {
        filesSkipped.push(fileSpec.path)
      }
    }

    if (spec.structure?.files) {
      for (const fileSpec of spec.structure.files) {
        const fullPath = path.join(projectRoot, safeRelativePath(fileSpec.path, 'Dosya yolu'))
        let content = fileSpec.content ?? ''

        if (fileSpec.template) {
          // Yapı dosyası eksik şablona işaret ediyorsa boş dosya yazmak yerine atlanır.
          const templateFullPath = path.join(TEMPLATES_DIR, fileSpec.template)
          if (!existsSync(templateFullPath)) {
            warnings.push(`Şablon dosyası bulunamadı, dosya atlandı: ${fileSpec.template}`)
            filesSkipped.push(fileSpec.path)
            continue
          }
          content = await renderTemplate(templateFullPath, {
            ...templateData,
            ...fileSpec.templateData
          })
        }

        const created = await writeFileIfNotExists(fullPath, content)
        if (created) {
          filesCreated.push(fileSpec.path)
        } else {
          filesSkipped.push(fileSpec.path)
        }
      }
    }

    if (spec.structure?.directories) {
      for (const dir of spec.structure.directories) {
        await ensureDir(path.join(projectRoot, safeRelativePath(dir, 'Klasör yolu')))
      }
    }

    if (filesCreated.length > 0) {
      nextSteps.push(`cd ${spec.name}`)
      nextSteps.push('Install dependencies (e.g., pnpm install / cargo build / uv sync)')
      nextSteps.push('Run development server')
      nextSteps.push('Run tests')
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
