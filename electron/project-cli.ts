import fs from 'node:fs/promises'
import path from 'node:path'
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

  const builtInStacks: Record<string, ProjectStack> = {
    'nextjs-react': 'next',
    'fastapi-python': 'python-fastapi',
    'go-api': 'go',
    'rust-axum': 'rust',
    'tauri-react': 'electron',
    'electron-react': 'electron',
    'node-cli': 'node',
  }
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

function scriptsForStack(stack: ProjectStack): Record<string, string> {
  if (stack === 'react' || stack === 'vite') return { dev: 'vite', build: 'vite build', start: 'vite preview' }
  if (stack === 'express') return { dev: 'node --watch server.js', build: 'node --check server.js', start: 'node server.js' }
  if (stack === 'node') return { dev: 'node --watch server.js', build: 'node --check server.js', start: 'node server.js' }
  if (stack === 'python-fastapi') return { dev: 'uvicorn app:app --reload', build: 'python -m py_compile app.py', start: 'uvicorn app:app --host 127.0.0.1 --port 8000' }
  if (stack === 'electron') return { dev: 'electron-vite dev', build: 'electron-vite build', start: 'electron-vite preview' }
  if (stack === 'next') return { dev: 'next dev', build: 'next build', start: 'next start' }
  if (stack === 'go') return { build: 'go test ./...', start: 'go run ./cmd/server' }
  if (stack === 'rust') return { build: 'cargo check', start: 'cargo run' }
  return { dev: 'concurrently -k "npm:dev:server" "npm:dev:client"', build: 'npm --workspace client run build && node --check server/index.js', start: 'node server/index.js' }
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
    scripts: scriptsForStack(request.stack),
    envExample: spec.envExample,
  }
}

function packageJson(name: string, scripts: Record<string, string>, dependencies: Record<string, string>, devDependencies: Record<string, string> = {}): string {
  return JSON.stringify({ name, private: true, version: '1.0.0', type: 'module', scripts, dependencies, ...(Object.keys(devDependencies).length ? { devDependencies } : {}) }, null, 2) + '\n'
}

function projectFiles(artifact: ProjectArtifact, request: NewProjectRequest): Map<string, string> {
  const files = new Map<string, string>()
  const name = artifact.name
  const description = request.description.replace(/\r/g, '').slice(0, 1_000)
  files.set('README.md', `# ${name}\n\n${description}\n\nOluşturma şablonu: ${artifact.template}\n`)
  files.set('.gitignore', 'node_modules/\ndist/\n.next/\nout/\n.env\n.env.*\n!.env.example\n__pycache__/\n')
  files.set('.env.example', artifact.envExample ?? '')

  if (artifact.stack === 'react' || artifact.stack === 'vite') {
    if (artifact.stack === 'react') {
      files.set('package.json', packageJson(name, artifact.scripts, { react: '^19.1.0', 'react-dom': '^19.1.0' }, { vite: '^6.0.0', '@vitejs/plugin-react': '^4.3.4', typescript: '^5.7.3', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' }))
      files.set('index.html', `<!doctype html>\n<html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`)
      files.set('vite.config.ts', "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n")
      files.set('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true, moduleResolution: 'Bundler', allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx', strict: true }, include: ['src'] }, null, 2) + '\n')
      files.set('src/main.tsx', "import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './style.css'\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)\n")
      files.set('src/App.tsx', `export default function App() {\n  return <main className="shell"><p className="eyebrow">ULTRON PROJECT</p><h1>${name}</h1><p>${description.replace(/[<>]/g, '')}</p><section className="card"><strong>Projen hazır.</strong><span>İlk ekranını buradan geliştirmeye başlayabilirsin.</span></section></main>\n}\n`)
      files.set('src/style.css', ':root{font-family:Inter,system-ui,sans-serif;color:#e5e7eb;background:#0b1020;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box}body{margin:0;min-width:320px;min-height:100vh}.shell{width:min(900px,92vw);margin:12vh auto}.eyebrow{color:#60a5fa;letter-spacing:.16em;font-size:.75rem;font-weight:700}h1{font-size:clamp(2.5rem,8vw,5rem);margin:.3rem 0}p{color:#aab4c5;line-height:1.7}.card{display:grid;gap:.5rem;margin-top:2rem;padding:1.5rem;border:1px solid #334155;border-radius:1rem;background:#111a2e}.card span{color:#aab4c5}\n')
    } else {
      files.set('package.json', packageJson(name, artifact.scripts, {}, { vite: '^6.0.0', typescript: '^5.7.3' }))
      files.set('index.html', `<!doctype html>\n<html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head><body><main><h1>${name}</h1><p>Vite uygulaman hazır.</p></main><script type="module" src="/src/main.ts"></script></body></html>\n`)
      files.set('src/main.ts', "import './style.css'\nconsole.log('Vite app ready')\n")
      files.set('src/style.css', ':root{font-family:system-ui,sans-serif;color:#e5e7eb;background:#0b1020}body{margin:0;min-height:100vh;display:grid;place-items:center}\n')
    }
  } else if (artifact.stack === 'express') {
    files.set('package.json', packageJson(name, artifact.scripts, { express: '^5.1.0' }))
    files.set('server.js', `import express from 'express'\n\nconst app = express()\nconst port = Number(process.env.PORT ?? 3000)\napp.use(express.json())\napp.get('/health', (_request, response) => response.json({ name: '${name}', status: 'ok' }))\napp.listen(port, '127.0.0.1', () => console.log(\`API listening on http://127.0.0.1:\${port}\`))\n`)
  } else if (artifact.stack === 'node') {
    files.set('package.json', packageJson(name, artifact.scripts, {}))
    files.set('server.js', `console.log('${name} is ready')\n`)
  } else if (artifact.stack === 'python-fastapi') {
    files.set('requirements.txt', 'fastapi>=0.115,<1\nuvicorn[standard]>=0.34,<1\n')
    files.set('app.py', `from fastapi import FastAPI\n\napp = FastAPI(title='${name}')\n\n@app.get('/health')\ndef health():\n    return {'name': '${name}', 'status': 'ok'}\n`)
  } else if (artifact.stack === 'next') {
    files.set('package.json', packageJson(name, artifact.scripts, { next: '^15.1.0', react: '^19.0.0', 'react-dom': '^19.0.0' }, { typescript: '^5.7.3', '@types/node': '^22.0.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' }))
    files.set('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2017', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true, jsx: 'preserve', incremental: true, plugins: [{ name: 'next' }] }, include: ['next-env.d.ts', '.next/types/**/*.ts', '**/*.ts', '**/*.tsx'], exclude: ['node_modules'] }, null, 2) + '\n')
    files.set('next.config.mjs', 'const nextConfig = { reactStrictMode: true }\nexport default nextConfig\n')
    files.set('app/layout.tsx', `import type { ReactNode } from 'react'\nimport './globals.css'\n\nexport const metadata = { title: '${name}', description: '${description.replace(/[\r\n']/g, ' ').slice(0, 180)}' }\n\nexport default function RootLayout({ children }: { children: ReactNode }) { return <html lang="tr"><body>{children}</body></html> }\n`)
    files.set('app/page.tsx', `export default function Home() { return <main><h1>${name}</h1><p>${description.replace(/[<>]/g, '')}</p></main> }\n`)
    files.set('app/globals.css', 'body{margin:0;background:#0b1020;color:#e5e7eb;font-family:system-ui,sans-serif}main{max-width:900px;margin:12vh auto;padding:24px}\n')
  } else if (artifact.stack === 'electron') {
    files.set('package.json', packageJson(name, artifact.scripts, { electron: '^35.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' }, { 'electron-vite': '^3.0.0', '@vitejs/plugin-react': '^4.3.4', typescript: '^5.7.3', vite: '^6.0.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' }))
    files.set('electron.vite.config.ts', "import { defineConfig, externalizeDepsPlugin } from 'electron-vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  main: { plugins: [externalizeDepsPlugin()] },\n  preload: { plugins: [externalizeDepsPlugin()] },\n  renderer: { plugins: [react()] },\n})\n")
    files.set('electron/main.ts', "import { app, BrowserWindow } from 'electron'\nimport path from 'node:path'\nimport { fileURLToPath } from 'node:url'\n\nconst currentDir = path.dirname(fileURLToPath(import.meta.url))\nfunction createWindow() {\n  const window = new BrowserWindow({ width: 1200, height: 800, webPreferences: { preload: path.join(currentDir, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })\n  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)\n  else void window.loadFile(path.join(currentDir, '../renderer/index.html'))\n}\napp.whenReady().then(createWindow)\n")
    files.set('electron/preload.ts', "import { contextBridge } from 'electron'\ncontextBridge.exposeInMainWorld('ultronApi', Object.freeze({}))\n")
    files.set('index.html', `<!doctype html>\n<html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`)
    files.set('src/main.tsx', "import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './style.css'\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)\n")
    files.set('src/App.tsx', `export default function App() { return <main><h1>${name}</h1><p>${description.replace(/[<>]/g, '')}</p></main> }\n`)
    files.set('src/style.css', ':root{font-family:system-ui,sans-serif;color:#e5e7eb;background:#0b1020}body{margin:0;min-height:100vh;display:grid;place-items:center}\n')
  } else if (artifact.stack === 'fullstack') {
    const rootPackage = JSON.parse(packageJson(name, artifact.scripts, { concurrently: '^9.1.0', express: '^5.1.0' })) as Record<string, unknown>
    rootPackage.workspaces = ['client']
    files.set('package.json', JSON.stringify(rootPackage, null, 2) + '\n')
    files.set('server/index.js', `import express from 'express'\nconst app = express()\nconst port = Number(process.env.PORT ?? 3000)\napp.get('/api/health', (_request, response) => response.json({ status: 'ok' }))\napp.listen(port, '127.0.0.1', () => console.log(\`API listening on http://127.0.0.1:\${port}\`))\n`)
    files.set('client/package.json', packageJson(`${name}-client`, { dev: 'vite', build: 'vite build', start: 'vite preview' }, { react: '^19.1.0', 'react-dom': '^19.1.0' }, { vite: '^6.0.0', '@vitejs/plugin-react': '^4.3.4', typescript: '^5.7.3', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' }))
    files.set('client/index.html', `<!doctype html>\n<html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`)
    files.set('client/vite.config.ts', "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })\n")
    files.set('client/src/main.tsx', "import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './style.css'\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)\n")
    files.set('client/src/App.tsx', `export default function App() { return <main><h1>${name}</h1><p>React istemcisi ve Express API hazır.</p></main> }\n`)
    files.set('client/src/style.css', ':root{font-family:system-ui,sans-serif;color:#e5e7eb;background:#0b1020}body{margin:0;min-height:100vh;display:grid;place-items:center}\n')
  } else if (artifact.stack === 'go') {
    files.set('go.mod', `module ${name}\n\ngo 1.23\n`)
    files.set('cmd/server/main.go', `package main\n\nimport (\n  "encoding/json"\n  "log"\n  "net/http"\n  "os"\n)\n\nfunc main() {\n  port := os.Getenv("PORT")\n  if port == "" { port = "8080" }\n  http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {\n    w.Header().Set("Content-Type", "application/json")\n    _ = json.NewEncoder(w).Encode(map[string]string{"name": "${name}", "status": "ok"})\n  })\n  log.Fatal(http.ListenAndServe("127.0.0.1:"+port, nil))\n}\n`)
  } else if (artifact.stack === 'rust') {
    files.set('Cargo.toml', `[package]\nname = "${name.replace(/-/g, '_')}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\naxum = "0.7"\ntokio = { version = "1", features = ["macros", "rt-multi-thread"] }\n`)
    files.set('src/main.rs', `use axum::{routing::get, Json, Router};\nuse serde_json::{json, Value};\n\nasync fn health() -> Json<Value> { Json(json!({ "name": "${name}", "status": "ok" })) }\n\n#[tokio::main]\nasync fn main() {\n    let app = Router::new().route("/health", get(health));\n    let listener = tokio::net::TcpListener::bind("127.0.0.1:8000").await.unwrap();\n    axum::serve(listener, app).await.unwrap();\n}\n`)
    const cargo = files.get('Cargo.toml')!
    files.set('Cargo.toml', cargo.replace('tokio = ', 'serde_json = "1"\ntokio = '))
  }

  artifact.files = [...files.keys()]
  return files
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

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
  return { ...artifact, template: result.templateName, files: result.filesCreated, warnings: result.warnings }
}

export async function createProject(request: NewProjectRequest): Promise<ProjectArtifact> {
  const artifact = generateProjectArtifact(request)
  if (request.templateId) return createFromBuiltInTemplate(request, artifact)

  const files = projectFiles(artifact, request)
  const root = artifact.root
  const parent = path.dirname(root)
  await fs.mkdir(parent, { recursive: true })
  await fs.mkdir(root)

  try {
    for (const [relativePath, content] of files) {
      const target = path.resolve(root, relativePath)
      if (!isWithin(root, target) || target === root) throw new Error(`Dosya yolu proje kapsamı dışına çıkıyor: ${relativePath}`)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Proje kısmen oluşturuldu; mevcut dosyalar korunmuştur. Klasör: ${root}. Neden: ${reason}`)
  }

  return artifact
}
