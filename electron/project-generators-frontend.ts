// Arayüz yığınları (React/Vite, Vite, Next.js) için gömülü, çok dosyalı proje üreticileri.
import { draft, jsonFile, packageManifest, readme, safeText, VITE_HTML, type DraftFile, type GeneratorContext } from './project-generator-kit.ts'

export const NODE_GITIGNORE = 'node_modules/\ndist/\n.next/\nout/\ncoverage/\n.env\n.env.*\n!.env.example\n*.log\n.DS_Store'

export const REACT_DEPS = { react: '^19.1.0', 'react-dom': '^19.1.0' }
export const REACT_DEV_DEPS = { vite: '^6.0.0', '@vitejs/plugin-react': '^4.3.4', typescript: '^5.7.3', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' }

export const REACT_MAIN = "import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './style.css'\n\nconst container = document.getElementById('root')\nif (!container) throw new Error('#root elementi bulunamadı')\ncreateRoot(container).render(<React.StrictMode><App /></React.StrictMode>)"

const viteTsconfig = (include: string[]): string => jsonFile({
  compilerOptions: {
    target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true,
    moduleResolution: 'Bundler', allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx', strict: true,
  },
  include,
})

const REACT_STYLE = ':root{font-family:Inter,system-ui,sans-serif;color:#e5e7eb;background:#0b1020}*{box-sizing:border-box}body{margin:0;min-height:100vh}.shell{width:min(720px,92vw);margin:10vh auto;display:grid;gap:1.25rem}.eyebrow{color:#60a5fa;letter-spacing:.16em;font-size:.75rem;font-weight:700}h1{margin:.2rem 0;font-size:clamp(2rem,6vw,3.5rem)}p{color:#aab4c5;line-height:1.6}.card{padding:1.25rem;border:1px solid #334155;border-radius:1rem;background:#111a2e}form{display:flex;gap:.5rem}input{padding:.6rem .8rem;border-radius:.6rem;border:1px solid #334155;background:#0b1020;color:inherit}form input{flex:1}button{padding:.6rem 1rem;border:0;border-radius:.6rem;background:#2563eb;color:#fff;cursor:pointer}ul{list-style:none;margin:1rem 0 0;padding:0;display:grid;gap:.5rem}li{display:flex;align-items:center;justify-content:space-between;gap:.75rem}.done span{text-decoration:line-through;color:#64748b}'

export function reactFiles(context: GeneratorContext): DraftFile[] {
  const title = safeText(context.name, 60)
  return [
    draft('package.json', 'Bağımlılıklar ve betikler', packageManifest(context.name, {
      scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', start: 'vite preview', test: 'vitest run' },
      dependencies: REACT_DEPS,
      devDependencies: { ...REACT_DEV_DEPS, vitest: '^3.0.0' },
    })),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', NODE_GITIGNORE),
    draft('.env.example', 'Ortam değişkenleri örneği', `VITE_APP_NAME=${title}\nVITE_API_URL=http://localhost:3000`),
    draft('index.html', 'Vite giriş sayfası', VITE_HTML(title, '/src/main.tsx')),
    draft('vite.config.ts', 'Vite ve Vitest yapılandırması', "import react from '@vitejs/plugin-react'\nimport { defineConfig } from 'vitest/config'\n\nexport default defineConfig({\n  plugins: [react()],\n  test: { environment: 'node' },\n})"),
    draft('tsconfig.json', 'TypeScript (strict) yapılandırması', viteTsconfig(['src', 'vite.config.ts'])),
    draft('src/vite-env.d.ts', 'Vite istemci tipleri', '/// <reference types="vite/client" />'),
    draft('src/main.tsx', 'React giriş noktası', REACT_MAIN),
    draft('src/App.tsx', 'Ana ekran: başlık, form ve liste bileşenlerini birleştirir', `import Header from './components/Header'\nimport TaskForm from './components/TaskForm'\nimport TaskList from './components/TaskList'\nimport { useTasks } from './hooks/useTasks'\n\nexport default function App() {\n  const { tasks, add, toggle, remove } = useTasks()\n  return (\n    <main className="shell">\n      <Header title="${title}" subtitle="${safeText(context.description, 160)}" />\n      <section className="card">\n        <TaskForm onAdd={add} />\n        <TaskList tasks={tasks} onToggle={toggle} onRemove={remove} />\n      </section>\n    </main>\n  )\n}`),
    draft('src/types.ts', 'Paylaşılan tipler', 'export type Task = {\n  id: string\n  title: string\n  done: boolean\n}'),
    draft('src/components/Header.tsx', 'Başlık bileşeni', "type HeaderProps = { title: string; subtitle: string }\n\nexport default function Header({ title, subtitle }: HeaderProps) {\n  return (\n    <header>\n      <p className=\"eyebrow\">ULTRON PROJECT</p>\n      <h1>{title}</h1>\n      <p>{subtitle}</p>\n    </header>\n  )\n}"),
    draft('src/components/TaskForm.tsx', 'Doğrulamalı görev ekleme formu', "import { useState, type FormEvent } from 'react'\nimport { normalizeTitle } from '../lib/tasks'\n\ntype TaskFormProps = { onAdd: (title: string) => void }\n\nexport default function TaskForm({ onAdd }: TaskFormProps) {\n  const [value, setValue] = useState('')\n\n  function submit(event: FormEvent) {\n    event.preventDefault()\n    const title = normalizeTitle(value)\n    if (!title) return\n    onAdd(title)\n    setValue('')\n  }\n\n  return (\n    <form onSubmit={submit}>\n      <input value={value} onChange={(event) => setValue(event.target.value)} placeholder=\"Yeni görev\" maxLength={120} aria-label=\"Yeni görev\" />\n      <button type=\"submit\">Ekle</button>\n    </form>\n  )\n}"),
    draft('src/components/TaskList.tsx', 'Görev listesi bileşeni', "import type { Task } from '../types'\n\ntype TaskListProps = {\n  tasks: Task[]\n  onToggle: (id: string) => void\n  onRemove: (id: string) => void\n}\n\nexport default function TaskList({ tasks, onToggle, onRemove }: TaskListProps) {\n  if (!tasks.length) return <p>Henüz görev yok.</p>\n  return (\n    <ul>\n      {tasks.map((task) => (\n        <li key={task.id} className={task.done ? 'done' : ''}>\n          <label>\n            <input type=\"checkbox\" checked={task.done} onChange={() => onToggle(task.id)} /> <span>{task.title}</span>\n          </label>\n          <button type=\"button\" onClick={() => onRemove(task.id)} aria-label=\"Görevi sil\">Sil</button>\n        </li>\n      ))}\n    </ul>\n  )\n}"),
    draft('src/hooks/useTasks.ts', 'Görev durumunu yöneten kanca', "import { useCallback, useEffect, useState } from 'react'\nimport { addTask, removeTask, toggleTask } from '../lib/tasks'\nimport { loadTasks, saveTasks } from '../lib/storage'\nimport type { Task } from '../types'\n\nexport function useTasks() {\n  const [tasks, setTasks] = useState<Task[]>(() => loadTasks())\n\n  useEffect(() => {\n    saveTasks(tasks)\n  }, [tasks])\n\n  const add = useCallback((title: string) => setTasks((current) => addTask(current, title)), [])\n  const toggle = useCallback((id: string) => setTasks((current) => toggleTask(current, id)), [])\n  const remove = useCallback((id: string) => setTasks((current) => removeTask(current, id)), [])\n\n  return { tasks, add, toggle, remove }\n}"),
    draft('src/lib/tasks.ts', 'Saf görev işlevleri (test edilebilir)', "import type { Task } from '../types'\n\nexport function normalizeTitle(value: string): string {\n  return value.replace(/\\s+/g, ' ').trim().slice(0, 120)\n}\n\nexport function addTask(tasks: Task[], title: string, id: string = crypto.randomUUID()): Task[] {\n  const normalized = normalizeTitle(title)\n  if (!normalized) return tasks\n  return [...tasks, { id, title: normalized, done: false }]\n}\n\nexport function toggleTask(tasks: Task[], id: string): Task[] {\n  return tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task))\n}\n\nexport function removeTask(tasks: Task[], id: string): Task[] {\n  return tasks.filter((task) => task.id !== id)\n}"),
    draft('src/lib/storage.ts', 'Doğrulamalı localStorage erişimi', "import type { Task } from '../types'\n\nconst KEY = 'tasks'\n\nfunction isTask(value: unknown): value is Task {\n  if (!value || typeof value !== 'object') return false\n  const task = value as Record<string, unknown>\n  return typeof task.id === 'string' && typeof task.title === 'string' && typeof task.done === 'boolean'\n}\n\nexport function loadTasks(): Task[] {\n  try {\n    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')\n    return Array.isArray(parsed) ? parsed.filter(isTask) : []\n  } catch {\n    return []\n  }\n}\n\nexport function saveTasks(tasks: Task[]): void {\n  try {\n    localStorage.setItem(KEY, JSON.stringify(tasks))\n  } catch (error) {\n    console.warn('Görevler kaydedilemedi', error)\n  }\n}"),
    draft('src/lib/tasks.test.ts', 'Görev işlevleri için birim testleri', "import { describe, expect, it } from 'vitest'\nimport { addTask, normalizeTitle, removeTask, toggleTask } from './tasks'\n\ndescribe('tasks', () => {\n  it('boş başlıkları yok sayar', () => {\n    expect(addTask([], '   ', 'a')).toEqual([])\n    expect(normalizeTitle('  a   b ')).toBe('a b')\n  })\n\n  it('ekler, işaretler ve siler', () => {\n    const added = addTask([], 'Yaz', 'a')\n    expect(added).toEqual([{ id: 'a', title: 'Yaz', done: false }])\n    expect(toggleTask(added, 'a')[0].done).toBe(true)\n    expect(removeTask(added, 'a')).toEqual([])\n  })\n})"),
    draft('src/style.css', 'Genel stiller', REACT_STYLE),
    draft('README.md', 'Kurulum, çalıştırma ve test yönergeleri', readme(context, 'React + Vite + TypeScript', [
      ['Kurulum', '```bash\nnpm install\n```'],
      ['Çalıştırma', '```bash\nnpm run dev\n```'],
      ['Derleme ve test', '```bash\nnpm run build\nnpm test\n```'],
      ['Yapı', '`src/components` arayüz bileşenleri, `src/hooks` durum yönetimi, `src/lib` saf işlevler ve depolama, `src/types.ts` ortak tipler.'],
    ])),
  ]
}

export function viteFiles(context: GeneratorContext): DraftFile[] {
  const title = safeText(context.name, 60)
  return [
    draft('package.json', 'Bağımlılıklar ve betikler', packageManifest(context.name, {
      scripts: { dev: 'vite', build: 'vite build', start: 'vite preview' },
      devDependencies: { vite: '^6.0.0', typescript: '^5.7.3' },
    })),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', NODE_GITIGNORE),
    draft('.env.example', 'Ortam değişkenleri örneği', `APP_NAME=${title}\nPORT=5173`),
    draft('index.html', 'Vite giriş sayfası', VITE_HTML(title, '/src/main.ts', `<main><h1>${title}</h1><p>${safeText(context.description, 160)}</p></main>`)),
    draft('src/main.ts', 'Uygulama giriş noktası', "import './style.css'\n\nconsole.info('Vite uygulaması hazır')"),
    draft('src/style.css', 'Genel stiller', ':root{font-family:system-ui,sans-serif;color:#e5e7eb;background:#0b1020}body{margin:0;min-height:100vh;display:grid;place-items:center}'),
    draft('README.md', 'Kurulum ve çalıştırma yönergeleri', readme(context, 'Vite', [
      ['Kurulum', '```bash\nnpm install\n```'],
      ['Çalıştırma', '```bash\nnpm run dev\n```'],
      ['Derleme', '```bash\nnpm run build\n```'],
    ])),
  ]
}

export function nextFiles(context: GeneratorContext): DraftFile[] {
  const title = safeText(context.name, 60)
  const description = safeText(context.description, 160)
  return [
    draft('package.json', 'Bağımlılıklar ve betikler', packageManifest(context.name, {
      scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
      dependencies: { next: '^15.1.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: { typescript: '^5.7.3', '@types/node': '^22.0.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' },
    })),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', `${NODE_GITIGNORE}\nnext-env.d.ts`),
    draft('.env.example', 'Ortam değişkenleri örneği', `NEXT_PUBLIC_APP_NAME=${title}`),
    draft('tsconfig.json', 'TypeScript (strict) yapılandırması', jsonFile({ compilerOptions: { target: 'ES2017', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true, jsx: 'preserve', incremental: true, plugins: [{ name: 'next' }] }, include: ['next-env.d.ts', '.next/types/**/*.ts', '**/*.ts', '**/*.tsx'], exclude: ['node_modules'] })),
    draft('next.config.mjs', 'Next yapılandırması ve güvenlik başlıkları', "const securityHeaders = [\n  { key: 'X-Content-Type-Options', value: 'nosniff' },\n  { key: 'X-Frame-Options', value: 'DENY' },\n  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },\n]\n\nconst nextConfig = {\n  reactStrictMode: true,\n  poweredByHeader: false,\n  async headers() {\n    return [{ source: '/:path*', headers: securityHeaders }]\n  },\n}\n\nexport default nextConfig"),
    draft('lib/site.ts', 'Paylaşılan site bilgisi', `export const site = {\n  name: '${title}',\n  description: '${description}',\n} as const`),
    draft('app/layout.tsx', 'Kök yerleşim', "import type { ReactNode } from 'react'\nimport { site } from '../lib/site'\nimport './globals.css'\n\nexport const metadata = { title: site.name, description: site.description }\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang=\"tr\">\n      <body>{children}</body>\n    </html>\n  )\n}"),
    draft('app/page.tsx', 'Ana sayfa', "import { site } from '../lib/site'\nimport StatusCard from './components/StatusCard'\n\nexport default function Home() {\n  return (\n    <main>\n      <h1>{site.name}</h1>\n      <p>{site.description}</p>\n      <StatusCard label=\"API durumu\" endpoint=\"/api/health\" />\n    </main>\n  )\n}"),
    draft('app/components/StatusCard.tsx', 'Yeniden kullanılabilir durum kartı bileşeni', "type StatusCardProps = { label: string; endpoint: string }\n\nexport default function StatusCard({ label, endpoint }: StatusCardProps) {\n  return (\n    <section className=\"card\">\n      <strong>{label}</strong>\n      <code>{endpoint}</code>\n    </section>\n  )\n}"),
    draft('app/api/health/route.ts', 'Sağlık kontrolü API yolu', "import { site } from '../../../lib/site'\n\nexport function GET() {\n  return Response.json({ name: site.name, status: 'ok' })\n}"),
    draft('app/globals.css', 'Genel stiller', 'body{margin:0;background:#0b1020;color:#e5e7eb;font-family:system-ui,sans-serif}main{max-width:900px;margin:12vh auto;padding:24px}.card{display:flex;gap:1rem;align-items:center;margin-top:2rem;padding:1.25rem;border:1px solid #334155;border-radius:1rem;background:#111a2e}'),
    draft('README.md', 'Kurulum ve çalıştırma yönergeleri', readme(context, 'Next.js (App Router)', [
      ['Kurulum', '```bash\nnpm install\n```'],
      ['Çalıştırma', '```bash\nnpm run dev\n```'],
      ['Derleme', '```bash\nnpm run build\n```'],
    ])),
  ]
}
