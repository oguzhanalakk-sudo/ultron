export type ProjectStack = 'react' | 'vite' | 'node' | 'express' | 'python-fastapi' | 'electron' | 'next' | 'fullstack' | 'go' | 'rust'
export type ProjectTemplate = 'web-app' | 'api' | 'desktop' | 'dashboard' | 'fullstack'

export type ProjectSpec = {
  stack: ProjectStack
  template: ProjectTemplate
  framework: string
  description: string
  packageManager: 'npm' | 'pip' | 'none'
  installCommand: string
  buildCommand: string
  runCommand: string
  testCommand?: string
  entryFiles: string[]
  envExample: string
}

export const PROJECT_TEMPLATES: Record<ProjectStack, ProjectSpec> = {
  react: {
    stack: 'react',
    template: 'dashboard',
    framework: 'React + Vite',
    description: 'Modern React dashboard/app shell with Vite.',
    packageManager: 'npm',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    runCommand: 'npm run dev',
    testCommand: 'npm test',
    entryFiles: ['package.json', 'vite.config.ts', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/style.css'],
    envExample: 'VITE_APP_NAME=demo\nVITE_API_URL=http://localhost:3000',
  },
  vite: {
    stack: 'vite',
    template: 'web-app',
    framework: 'Vite app',
    description: 'Minimal Vite application scaffold.',
    packageManager: 'npm',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    runCommand: 'npm run dev',
    entryFiles: ['package.json', 'index.html', 'src/main.ts', 'src/style.css'],
    envExample: 'APP_NAME=demo\nPORT=5173',
  },
  express: {
    stack: 'express',
    template: 'api',
    framework: 'Node + Express',
    description: 'REST API with Express and a lightweight server shell.',
    packageManager: 'npm',
    installCommand: 'npm install',
    buildCommand: 'node --check server.js',
    runCommand: 'node server.js',
    testCommand: 'npm test',
    entryFiles: ['package.json', 'server.js', 'src/app.js'],
    envExample: 'PORT=3000\nHOST=127.0.0.1\nNODE_ENV=development\nALLOWED_ORIGIN=http://localhost:5173\nLOG_LEVEL=info',
  },
  node: {
    stack: 'node',
    template: 'api',
    framework: 'Node.js',
    description: 'Node.js command-line project.',
    packageManager: 'npm',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    runCommand: 'npm start',
    testCommand: 'npm test',
    entryFiles: ['package.json', 'src/index.js'],
    envExample: 'NODE_ENV=development\nLOG_LEVEL=info',
  },
  'python-fastapi': {
    stack: 'python-fastapi',
    template: 'api',
    framework: 'Python + FastAPI',
    description: 'Python API scaffold powered by FastAPI.',
    packageManager: 'pip',
    installCommand: 'python -m pip install -r requirements.txt',
    buildCommand: 'python -m compileall -q app tests',
    runCommand: 'uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload',
    testCommand: 'python -m pytest',
    entryFiles: ['requirements.txt', 'app/main.py'],
    envExample: 'APP_NAME=demo\nENVIRONMENT=development\nDEBUG=false\nDATABASE_URL=sqlite:///./app.db\nCORS_ORIGINS=http://localhost:3000\nLOG_LEVEL=INFO\nLOG_JSON=true',
  },
  electron: {
    stack: 'electron',
    template: 'desktop',
    framework: 'Electron desktop app',
    description: 'Desktop application shell using Electron and React.',
    packageManager: 'npm',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    runCommand: 'npm run dev',
    entryFiles: ['package.json', 'electron/main.ts', 'electron/preload.ts', 'src/App.tsx'],
    envExample: 'APP_NAME=demo',
  },
  next: {
    stack: 'next',
    template: 'web-app',
    framework: 'Next.js',
    description: 'Next.js application shell with app router.',
    packageManager: 'npm',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    runCommand: 'npm run dev',
    entryFiles: ['package.json', 'app/page.tsx', 'app/layout.tsx', 'next.config.mjs'],
    envExample: 'NEXT_PUBLIC_APP_NAME=demo',
  },
  fullstack: {
    stack: 'fullstack',
    template: 'fullstack',
    framework: 'Fullstack app',
    description: 'Fullstack monorepo scaffold with client and server.',
    packageManager: 'npm',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    runCommand: 'npm run dev',
    entryFiles: ['package.json', 'server/index.js', 'client/src/main.tsx'],
    envExample: 'PORT=3000\nJWT_SECRET=change-me',
  },
  go: {
    stack: 'go',
    template: 'api',
    framework: 'Go + Chi',
    description: 'Go HTTP API project.',
    packageManager: 'none',
    installCommand: 'go mod download',
    buildCommand: 'go build ./...',
    runCommand: 'go run ./cmd/server',
    testCommand: 'go test ./...',
    entryFiles: ['go.mod', 'cmd/server/main.go'],
    envExample: 'HOST=127.0.0.1\nPORT=8080\nLOG_LEVEL=info\nALLOWED_ORIGIN=http://localhost:3000',
  },
  rust: {
    stack: 'rust',
    template: 'api',
    framework: 'Rust + Axum',
    description: 'Rust HTTP API project.',
    packageManager: 'none',
    installCommand: 'cargo fetch',
    buildCommand: 'cargo check',
    runCommand: 'cargo run',
    testCommand: 'cargo test',
    entryFiles: ['Cargo.toml', 'src/main.rs'],
    envExample: 'HOST=127.0.0.1\nPORT=8000\nRUST_LOG=info',
  },
}

export function inferStackFromPrompt(prompt: string): ProjectStack {
  const lower = prompt.toLowerCase()
  const wantsClient = /\b(react|vite|frontend|dashboard|web app)\b/.test(lower)
  const wantsServer = /\b(express|api|backend|server|fastapi)\b/.test(lower)
  if (wantsClient && wantsServer) return 'fullstack'
  if (lower.includes('golang') || /\bgo api\b/.test(lower)) return 'go'
  if (lower.includes('rust') || lower.includes('axum')) return 'rust'
  if (lower.includes('next')) return 'next'
  if (lower.includes('electron') || lower.includes('desktop')) return 'electron'
  if (lower.includes('fastapi') || lower.includes('python')) return 'python-fastapi'
  if (lower.includes('express')) return 'express'
  if (lower.includes('api') || lower.includes('backend') || lower.includes('server')) return 'node'
  if (lower.includes('react') || lower.includes('dashboard') || lower.includes('frontend')) return 'react'
  if (lower.includes('vite')) return 'vite'
  return 'vite'
}

export function inferTemplateFromPrompt(prompt: string): ProjectTemplate {
  const lower = prompt.toLowerCase()
  if (lower.includes('fullstack') || lower.includes('frontend') && lower.includes('backend')) return 'fullstack'
  if (lower.includes('dashboard')) return 'dashboard'
  if (lower.includes('desktop') || lower.includes('electron')) return 'desktop'
  if (lower.includes('api') || lower.includes('server')) return 'api'
  return 'web-app'
}

export function buildProjectSpec(request: { stack?: ProjectStack; template?: ProjectTemplate; prompt?: string }): ProjectSpec {
  const stack = request.stack ?? inferStackFromPrompt(request.prompt ?? '')
  const template = request.template ?? inferTemplateFromPrompt(request.prompt ?? '')
  const base = PROJECT_TEMPLATES[stack]
  return {
    ...base,
    template,
  }
}
