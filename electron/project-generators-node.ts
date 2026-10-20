// Node tabanlı yığınlar (Express, Node CLI, Electron, fullstack) için gömülü üreticiler.
import { draft, jsonFile, packageManifest, readme, safeText, VITE_HTML, type DraftFile, type GeneratorContext } from './project-generator-kit.ts'
import { NODE_GITIGNORE, REACT_DEPS, REACT_DEV_DEPS, REACT_MAIN } from './project-generators-frontend.ts'

const JSON_HEADERS = "{ 'Content-Type': 'application/json' }"

export function expressFiles(context: GeneratorContext): DraftFile[] {
  const title = safeText(context.name, 60)
  return [
    draft('package.json', 'Bağımlılıklar ve betikler', packageManifest(context.name, {
      scripts: { dev: 'node --watch server.js', build: 'node --check server.js', start: 'node server.js', test: 'node --test' },
      dependencies: { express: '^5.1.0' },
    })),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', NODE_GITIGNORE),
    draft('.env.example', 'Ortam değişkenleri örneği', 'PORT=3000\nHOST=127.0.0.1\nNODE_ENV=development\nALLOWED_ORIGIN=http://localhost:5173\nLOG_LEVEL=info'),
    draft('server.js', 'Sunucu giriş noktası: dinleme ve düzgün kapanış', "import { createApp } from './src/app.js'\nimport { loadConfig } from './src/config.js'\nimport { logger } from './src/logger.js'\n\nconst config = loadConfig()\nconst server = createApp(config).listen(config.port, config.host, () => {\n  logger.info('server started', { host: config.host, port: config.port })\n})\n\nfor (const signal of ['SIGINT', 'SIGTERM']) {\n  process.on(signal, () => {\n    logger.info('shutting down', { signal })\n    server.close(() => process.exit(0))\n  })\n}"),
    draft('src/config.js', 'Doğrulanmış ortam yapılandırması', `export function loadConfig(env = process.env) {\n  const port = Number(env.PORT ?? 3000)\n  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT geçerli bir port numarası olmalı')\n  return {\n    port,\n    host: env.HOST ?? '127.0.0.1',\n    allowedOrigin: env.ALLOWED_ORIGIN ?? 'http://localhost:5173',\n    appName: '${title}',\n  }\n}`),
    draft('src/logger.js', 'Yapılandırılmış (JSON) günlük kaydı', "const LEVELS = ['debug', 'info', 'warn', 'error']\nconst threshold = Math.max(0, LEVELS.indexOf(process.env.LOG_LEVEL ?? 'info'))\n\nfunction write(level, message, context = {}) {\n  if (LEVELS.indexOf(level) < threshold) return\n  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...context })\n  ;(level === 'error' ? process.stderr : process.stdout).write(line + '\\n')\n}\n\nexport const logger = {\n  debug: (message, context) => write('debug', message, context),\n  info: (message, context) => write('info', message, context),\n  warn: (message, context) => write('warn', message, context),\n  error: (message, context) => write('error', message, context),\n}"),
    draft('src/app.js', 'Express uygulama fabrikası: güvenlik başlıkları, CORS ve yönlendirme', "import express from 'express'\nimport { errorHandler, notFoundHandler } from './middleware/error-handler.js'\nimport { itemsRouter } from './routes/items.js'\n\nexport function createApp(config) {\n  const app = express()\n  app.disable('x-powered-by')\n  app.use(express.json({ limit: '100kb' }))\n  app.use((request, response, next) => {\n    response.setHeader('X-Content-Type-Options', 'nosniff')\n    const origin = request.headers.origin\n    if (origin && origin === config.allowedOrigin) {\n      response.setHeader('Access-Control-Allow-Origin', origin)\n      response.setHeader('Access-Control-Allow-Methods', 'GET, POST')\n      response.setHeader('Access-Control-Allow-Headers', 'Content-Type')\n      response.setHeader('Vary', 'Origin')\n    }\n    if (request.method === 'OPTIONS') return response.sendStatus(204)\n    next()\n  })\n  app.get('/health', (_request, response) => response.json({ name: config.appName, status: 'ok' }))\n  app.use('/api/items', itemsRouter())\n  app.use(notFoundHandler)\n  app.use(errorHandler)\n  return app\n}"),
    draft('src/routes/items.js', 'Girdi doğrulamalı item uç noktaları', "import { Router } from 'express'\nimport { HttpError } from '../middleware/error-handler.js'\n\nexport function itemsRouter() {\n  const router = Router()\n  const items = []\n\n  router.get('/', (_request, response) => response.json(items))\n\n  router.post('/', (request, response) => {\n    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''\n    if (!name || name.length > 120) throw new HttpError(422, 'validation_error', 'name 1-120 karakter olmalı')\n    const item = { id: items.length + 1, name }\n    items.push(item)\n    response.status(201).json(item)\n  })\n\n  router.get('/:id', (request, response) => {\n    const item = items.find((candidate) => candidate.id === Number(request.params.id))\n    if (!item) throw new HttpError(404, 'not_found', 'item bulunamadı')\n    response.json(item)\n  })\n\n  return router\n}"),
    draft('src/middleware/error-handler.js', 'Merkezi hata yönetimi', "import { logger } from '../logger.js'\n\nexport class HttpError extends Error {\n  constructor(status, code, message) {\n    super(message)\n    this.status = status\n    this.code = code\n  }\n}\n\nexport function notFoundHandler(_request, _response, next) {\n  next(new HttpError(404, 'not_found', 'kaynak bulunamadı'))\n}\n\nexport function errorHandler(error, _request, response, _next) {\n  if (error instanceof HttpError) return response.status(error.status).json({ error: { code: error.code, message: error.message } })\n  if (error?.type === 'entity.parse.failed') return response.status(400).json({ error: { code: 'invalid_json', message: 'geçersiz JSON' } })\n  logger.error('unhandled error', { message: error?.message })\n  return response.status(500).json({ error: { code: 'internal_error', message: 'sunucu hatası' } })\n}"),
    draft('test/app.test.js', 'API uç noktaları için node:test testleri', `import assert from 'node:assert/strict'\nimport test from 'node:test'\nimport { createApp } from '../src/app.js'\n\nasync function withServer(run) {\n  const server = createApp({ allowedOrigin: 'http://localhost:5173', appName: 'test' }).listen(0, '127.0.0.1')\n  await new Promise((resolve) => server.once('listening', resolve))\n  try {\n    await run('http://127.0.0.1:' + server.address().port)\n  } finally {\n    await new Promise((resolve) => server.close(resolve))\n  }\n}\n\ntest('health döner', () => withServer(async (base) => {\n  const response = await fetch(base + '/health')\n  assert.equal(response.status, 200)\n  assert.equal((await response.json()).status, 'ok')\n}))\n\ntest('geçersiz item reddedilir', () => withServer(async (base) => {\n  const response = await fetch(base + '/api/items', { method: 'POST', headers: ${JSON_HEADERS}, body: JSON.stringify({ name: '  ' }) })\n  assert.equal(response.status, 422)\n}))\n\ntest('item oluşturulur ve okunur', () => withServer(async (base) => {\n  const created = await fetch(base + '/api/items', { method: 'POST', headers: ${JSON_HEADERS}, body: JSON.stringify({ name: 'ilk' }) })\n  assert.equal(created.status, 201)\n  const fetched = await fetch(base + '/api/items/1')\n  assert.equal((await fetched.json()).name, 'ilk')\n}))`),
    draft('README.md', 'Kurulum, çalıştırma ve test yönergeleri', readme(context, 'Node + Express REST API', [
      ['Kurulum', '```bash\nnpm install\n```'],
      ['Çalıştırma', '```bash\nnpm start\n```'],
      ['Test', '```bash\nnpm test\n```'],
      ['Güvenlik notları', 'Sunucu varsayılan olarak yalnızca `127.0.0.1` üzerinde dinler, CORS yalnızca `ALLOWED_ORIGIN` için açıktır, gövde boyutu sınırlıdır ve girdiler doğrulanır.'],
    ])),
  ]
}

export function nodeFiles(context: GeneratorContext): DraftFile[] {
  const title = safeText(context.name, 60)
  return [
    draft('package.json', 'Bağımlılıklar ve betikler', packageManifest(context.name, {
      scripts: { start: 'node src/index.js', dev: 'node --watch src/index.js', build: 'node --check src/index.js', test: 'node --test' },
    })),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', NODE_GITIGNORE),
    draft('.env.example', 'Ortam değişkenleri örneği', 'NODE_ENV=development\nLOG_LEVEL=info'),
    draft('src/index.js', 'Komut satırı giriş noktası', "import { loadConfig } from './config.js'\nimport { greet } from './commands/greet.js'\nimport { logger } from './logger.js'\n\ntry {\n  const config = loadConfig()\n  const name = process.argv[2]\n  logger.info('command started', { app: config.appName })\n  console.log(greet(name, config.appName))\n} catch (error) {\n  logger.error('command failed', { message: error instanceof Error ? error.message : String(error) })\n  process.exitCode = 1\n}"),
    draft('src/config.js', 'Yapılandırma', `export function loadConfig(env = process.env) {\n  return { appName: '${title}', logLevel: env.LOG_LEVEL ?? 'info' }\n}`),
    draft('src/logger.js', 'Yapılandırılmış (JSON) günlük kaydı', "function write(level, message, context = {}) {\n  process.stderr.write(JSON.stringify({ time: new Date().toISOString(), level, message, ...context }) + '\\n')\n}\n\nexport const logger = {\n  info: (message, context) => write('info', message, context),\n  error: (message, context) => write('error', message, context),\n}"),
    draft('src/commands/greet.js', 'Örnek komut mantığı (girdi doğrulamalı)', "export function greet(name, appName) {\n  const value = (name ?? 'dünya').trim()\n  if (!value || value.length > 80) throw new Error('İsim 1-80 karakter olmalı')\n  return 'Merhaba ' + value + ' — ' + appName\n}"),
    draft('test/greet.test.js', 'greet için birim testleri', "import assert from 'node:assert/strict'\nimport test from 'node:test'\nimport { greet } from '../src/commands/greet.js'\n\ntest('varsayılan isimle selamlar', () => {\n  assert.match(greet(undefined, 'app'), /dünya/)\n})\n\ntest('aşırı uzun isim reddedilir', () => {\n  assert.throws(() => greet('x'.repeat(81), 'app'), /1-80/)\n})"),
    draft('README.md', 'Kurulum, çalıştırma ve test yönergeleri', readme(context, 'Node.js (ESM)', [
      ['Çalıştırma', '```bash\nnpm start -- Ada\n```'],
      ['Test', '```bash\nnpm test\n```'],
    ])),
  ]
}

export function electronFiles(context: GeneratorContext): DraftFile[] {
  const title = safeText(context.name, 60)
  const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'\" />"
  return [
    draft('package.json', 'Bağımlılıklar ve betikler', packageManifest(context.name, {
      module: false,
      extra: { main: './out/main/main.js' },
      scripts: { dev: 'electron-vite dev', build: 'tsc --noEmit && electron-vite build', start: 'electron-vite preview' },
      dependencies: REACT_DEPS,
      devDependencies: { ...REACT_DEV_DEPS, electron: '^35.0.0', 'electron-vite': '^3.0.0', '@types/node': '^22.0.0' },
    })),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', NODE_GITIGNORE),
    draft('.env.example', 'Ortam değişkenleri örneği', `APP_NAME=${title}`),
    draft('electron.vite.config.ts', 'electron-vite yapılandırması (main/preload/renderer girişleri)', "import react from '@vitejs/plugin-react'\nimport { defineConfig, externalizeDepsPlugin } from 'electron-vite'\nimport { resolve } from 'node:path'\n\nexport default defineConfig({\n  main: {\n    plugins: [externalizeDepsPlugin()],\n    build: { rollupOptions: { input: { main: resolve(__dirname, 'electron/main.ts') } } },\n  },\n  preload: {\n    plugins: [externalizeDepsPlugin()],\n    build: { rollupOptions: { input: { preload: resolve(__dirname, 'electron/preload.ts') } } },\n  },\n  renderer: {\n    root: '.',\n    plugins: [react()],\n    build: { rollupOptions: { input: { index: resolve(__dirname, 'index.html') } } },\n  },\n})"),
    draft('tsconfig.json', 'TypeScript (strict) yapılandırması', jsonFile({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', skipLibCheck: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx', strict: true, types: ['node'] }, include: ['electron', 'src', 'electron.vite.config.ts'] })),
    draft('electron/main.ts', 'Ana süreç: güvenli pencere (contextIsolation, sandbox, nodeIntegration kapalı)', "import { app, BrowserWindow, shell } from 'electron'\nimport path from 'node:path'\n\nfunction createWindow(): void {\n  const window = new BrowserWindow({\n    width: 1200,\n    height: 800,\n    webPreferences: {\n      preload: path.join(__dirname, '../preload/preload.js'),\n      contextIsolation: true,\n      nodeIntegration: false,\n      sandbox: true,\n    },\n  })\n\n  window.webContents.setWindowOpenHandler(({ url }) => {\n    if (/^https:\\/\\//.test(url)) void shell.openExternal(url)\n    return { action: 'deny' }\n  })\n  window.webContents.on('will-navigate', (event) => event.preventDefault())\n\n  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)\n  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))\n}\n\napp.whenReady().then(createWindow)\napp.on('window-all-closed', () => {\n  if (process.platform !== 'darwin') app.quit()\n})"),
    draft('electron/preload.ts', 'Preload: renderer’a yalnızca dondurulmuş, minimal API açar', "import { contextBridge } from 'electron'\n\ncontextBridge.exposeInMainWorld('appInfo', Object.freeze({ platform: process.platform }))"),
    draft('index.html', 'Renderer giriş sayfası (CSP ile)', VITE_HTML(title, '/src/main.tsx').replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${csp}`)),
    draft('src/env.d.ts', 'Preload API tipleri', 'export {}\n\ndeclare global {\n  interface Window {\n    appInfo: { readonly platform: string }\n  }\n}'),
    draft('src/main.tsx', 'Renderer giriş noktası', REACT_MAIN),
    draft('src/App.tsx', 'Ana arayüz', `export default function App() {\n  return (\n    <main>\n      <h1>${title}</h1>\n      <p>${safeText(context.description, 160)}</p>\n      <p>Platform: {window.appInfo.platform}</p>\n    </main>\n  )\n}`),
    draft('src/style.css', 'Genel stiller', ':root{font-family:system-ui,sans-serif;color:#e5e7eb;background:#0b1020}body{margin:0;min-height:100vh;display:grid;place-items:center}'),
    draft('README.md', 'Kurulum ve çalıştırma yönergeleri', readme(context, 'Electron + React + TypeScript', [
      ['Kurulum', '```bash\nnpm install\n```'],
      ['Çalıştırma', '```bash\nnpm run dev\n```'],
      ['Derleme', '```bash\nnpm run build\n```'],
      ['Güvenlik', 'Pencere `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` ile oluşturulur; renderer yalnızca preload’daki dondurulmuş API’ye erişir.'],
    ])),
  ]
}

export function fullstackFiles(context: GeneratorContext): DraftFile[] {
  const title = safeText(context.name, 60)
  return [
    draft('package.json', 'Çalışma alanı kökü: betikler ve sunucu bağımlılıkları', packageManifest(context.name, {
      extra: { workspaces: ['client'] },
      scripts: {
        dev: 'concurrently -k "npm:dev:server" "npm:dev:client"',
        'dev:server': 'node --watch server/index.js',
        'dev:client': 'npm --workspace client run dev',
        build: 'npm --workspace client run build && node --check server/index.js',
        start: 'node server/index.js',
      },
      dependencies: { concurrently: '^9.1.0', express: '^5.1.0' },
    })),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', NODE_GITIGNORE),
    draft('.env.example', 'Ortam değişkenleri örneği', 'PORT=3000\nHOST=127.0.0.1'),
    draft('server/index.js', 'Express API sunucusu', "import express from 'express'\n\nconst app = express()\napp.disable('x-powered-by')\nconst port = Number(process.env.PORT ?? 3000)\nconst host = process.env.HOST ?? '127.0.0.1'\n\napp.get('/api/health', (_request, response) => response.json({ status: 'ok' }))\n\napp.listen(port, host, () => console.log(JSON.stringify({ level: 'info', message: 'API listening', host, port })))"),
    draft('client/package.json', 'İstemci bağımlılıkları ve betikleri', packageManifest(`${context.name}-client`, {
      scripts: { dev: 'vite', build: 'vite build', start: 'vite preview' },
      dependencies: REACT_DEPS,
      devDependencies: REACT_DEV_DEPS,
    })),
    draft('client/index.html', 'İstemci giriş sayfası', VITE_HTML(title, '/src/main.tsx')),
    draft('client/vite.config.ts', 'Vite yapılandırması (API için yerel proxy)', "import react from '@vitejs/plugin-react'\nimport { defineConfig } from 'vite'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },\n})"),
    draft('client/src/main.tsx', 'İstemci giriş noktası', REACT_MAIN),
    draft('client/src/App.tsx', 'İstemci ana ekranı: API sağlık durumunu gösterir', `import { useEffect, useState } from 'react'\n\nexport default function App() {\n  const [status, setStatus] = useState('yükleniyor')\n  useEffect(() => {\n    fetch('/api/health')\n      .then((response) => response.json())\n      .then((body: { status: string }) => setStatus(body.status))\n      .catch(() => setStatus('ulaşılamıyor'))\n  }, [])\n  return (\n    <main>\n      <h1>${title}</h1>\n      <p>API durumu: {status}</p>\n    </main>\n  )\n}`),
    draft('client/src/style.css', 'Genel stiller', ':root{font-family:system-ui,sans-serif;color:#e5e7eb;background:#0b1020}body{margin:0;min-height:100vh;display:grid;place-items:center}'),
    draft('README.md', 'Kurulum ve çalıştırma yönergeleri', readme(context, 'Fullstack (React + Express)', [
      ['Kurulum', '```bash\nnpm install\n```'],
      ['Çalıştırma', '```bash\nnpm run dev\n```'],
      ['Derleme', '```bash\nnpm run build\n```'],
    ])),
  ]
}
