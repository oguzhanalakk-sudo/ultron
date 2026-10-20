import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export type ProjectStack = 'react' | 'vite' | 'node' | 'express' | 'python-fastapi' | 'electron' | 'next' | 'fullstack'
export type ProjectTemplate = 'web-app' | 'api' | 'desktop' | 'dashboard' | 'fullstack'

export type NewProjectRequest = {
  name: string
  stack?: ProjectStack
  template?: ProjectTemplate
  targetDir?: string
  install?: boolean
  verify?: boolean
  prompt?: string
}

export type ProjectArtifact = {
  name: string
  root: string
  stack: ProjectStack
  template: ProjectTemplate
  files: string[]
  scripts: Record<string, string>
  envExample?: string
}

export function parseProjectRequest(input: string): NewProjectRequest {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('İstek boş.')

  const flags = new Map<string, string>()
  const args = trimmed.split(/\s+/)
  const name = args[0]

  for (let index = 1; index < args.length; index++) {
    const token = args[index]
    if (token.startsWith('--')) {
      const [key, value = 'true'] = token.slice(2).split('=')
      flags.set(key, value)
    }
  }

  const stack = (flags.get('stack') as ProjectStack | undefined) ?? inferStackFromPrompt(trimmed)
  const template = (flags.get('template') as ProjectTemplate | undefined) ?? inferTemplateFromPrompt(trimmed)
  const install = flags.get('install') === 'true' || flags.get('install') === '1'
  const verify = flags.get('verify') === 'true' || flags.get('verify') === '1'
  const targetDir = flags.get('dir') ?? path.join(process.cwd(), name)

  return {
    name,
    stack,
    template,
    targetDir,
    install,
    verify,
    prompt: trimmed,
  }
}

export function inferStackFromPrompt(prompt: string): ProjectStack {
  const lower = prompt.toLowerCase()
  if (lower.includes('react') || lower.includes('vite')) return 'react'
  if (lower.includes('electron')) return 'electron'
  if (lower.includes('next')) return 'next'
  if (lower.includes('fastapi') || lower.includes('python')) return 'python-fastapi'
  if (lower.includes('express') || lower.includes('node')) return 'express'
  return 'vite'
}

export function inferTemplateFromPrompt(prompt: string): ProjectTemplate {
  const lower = prompt.toLowerCase()
  if (lower.includes('dashboard')) return 'dashboard'
  if (lower.includes('desktop')) return 'desktop'
  if (lower.includes('api')) return 'api'
  if (lower.includes('fullstack') || lower.includes('frontend') && lower.includes('backend')) return 'fullstack'
  return 'web-app'
}

export function generateProjectArtifact(request: NewProjectRequest): ProjectArtifact {
  const stack = request.stack ?? 'vite'
  const template = request.template ?? 'web-app'
  const root = path.resolve(request.targetDir ?? path.join(process.cwd(), request.name))

  const baseScripts: Record<string, string> = {
    dev: 'npm run dev',
    build: 'npm run build',
    start: 'npm run start',
  }

  const artifacts: Record<ProjectStack, { scripts: Record<string, string>; envExample: string; files: string[] }> = {
    react: {
      scripts: {
        dev: 'vite',
        build: 'vite build',
        start: 'vite preview',
      },
      envExample: 'VITE_APP_NAME=demo\nVITE_API_URL=http://localhost:3000',
      files: ['package.json', 'vite.config.ts', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/index.css'],
    },
    vite: {
      scripts: {
        dev: 'vite',
        build: 'vite build',
        start: 'vite preview',
      },
      envExample: 'APP_NAME=demo\nPORT=5173',
      files: ['package.json', 'index.html', 'src/main.ts', 'src/style.css'],
    },
    express: {
      scripts: {
        dev: 'node --watch server.js',
        build: 'echo "No build step"',
        start: 'node server.js',
      },
      envExample: 'PORT=3000\nNODE_ENV=development',
      files: ['package.json', 'server.js'],
    },
    'python-fastapi': {
      scripts: {
        dev: 'uvicorn app:app --reload',
        build: 'python -m py_compile app.py',
        start: 'uvicorn app:app --host 0.0.0.0 --port 8000',
      },
      envExample: 'APP_NAME=demo\nPORT=8000',
      files: ['requirements.txt', 'app.py'],
    },
    electron: {
      scripts: {
        dev: 'electron-vite dev',
        build: 'electron-vite build',
        start: 'electron-vite preview',
      },
      envExample: 'APP_NAME=demo',
      files: ['package.json', 'electron/main.ts', 'electron/preload.ts', 'src/App.tsx'],
    },
    next: {
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
      },
      envExample: 'NEXT_PUBLIC_APP_NAME=demo',
      files: ['package.json', 'app/page.tsx', 'app/layout.tsx', 'next.config.js'],
    },
    fullstack: {
      scripts: {
        dev: 'concurrently "npm:dev:client" "npm:dev:server"',
        build: 'npm run build:client && npm run build:server',
        start: 'node server/index.js',
      },
      envExample: 'PORT=3000\nJWT_SECRET=change-me',
      files: ['package.json', 'server/index.js', 'client/src/main.tsx'],
    },
  }

  const preset = artifacts[stack]
  const scripts = { ...baseScripts, ...preset.scripts }
  const name = request.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]+/g, '') || 'ultron-app'

  return {
    name,
    root,
    stack,
    template,
    scripts,
    envExample: preset.envExample,
    files: preset.files,
  }
}

export async function createProject(request: NewProjectRequest): Promise<ProjectArtifact> {
  const artifact = generateProjectArtifact(request)
  const root = artifact.root
  await fs.mkdir(root, { recursive: true })

  const filesToWrite = new Map<string, string>()

  if (artifact.stack === 'react' || artifact.stack === 'vite') {
    filesToWrite.set('package.json', JSON.stringify({
      name: artifact.name,
      private: true,
      version: '1.0.0',
      type: 'module',
      scripts: artifact.scripts,
      dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' },
      devDependencies: { vite: '^5.4.10', '@vitejs/plugin-react': '^4.3.2', typescript: '^5.6.2', '@types/react': '^19.1.0', '@types/react-dom': '^19.1.0' },
    }, null, 2))

    filesToWrite.set('index.html', `<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${artifact.name}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`)

    filesToWrite.set('src/main.tsx', `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport './index.css'\nimport App from './App'\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n)\n`)

    filesToWrite.set('src/App.tsx', `export default function App() {\n  return (\n    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>\n      <h1>${artifact.name}</h1>\n      <p>Ultron tarafından oluşturulan örnek uygulama.</p>\n    </main>\n  )\n}\n`)

    filesToWrite.set('src/index.css', `:root { font-family: Inter, system-ui, sans-serif; color: #111827; background: #f8fafc; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; }\nmain { text-align: center; }\n`)

    filesToWrite.set('vite.config.ts', `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n`)
  }

  if (artifact.stack === 'express') {
    filesToWrite.set('package.json', JSON.stringify({
      name: artifact.name,
      version: '1.0.0',
      type: 'module',
      scripts: artifact.scripts,
      dependencies: { express: '^4.21.2' },
      devDependencies: { 'nodemon': '^3.1.7' },
    }, null, 2))

    filesToWrite.set('server.js', `import express from 'express'\n\nconst app = express()\nconst port = Number(process.env.PORT ?? 3000)\n\napp.get('/', (_, res) => {\n  res.json({ name: '${artifact.name}', status: 'ok' })\n})\n\napp.listen(port, () => {\n  console.log('Server started on http://localhost:' + port)\n})\n`)
  }

  if (artifact.stack === 'python-fastapi') {
    filesToWrite.set('requirements.txt', 'fastapi\nuvicorn\n')
    filesToWrite.set('app.py', `from fastapi import FastAPI\n\napp = FastAPI(title='${artifact.name}')\n\n@app.get('/')\ndef root():\n    return {'name': '${artifact.name}', 'status': 'ok'}\n`)
  }

  if (artifact.stack === 'next') {
    filesToWrite.set('package.json', JSON.stringify({
      name: artifact.name,
      private: true,
      scripts: artifact.scripts,
      dependencies: { next: '^14.2.15', react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: { typescript: '^5.6.2', '@types/node': '^20.16.0', '@types/react': '^18.3.5', '@types/react-dom': '^18.3.0' },
    }, null, 2))
    filesToWrite.set('app/layout.tsx', `export const metadata = { title: '${artifact.name}' }\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>\n}\n`)
    filesToWrite.set('app/page.tsx', `export default function Page() { return <main><h1>${artifact.name}</h1></main> }\n`)
    filesToWrite.set('next.config.js', `/** @type {import('next').NextConfig} */\nconst nextConfig = { reactStrictMode: true }\nmodule.exports = nextConfig\n`)
  }

  if (artifact.stack === 'electron') {
    filesToWrite.set('package.json', JSON.stringify({
      name: artifact.name,
      version: '1.0.0',
      type: 'module',
      scripts: artifact.scripts,
      dependencies: { electron: '^32.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: { 'electron-vite': '^2.0.0', typescript: '^5.6.2', '@types/react': '^19.1.0', '@types/react-dom': '^19.1.0' },
    }, null, 2))
    filesToWrite.set('electron/main.ts', `import { app, BrowserWindow } from 'electron'\n\nfunction createWindow() {\n  const win = new BrowserWindow({ width: 1200, height: 800 })\n  win.loadURL('http://localhost:5173')\n}\n\napp.whenReady().then(() => createWindow())\n`)
    filesToWrite.set('electron/preload.ts', `const api = {}\nObject.defineProperty(window, 'api', { value: api })\n`)
    filesToWrite.set('src/App.tsx', `export default function App() { return <h1>${artifact.name}</h1> }\n`)
  }

  if (artifact.template === 'dashboard' || artifact.template === 'fullstack') {
    filesToWrite.set('.env.example', artifact.envExample ?? '')
    filesToWrite.set('README.md', `# ${artifact.name}\n\nUltron tarafından oluşturulan örnek proje.\n`)
  }

  for (const [relativePath, content] of filesToWrite) {
    const resolved = path.join(root, relativePath)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, content, 'utf8')
  }

  if (artifact.stack === 'react' || artifact.stack === 'vite' || artifact.stack === 'next' || artifact.stack === 'electron' || artifact.stack === 'fullstack') {
    await fs.writeFile(path.join(root, '.gitignore'), ['node_modules', 'dist', '.next', 'out', '.env', '.env.local'].join('\n') + '\n', 'utf8')
  }

  return artifact
}

export async function verifyProjectCreation(root: string): Promise<{ ok: boolean; output: string[] }> {
  const output: string[] = []
  const entries = await fs.readdir(root, { withFileTypes: true })
  output.push(`entries=${entries.length}`)

  for (const entry of entries) {
    if (entry.isDirectory()) {
      output.push(`dir:${entry.name}`)
    } else {
      output.push(`file:${entry.name}`)
    }
  }

  const hasPkg = await fs.stat(path.join(root, 'package.json')).then(() => true).catch(() => false)
  return { ok: hasPkg, output }
}

export async function autoGenerateProjectFromPrompt(input: string): Promise<ProjectArtifact> {
  const request = parseProjectRequest(input)
  const artifact = await createProject(request)
  return artifact
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const input = argv.join(' ')
  const artifact = await autoGenerateProjectFromPrompt(input || 'ultron-demo --stack react --template dashboard')
  console.log(JSON.stringify({ name: artifact.name, root: artifact.root, stack: artifact.stack, template: artifact.template, files: artifact.files }, null, 2))
}
