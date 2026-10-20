// Ultron Application Automation: kontrollü uygulama adaptörleri.
// Model serbest komut üretemaz; yalnızca bu katalogdan (adapterId, actionId) seçer.
// Komut dizileri katalogdan üretilir, kullanıcının izin akışı (PermissionManager) işler.
// Önceliği katalogla uyumlu: resmî CLI/otomasyon; UI/uzaktan otomasyon bu sürümde yoktur.

export type AdapterRisk = 'read-only' | 'write' | 'install'

export type AdapterActionContext = {
  projectPath: string
  executable: string
  extraArgs?: string[]
  scriptFile?: string
  mediaFile?: string
}

export type AdapterAction = {
  id: string
  description: string
  risk: AdapterRisk
  /** Bu eylem proje dizinini (cwd) gerektirir. */
  needsProject: boolean
  build: (context: AdapterActionContext) => string[]
}

export type AppAdapter = {
  id: string
  name: string
  /** Yürütülebilir dosya adı (Windows'ta where.exe ile bulunur). */
  executable: string
  /** `--version` tarzı bir tanıtma komutu (adaptör testi için). */
  versionArgs: string[]
  actions: Record<string, AdapterAction>
}

function projectArg(context: { projectPath: string }): string {
  return `"${context.projectPath}"`
}

function resolveExecutable(context: { executable: string }): string {
  // findSystemCommand PATH'e bakar; tam yol dönerse doğrudan kullan.
  return context.executable
}

const adapters: AppAdapter[] = [
  {
    id: 'git',
    name: 'Git',
    executable: 'git',
    versionArgs: ['--version'],
    actions: {
      status: { id: 'status', description: 'git status --short --branch', risk: 'read-only', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'status', '--short', '--branch'] },
      diff: { id: 'diff', description: 'Değişiklik farkı (git diff --stat)', risk: 'read-only', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'diff', '--stat'] },
      log: { id: 'log', description: 'Son 20 işlem kısa kaydı (git log --oneline -n 20)', risk: 'read-only', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'log', '--oneline', '-n', '20'] },
      branch: { id: 'branch', description: 'Dalları listeler (git branch -a)', risk: 'read-only', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'branch', '-a'] },
      stash_list: { id: 'stash_list', description: 'Stash kayıtlarını listeler', risk: 'read-only', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'stash', 'list'] },
      add_commit: {
        id: 'add_commit',
        description: 'Tüm değişiklikleri ekleyip commit oluşturur (git add -A && git commit -m "<mesaj>"); kullanıcı onayı gerekir.',
        risk: 'write',
        needsProject: true,
        build: (ctx) => [resolveExecutable(ctx), 'add', '-A', '&&', resolveExecutable(ctx), 'commit', '-m', '<mesaj>'],
      },
    },
  },
  {
    id: 'node',
    name: 'Node.js',
    executable: 'node',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'node --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      run_script: { id: 'run_script', description: 'node <file> çalıştırır; dosya proje içinde ve kullanıcının onayından geçmelidir.', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), `"${ctx.scriptFile ?? ''}"`].filter(Boolean) },
    },
  },
  {
    id: 'npm',
    name: 'npm',
    executable: 'npm',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'npm --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      test: { id: 'test', description: 'npm test komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'test'] },
      list: { id: 'list', description: 'Kurulu paketleri listeler (npm ls, derinlik 0)', risk: 'read-only', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'ls', '--depth', '0'] },
      outdated: { id: 'outdated', description: 'Güncel sürüm kontrolü (npm outdated)', risk: 'read-only', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'outdated'] },
      install: { id: 'install', description: 'Paket kurulumu (npm install <pkgs>); izin akışına tabidir ve install riski taşır', risk: 'install', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'install', ...(ctx.extraArgs ?? [])] },
    },
  },
  {
    id: 'pnpm',
    name: 'pnpm',
    executable: 'pnpm',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'pnpm --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      install: { id: 'install', description: 'Proje bağımlılıklarını pnpm install ile kurar', risk: 'install', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'install', ...(ctx.extraArgs ?? [])] },
      test: { id: 'test', description: 'pnpm test komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'test'] },
      build: { id: 'build', description: 'pnpm build komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'build'] },
      list: { id: 'list', description: 'Kurulu paketleri listeler', risk: 'read-only', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'list', '--depth', '0'] },
    },
  },
  {
    id: 'yarn',
    name: 'Yarn',
    executable: 'yarn',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'yarn --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      install: { id: 'install', description: 'Proje bağımlılıklarını yarn install ile kurar', risk: 'install', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'install', ...(ctx.extraArgs ?? [])] },
      test: { id: 'test', description: 'yarn test komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'test'] },
      build: { id: 'build', description: 'yarn build komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'build'] },
    },
  },
  {
    id: 'bun',
    name: 'Bun',
    executable: 'bun',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'bun --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      install: { id: 'install', description: 'Proje bağımlılıklarını bun install ile kurar', risk: 'install', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'install', ...(ctx.extraArgs ?? [])] },
      test: { id: 'test', description: 'bun test komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'test'] },
      build: { id: 'build', description: 'bun run build komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'run', 'build'] },
    },
  },
  {
    id: 'python',
    name: 'Python',
    executable: 'python',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'python --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      pytest: { id: 'pytest', description: 'python -m pytest (test dosyalarını çalıştırır)', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), '-m', 'pytest', ...(ctx.extraArgs ?? ['-q'])] },
      run_script: { id: 'run_script', description: 'python <file> çalıştırır; ayrıca onay gerekir.', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), `"${ctx.scriptFile ?? ''}"`].filter(Boolean) },
    },
  },
  {
    id: 'pip',
    name: 'pip',
    executable: 'pip',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'pip --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      list: { id: 'list', description: 'Kurulu pip paketlerini listeler', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), 'list', '--format=columns'] },
      install: { id: 'install', description: 'Paket kurulumu (pip install <pkgs>); izin akışına tabidir', risk: 'install', needsProject: false, build: (ctx) => [resolveExecutable(ctx), 'install', ...(ctx.extraArgs ?? [])] },
    },
  },
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    executable: 'code',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'code --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      open: { id: 'open', description: 'code <project> (VS Code ile proje klasörünü açar)', risk: 'write', needsProject: false, build: (ctx) => [resolveExecutable(ctx), projectArg(ctx)] },
      list_extensions: { id: 'list_extensions', description: 'Kurulu VS Code uzantılarını listeler (code --list-extensions)', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--list-extensions'] },
    },
  },
  {
    id: 'ollama',
    name: 'Ollama',
    executable: 'ollama',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'ollama --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      list: { id: 'list', description: 'Kurulu yerel modelleri listeler (ollama list)', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), 'list'] },
      ps: { id: 'ps', description: 'Yüklü modelleri gösterir (ollama ps)', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), 'ps'] },
    },
  },
  {
    id: 'docker',
    name: 'Docker',
    executable: 'docker',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'docker --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      ps: { id: 'ps', description: 'Çalışan konteynerleri listeler (docker ps)', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), 'ps'] },
      images: { id: 'images', description: 'İmajları listeler (docker images)', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), 'images'] },
    },
  },
  {
    id: 'dotnet',
    name: '.NET SDK',
    executable: 'dotnet',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'dotnet --version', risk: 'read-only', needsProject: true, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      list_sdks: { id: 'list_sdks', description: 'Kurulu .NET SDK sürümlerini listeler', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--list-sdks'] },
    },
  },
  {
    id: 'gradle',
    name: 'Gradle',
    executable: 'gradle',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'gradle --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
    },
  },
  {
    id: 'maven',
    name: 'Apache Maven',
    executable: 'mvn',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'mvn --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      test: { id: 'test', description: 'mvn test komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'test'] },
      package: { id: 'package', description: 'mvn package komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'package'] },
    },
  },
  {
    id: 'cargo',
    name: 'Rust Cargo',
    executable: 'cargo',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'cargo --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      check: { id: 'check', description: 'cargo check komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'check'] },
      test: { id: 'test', description: 'cargo test komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'test'] },
      build: { id: 'build', description: 'cargo build --release komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'build', '--release'] },
    },
  },
  {
    id: 'go',
    name: 'Go',
    executable: 'go',
    versionArgs: ['version'],
    actions: {
      version: { id: 'version', description: 'go version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), 'version'] },
      test: { id: 'test', description: 'go test ./... komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'test', './...'] },
      build: { id: 'build', description: 'go build ./... komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'build', './...'] },
      mod_tidy: { id: 'mod_tidy', description: 'go mod tidy ile modülleri düzenler', risk: 'install', needsProject: true, build: (ctx) => [resolveExecutable(ctx), 'mod', 'tidy'] },
    },
  },
  {
    id: 'cmake',
    name: 'CMake',
    executable: 'cmake',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'cmake --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      configure: { id: 'configure', description: 'cmake -S . -B build ile yapılandırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), '-S', '.', '-B', 'build'] },
      build: { id: 'build', description: 'cmake --build build --config Release çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), '--build', 'build', '--config', 'Release'] },
      test: { id: 'test', description: 'ctest --test-dir build çalıştırır', risk: 'write', needsProject: true, build: () => ['ctest', '--test-dir', 'build', '--output-on-failure'] },
    },
  },
  {
    id: 'ninja',
    name: 'Ninja',
    executable: 'ninja',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'ninja --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
      build: { id: 'build', description: 'ninja -C build komutunu çalıştırır', risk: 'write', needsProject: true, build: (ctx) => [resolveExecutable(ctx), '-C', 'build'] },
    },
  },
  {
    id: 'gimp',
    name: 'GIMP',
    executable: 'gimp',
    versionArgs: ['--version'],
    actions: {
      version: { id: 'version', description: 'gimp --version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '--version'] },
    },
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    executable: 'ffmpeg',
    versionArgs: ['-version'],
    actions: {
      version: { id: 'version', description: 'ffmpeg -version', risk: 'read-only', needsProject: false, build: (ctx) => [resolveExecutable(ctx), '-version'] },
      probe: { id: 'probe', description: 'Medya dosyası bilgi kontrolü (ffprobe); kullanıcı onayı gerektirir', risk: 'read-only', needsProject: false, build: (ctx) => [ctx.executable.replace('ffmpeg', 'ffprobe'), `"${ctx.mediaFile ?? ''}"`].filter((part) => part.includes('"') ? Boolean(ctx.mediaFile) : Boolean(part)) },
    },
  },
]

export function listAdapters(): AppAdapter[] {
  return adapters
}

export function findAdapter(adapterId: string): AppAdapter | null {
  const clean = adapterId.trim().toLowerCase()
  return adapters.find((adapter) => adapter.id === clean) ?? null
}

export type BuiltCommandRequest = {
  adapterId: string
  actionId: string
  projectPath?: string | null
  executable?: string | null
  extraArgs?: string[]
  scriptFile?: string
  mediaFile?: string
}

export function buildAdapterCommand(request: BuiltCommandRequest): { ok: true; command: string; risk: AdapterRisk; description: string; adapter: string; action: string } | { ok: false; error: string } {
  const adapter = findAdapter(request.adapterId)
  if (!adapter) {
    const valid = adapters.map((item) => item.id).join(', ')
    return { ok: false, error: `Adaptör bulunamadı: ${request.adapterId}. Geçerli adaptörler: ${valid}.` }
  }
  const action = adapter.actions[request.actionId?.trim() ?? '']
  if (!action) {
    const valid = Object.keys(adapter.actions).join(', ')
    return { ok: false, error: `Eylem bulunamadı: ${request.actionId}. ${adapter.name} eylemleri: ${valid}.` }
  }
  const projectPath = (request.projectPath ?? '').trim()
  if (action.needsProject && !projectPath) return { ok: false, error: `${adapter.name}/${action.id} bir proje dizini gerektirir; önce proje klasörünü açın.` }
  const context = {
    projectPath,
    executable: adapter.executable,
    extraArgs: request.extraArgs,
    scriptFile: request.scriptFile,
    mediaFile: request.mediaFile,
  }
  const parts = action.build(context).map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return { ok: false, error: `Eylem komutu üretmedi (${adapter.name}/${action.id}).` }
  // riski install olan eylemler izin akışının onayına takılır
  let command = parts.join(' ')
  if (adapter.id === 'git' && action.id === 'add_commit') {
    const message = (request.extraArgs?.[0] ?? 'otomatik gönderim').replace(/"/g, '').trim() || 'otomatik gönderim'
    command = `${adapter.executable} add -A && ${adapter.executable} commit -m "${message}"`
  }
  return { ok: true, command, risk: action.risk, description: action.description, adapter: adapter.id, action: action.id }
}

export function describeAdaptersForTool(): string {
  return adapters.map((adapter) => `${adapter.id} (${adapter.name}): ${Object.keys(adapter.actions).join(', ')}`).join('\n')
}
