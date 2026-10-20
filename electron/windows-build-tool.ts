export type WindowsTechnology = 'python' | 'dotnet' | 'electron' | 'tauri' | 'cmake' | 'unknown'
export type WindowsBuildAction = 'analyze' | 'test' | 'build' | 'configure' | 'package' | 'installer' | 'verify_start'
export type WindowsProjectAnalysis = {
  projectName: string
  filesScanned: number
  technologies: WindowsTechnology[]
  primaryTechnology: WindowsTechnology
  frameworks: string[]
  projectFiles: string[]
  entryFiles: string[]
  testFiles: string[]
  installerFiles: string[]
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'
  packageScripts: Record<string, string>
  hasInstallerConfig: boolean
  recommendations: string[]
}
export type WindowsBuildPlan = {
  action: WindowsBuildAction
  technology: WindowsTechnology
  commands: string[]
  workingDirectory?: string
  expectedExtensions: string[]
  expectedRelativePath?: string
  testsExpected: boolean
  notes: string[]
}

const posixDirname = (value: string) => value.includes('/') ? value.slice(0, value.lastIndexOf('/')) || '.' : '.'
const posixBasename = (value: string) => value.split('/').pop() ?? value

export function analyzeWindowsProjectFiles(files: Record<string, string>): WindowsProjectAnalysis {
  const entries = Object.entries(files).map(([name, content]) => [name.replace(/\\/g, '/').replace(/^\.\//, ''), content] as const)
  const paths = entries.map(([name]) => name)
  const all = entries.map(([name, content]) => `${name}\n${content.slice(0, 250_000)}`).join('\n').toLowerCase()
  const packageManifest = entries.find(([name]) => /(^|\/)package\.json$/i.test(name))
  let packageData: { name?: string; packageManager?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } = {}
  if (packageManifest) {
    try { packageData = JSON.parse(packageManifest[1]) as typeof packageData } catch { /* report the project even with a malformed manifest */ }
  }
  const packageScripts = packageData.scripts && typeof packageData.scripts === 'object' ? packageData.scripts : {}
  const declaredManager = packageData.packageManager?.split('@')[0]
  const packageManager: WindowsProjectAnalysis['packageManager'] = declaredManager === 'pnpm' || paths.some((name) => /(^|\/)pnpm-lock\.yaml$/i.test(name)) ? 'pnpm'
    : declaredManager === 'yarn' || paths.some((name) => /(^|\/)yarn\.lock$/i.test(name)) ? 'yarn'
      : declaredManager === 'bun' || paths.some((name) => /(^|\/)bun\.lockb?$/i.test(name)) ? 'bun' : 'npm'
  const dotnetFiles = paths.filter((name) => /\.(?:sln|slnx|csproj|fsproj)$/i.test(name))
  const cppFiles = paths.filter((name) => /(^|\/)cmakelists\.txt$/i.test(name) || /(^|\/)cmakepresets\.json$/i.test(name))
  const tauriFiles = paths.filter((name) => /(^|\/)src-tauri\/cargo\.toml$/i.test(name) || /(^|\/)tauri\.conf\.json$/i.test(name) || /(^|\/)tauri\.conf\.json5$/i.test(name))
  const pythonFiles = paths.filter((name) => /\.py$/i.test(name))
  const hasElectron = Boolean(packageManifest && (packageData.dependencies?.electron || packageData.devDependencies?.electron || paths.some((name) => /(^|\/)electron\.builder\./i.test(name))))
  const technologies: WindowsTechnology[] = []
  if (dotnetFiles.length) technologies.push('dotnet')
  if (tauriFiles.length || paths.some((name) => /(^|\/)src-tauri\/cargo\.toml$/i.test(name)) && /tauri/.test(all)) technologies.push('tauri')
  if (hasElectron) technologies.push('electron')
  if (cppFiles.length) technologies.push('cmake')
  if (pythonFiles.length || paths.some((name) => /(^|\/)(?:pyproject\.toml|requirements[^/]*\.txt|setup\.py)$/i.test(name))) technologies.push('python')

  const frameworks = new Set<string>()
  if (pythonFiles.length) {
    if (/\btkinter\b/.test(all)) frameworks.add('Tkinter')
    if (/\bpyside6\b/.test(all)) frameworks.add('PySide6')
    if (/\bpyqt6\b/.test(all)) frameworks.add('PyQt6')
    if (/\bpyqt5\b/.test(all)) frameworks.add('PyQt5')
    if (!frameworks.size) frameworks.add('Python')
  }
  if (dotnetFiles.length) {
    if (/usewindowsforms\s*>\s*true|windows\.forms/i.test(all)) frameworks.add('Windows Forms')
    if (/usewpf\s*>\s*true|presentationframework/i.test(all)) frameworks.add('WPF')
    if (/microsoft\.windowsappsdk|windowsapp\.sdk/i.test(all)) frameworks.add('WinUI')
    if (!['Windows Forms', 'WPF', 'WinUI'].some((name) => frameworks.has(name))) frameworks.add('.NET')
  }
  if (hasElectron) frameworks.add('Electron')
  if (technologies.includes('tauri')) frameworks.add('Tauri')
  if (cppFiles.length) frameworks.add('CMake/C++')

  const projectFiles = paths.filter((name) => /(?:^|\/)(?:pyproject\.toml|requirements[^/]*\.txt|setup\.py|package\.json|cargo\.toml|tauri\.conf\.(?:json|json5)|cmakelists\.txt|cmakepresets\.json)|\.(?:sln|slnx|csproj|fsproj)$/i.test(name)).slice(0, 100)
  const entryFiles = paths.filter((name) => /\.py$/i.test(name) && (/(^|\/)(?:main|app|run|gui|__main__)\.py$/i.test(name) || /if\s+__name__\s*==\s*["']__main__["']/.test(entries.find(([entry]) => entry === name)?.[1] ?? ''))).slice(0, 100)
  const testFiles = paths.filter((name) => /(^|\/)(?:tests?|test|specs?)(\/|$)/i.test(name) || /(^|\/)(?:test_[^/]+|[^/]+_test|[^/]+\.test|[^/]+\.spec)\.[^.]+$/i.test(name) || /#\s*\[\s*(?:cfg\(test\)|test)\s*\]|\[(?:Fact|Test)\]/i.test(entries.find(([entry]) => entry === name)?.[1] ?? '')).slice(0, 200)
  const hasInstallerConfig = paths.some((name) => /\.iss$/i.test(name))
  const installerFiles = paths.filter((name) => /\.iss$/i.test(name)).slice(0, 20)
  const primaryTechnology = technologies[0] ?? 'unknown'
  const recommendations: string[] = []
  if (primaryTechnology === 'unknown') recommendations.push('Desteklenen proje dosyası bulunamadı. Python, .NET, Electron, Tauri veya CMake proje kökünü seçin.')
  if (primaryTechnology === 'python' && !entryFiles.length) recommendations.push('Python giriş dosyası otomatik belirlenemedi; paketleme öncesi açık bir giriş .py dosyası seçin.')
  if (primaryTechnology === 'python' && !testFiles.length) recommendations.push('Proje testleri algılanmadı; paketleme öncesi iş mantığı için unittest veya pytest testleri ekleyin.')
  if (primaryTechnology === 'dotnet' && !dotnetFiles.some((name) => /\.csproj$/i.test(name))) recommendations.push('.NET çözümü algılandı ancak .csproj bulunamadı; SDK ile yüklenebilir proje eklenmeden derleme yapılamaz.')
  if (primaryTechnology === 'electron' && !packageScripts.build) recommendations.push('package.json içinde build betiği algılanmadı; bu projeye uygun derleme betiği yapılandırılmalı.')
  if (primaryTechnology === 'electron' && !packageScripts.dist && !packageScripts.package) recommendations.push('package.json içinde dist veya package betiği yok; Windows dağıtımı için electron-builder ya da electron-forge yapılandırılmalı.')
  if (primaryTechnology === 'cmake' && !paths.some((name) => /(^|\/)cmakelists\.txt$/i.test(name))) recommendations.push('CMakePresets bulundu ancak CMakeLists.txt taranmadı; yapılandırmayı doğrulayın.')
  if (!testFiles.length && primaryTechnology !== 'unknown') recommendations.push('Test dosyası veya test klasörü algılanmadı; build sonucu test başarısı sayılmaz.')
  const pyproject = entries.find(([name]) => /(^|\/)pyproject\.toml$/i.test(name))?.[1] ?? ''
  const pythonPackageName = pyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1]
  const projectName = packageData.name?.trim() || pythonPackageName || dotnetFiles.find((name) => /\.csproj$/i.test(name))?.split('/').pop()?.replace(/\.csproj$/i, '') || entryFiles[0]?.split('/').pop()?.replace(/\.py$/i, '') || posixBasename(paths[0] ? posixDirname(paths[0]) : '') || 'Windows uygulaması'
  return { projectName, filesScanned: paths.length, technologies, primaryTechnology, frameworks: [...frameworks], projectFiles, entryFiles, testFiles, installerFiles, packageManager, packageScripts: { ...packageScripts }, hasInstallerConfig, recommendations: [...new Set(recommendations)] }
}

function safeProjectPath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!normalized || normalized === '.') return ''
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some((part) => !part || part === '.' || part === '..') || /[\0"\r\n]/.test(normalized)) throw new Error('Proje yolu seçili çalışma alanı içindeki güvenli bir göreli yol olmalı.')
  return normalized
}

function quoted(value: string) {
  if (/["\0\r\n]/.test(value)) throw new Error('Komut parametresi geçersiz karakter içeriyor.')
  return `"${value}"`
}

function safeRunId(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(value)) throw new Error('Derleme kimliği geçersiz.')
  return value
}

function pythonEntry(analysis: WindowsProjectAnalysis, requested: string, projectPath: string) {
  const entries = analysis.entryFiles
  const provided = requested ? safeProjectPath(requested) : ''
  const entry = provided && projectPath && provided.startsWith(`${projectPath}/`) ? provided.slice(projectPath.length + 1) : provided || (entries.length === 1 ? entries[0] : '')
  if (!entry) throw new Error(entries.length ? `Birden fazla Python giriş dosyası var; entry_file belirtin: ${entries.slice(0, 8).join(', ')}` : 'Python uygulama giriş dosyası bulunamadı; entry_file olarak proje içindeki .py dosyasını belirtin.')
  if (!/\.py$/i.test(entry)) throw new Error('Python giriş dosyası seçili proje kökü içinde bir .py dosyası olmalı.')
  if (entries.length && requested && !entries.includes(entry)) throw new Error('entry_file uygulamanın algılanan Python giriş dosyalarından biri değil; analiz edip dosyayı doğrulayın.')
  return projectPath ? `${projectPath}/${entry}` : entry
}

function chooseFile(paths: string[], pattern: RegExp, message: string) {
  const file = paths.find((item) => pattern.test(item))
  if (!file) throw new Error(message)
  return file
}

export function createWindowsBuildPlan(analysis: WindowsProjectAnalysis, options: {
  action: WindowsBuildAction
  projectPath?: string
  entryFile?: string
  outputKind?: 'onefile' | 'onedir'
  windowMode?: 'windowed' | 'console'
  selfContained?: boolean
  singleFile?: boolean
  runId: string
}): WindowsBuildPlan {
  const projectPath = safeProjectPath(options.projectPath ?? '')
  const runId = safeRunId(options.runId)
  const prefix = projectPath ? `${projectPath}/` : ''
  const outputRoot = `${prefix}build/windows/${runId}`
  const expected: string[] = []
  const notes: string[] = []
  let testsExpected = false
  let commands: string[] = []
  let expectedRelativePath: string | undefined

  if (options.action === 'analyze') return { action: options.action, technology: analysis.primaryTechnology, commands: [], expectedExtensions: [], testsExpected: false, notes: analysis.recommendations }
  if (analysis.primaryTechnology === 'unknown') throw new Error('Seçili proje WindowsBuildTool ile desteklenen bir teknoloji olarak tanınmadı.')

  if (options.action === 'installer') {
    const script = `${prefix}${chooseFile(analysis.installerFiles, /\.iss$/i, 'Inno Setup .iss dosyası bulunamadı.')}`
    const outputRoot = `${prefix}build/windows/${runId}`
    commands = [`iscc /O${quoted(outputRoot)} ${quoted(script)}`]
    expected.push('.exe')
    return { action: options.action, technology: analysis.primaryTechnology, commands, expectedExtensions: expected, expectedRelativePath: outputRoot, testsExpected: false, notes: ['Inno Setup derleyicisi yoksa otomatik kurulmaz; kurulum ve tekrar kontrol kullanıcı onayıyla yapılmalıdır.'] }
  }

  if (analysis.primaryTechnology === 'python') {
    if (options.action === 'test') {
      if (!analysis.testFiles.length) throw new Error('Python test dosyası bulunamadı. Test sonucu üretmek için önce tests/ altına unittest veya pytest testi ekleyin.')
      testsExpected = true
      const usePytest = Boolean(analysis.packageScripts.test && /pytest/.test(analysis.packageScripts.test))
      const testRoot = analysis.testFiles.some((item) => item.toLowerCase().startsWith(`${prefix}tests/`)) ? `${prefix}tests` : projectPath || '.'
      commands = [usePytest ? `python -m pytest ${quoted(testRoot)} -q` : `python -m unittest discover -s ${quoted(testRoot)} -v`]
    } else if (options.action === 'build') {
      const entry = pythonEntry(analysis, options.entryFile ?? '', projectPath)
      commands = [`python -m py_compile ${quoted(entry)}`]
      notes.push('Python bytecode derlemesi tamamlanır; EXE üretimi için package eylemini kullanın.')
    } else if (options.action === 'package') {
      const entry = pythonEntry(analysis, options.entryFile ?? '', projectPath)
      const name = analysis.projectName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'WindowsApp'
      const kind = options.outputKind ?? 'onefile'
      const mode = options.windowMode ?? 'windowed'
      if (!['onefile', 'onedir'].includes(kind) || !['windowed', 'console'].includes(mode)) throw new Error('PyInstaller paketleme seçeneği geçersiz.')
      const distPath = `${outputRoot}/dist`
      commands = [`python -m PyInstaller --noconfirm --clean --distpath ${quoted(distPath)} --workpath ${quoted(`${outputRoot}/work`)} --specpath ${quoted(`${outputRoot}/spec`)} --name ${quoted(name)} --${kind} --${mode} ${quoted(entry)}`]
      expected.push('.exe')
      expectedRelativePath = `${distPath}/${kind === 'onefile' ? `${name}.exe` : name + '/' + name + '.exe'}`
      notes.push('PyInstaller ve GUI kitaplıklarının (Tkinter/PySide/PyQt) paket ortamında bulunduğunu doğrulayın; tek EXE seçeneği daha büyük olabilir.')
    } else throw new Error(`Python projesinde ${options.action} işlemi desteklenmiyor; test, build veya package seçin.`)
    return { action: options.action, technology: 'python', commands, expectedExtensions: expected, expectedRelativePath, testsExpected, notes }
  }

  if (analysis.primaryTechnology === 'dotnet') {
    const projectFile = `${prefix}${chooseFile(analysis.projectFiles, /\.csproj$/i, '.NET için .csproj bulunamadı; .sln tek başına yayımlanabilir uygulama hedefi belirlemiyor.')}`
    if (options.action === 'test') {
      testsExpected = true
      if (!analysis.testFiles.length) throw new Error('.NET test projesi veya test dosyası algılanmadı; test başarısı varsayılmayacak.')
      commands = [`dotnet test ${quoted(projectFile)} --configuration Release --nologo`]
    } else if (options.action === 'build') commands = [`dotnet build ${quoted(projectFile)} --configuration Release --nologo`]
    else if (options.action === 'package') {
      const selfContained = Boolean(options.selfContained)
      const singleFile = Boolean(options.singleFile)
      commands = [`dotnet publish ${quoted(projectFile)} --configuration Release --runtime win-x64 --self-contained ${selfContained ? 'true' : 'false'} --nologo -p:PublishSingleFile=${singleFile ? 'true' : 'false'} -o ${quoted(outputRoot)}`]
      expected.push('.exe')
      expectedRelativePath = `${outputRoot}`
      notes.push(selfContained ? 'Self-contained yayın .NET runtime içerdiğinden daha büyük olur.' : 'Framework-dependent yayın hedef bilgisayarda uyumlu .NET Desktop Runtime gerektirir.')
    } else throw new Error(`.NET projesinde ${options.action} işlemi desteklenmiyor; test, build veya package seçin.`)
    return { action: options.action, technology: 'dotnet', commands, expectedExtensions: expected, expectedRelativePath, testsExpected, notes }
  }

  if (analysis.primaryTechnology === 'electron') {
    const manifest = analysis.projectFiles.find((item) => /(^|\/)package\.json$/i.test(item))
    const npmPrefix = manifest ? `${projectPath ? `${projectPath}/` : ''}${posixDirname(manifest)}`.replace(/\/$/, '') || '.' : projectPath || '.'
    const packageCommand = analysis.packageManager === 'npm' ? `npm ${npmPrefix === '.' ? '' : `--prefix ${quoted(npmPrefix)} `}`
      : `${analysis.packageManager} ${npmPrefix === '.' ? '' : `${analysis.packageManager === 'pnpm' ? '--dir' : '--cwd'} ${quoted(npmPrefix)} `}`
    if (options.action === 'test') {
      testsExpected = true
      if (!analysis.packageScripts.test && !analysis.testFiles.length) throw new Error('Electron package.json içinde test betiği veya test dosyası algılanmadı.')
      if (!analysis.packageScripts.test) throw new Error('Test dosyaları var ancak güvenilir package.json test betiği yok; test komutunu açıkça ekleyip run_tests ile çalıştırın.')
      commands = [`${packageCommand}test`]
    } else if (options.action === 'build') {
      if (analysis.packageScripts.build) commands = [`${packageCommand}run build`]
      else commands = [`${packageCommand}exec electron-vite -- build`]
    } else if (options.action === 'package') {
      const script = analysis.packageScripts.dist ? 'dist' : analysis.packageScripts.package ? 'package' : ''
      if (!script) throw new Error('Electron paketlemesi için package.json içinde doğrulanmış dist veya package betiği gerekli; yapılandırma olmadan genel install scripti çalıştırılmayacak.')
      commands = [`${packageCommand}run ${script}`]
      expected.push('.exe', '.msi')
      notes.push(`package.json içindeki ${script} betiği çalıştırılacak; betik kullanıcı onayıyla Windows hesabınızın izinlerini kullanır.`)
    } else throw new Error(`Electron projesinde ${options.action} işlemi desteklenmiyor; test, build veya package seçin.`)
    return { action: options.action, technology: 'electron', commands, expectedExtensions: expected, testsExpected, notes }
  }

  if (analysis.primaryTechnology === 'tauri') {
    const relativeManifest = chooseFile(analysis.projectFiles, /(^|\/)cargo\.toml$/i, 'Tauri cargo manifesti bulunamadı.')
    const manifest = `${prefix}${relativeManifest}`
    const tauriRoot = posixDirname(relativeManifest)
    if (options.action === 'test') { testsExpected = true; if (!analysis.testFiles.length) throw new Error('Rust test dosyası algılanmadı; test başarısı varsayılmayacak.'); commands = [`cargo test --manifest-path ${quoted(manifest)}`] }
    else if (options.action === 'build' || options.action === 'package') {
      commands = ['cargo tauri build']
      expected.push('.exe', '.msi')
      notes.push('Tauri CLI, Rust ve Windows build tools bulunmalı; bundle türü tauri.conf yapılandırmasına bağlıdır.')
    } else throw new Error(`Tauri projesinde ${options.action} işlemi desteklenmiyor; test, build veya package seçin.`)
    const outputDirectory = [...(projectPath ? [projectPath] : []), ...(tauriRoot !== '.' ? [tauriRoot] : []), 'target', 'release', 'bundle'].join('/')
    return { action: options.action, technology: 'tauri', commands, workingDirectory: options.action === 'build' || options.action === 'package' ? projectPath || undefined : undefined, expectedExtensions: expected, expectedRelativePath: expected.length ? outputDirectory : undefined, testsExpected, notes: [...notes, `Tauri proje yolu: ${tauriRoot}`] }
  }

  if (analysis.primaryTechnology === 'cmake') {
    const cmakeFile = chooseFile(analysis.projectFiles, /(^|\/)cmakelists\.txt$/i, 'CMakeLists.txt bulunamadı.')
    const cmakeRoot = posixDirname(cmakeFile)
    const sourcePath = cmakeRoot === '.' ? projectPath : `${projectPath ? `${projectPath}/` : ''}${cmakeRoot}`
    const source = sourcePath ? quoted(sourcePath) : '.'
    const buildDir = `${projectPath ? `${projectPath}/` : ''}build/windows/${runId}`
    if (options.action === 'configure') commands = [`cmake -S ${source} -B ${quoted(buildDir)}`]
    else if (options.action === 'build' || options.action === 'package') commands = [`cmake -S ${source} -B ${quoted(buildDir)}`, `cmake --build ${quoted(buildDir)} --config Release --parallel`]
    else if (options.action === 'test') { testsExpected = true; if (!analysis.testFiles.length) throw new Error('CMake test dosyası veya test klasörü algılanmadı; ctest başarısı varsayılmayacak.'); commands = [`cmake -S ${source} -B ${quoted(buildDir)}`, `cmake --build ${quoted(buildDir)} --config Release --parallel`, `ctest --test-dir ${quoted(buildDir)} -C Release --output-on-failure`] }
    else throw new Error(`CMake projesinde ${options.action} işlemi desteklenmiyor; configure, build, test veya package seçin.`)
    if (options.action !== 'configure') expected.push('.exe', '.msi')
    return { action: options.action, technology: 'cmake', commands, expectedExtensions: expected, testsExpected, expectedRelativePath: options.action === 'configure' ? undefined : buildDir, notes: ['CMake yapılandırması ve derlemesi proje kaynaklarından kod çalıştırabilir; işlem onay ister.'] }
  }

  if (options.action === 'verify_start') throw new Error('Başlatma doğrulaması, doğrulanmış EXE çıktısının tam proje içi artifact_path değeriyle yapılır.')
  throw new Error(`Windows derleme eylemi ${options.action} bu proje teknolojisi için uygulanmıyor.`)
}

export function analyzeWindowsBuildFailure(output: string, options: { exitCode?: number | null; timedOut?: boolean; cancelled?: boolean; artifactFound?: boolean; launchFailed?: boolean } = {}) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const evidence = lines.filter((line) => /error|failed|exception|not found|cannot|could not|missing|denied|timed out|unauthorized|MSB\d+|CS\d+|C\d{4}|LNK\d{4}|ModuleNotFoundError/i.test(line)).slice(-12).map((line) => line.slice(0, 600))
  const joined = lines.join('\n')
  if (options.cancelled) return { category: 'cancelled', summary: 'Windows derleme veya test işlemi kullanıcı tarafından iptal edildi.', evidence, retryable: false, suggestedAction: 'Yeni bir istek almadan işlemi tekrar başlatmayın.' }
  if (options.timedOut) return { category: 'timeout', summary: 'Windows derleme veya test işlemi zaman sınırını aştı.', evidence, retryable: true, suggestedAction: 'Son çıktıyı ve çalışan alt süreçleri inceleyin; süreyi aşan işin yan etkilerini doğrulayın.' }
  if (options.launchFailed) return { category: 'missing-tool', summary: 'Seçilen Windows derleme aracı başlatılamadı veya kurulu değil.', evidence, retryable: false, suggestedAction: 'Yalnızca seçilen proje bu araca ihtiyaç duyuyorsa uygun SDK/build tool kurulumunu önerin ve kurulumdan sonra sürümü yeniden kontrol edin.' }
  if (/not recognized|command not found|cannot be loaded|no such file|bu bilgisayarda bulunamadı|komut bulunamadı/i.test(joined)) return { category: 'missing-tool', summary: 'Windows proje komutu veya SDK bu bilgisayarda bulunamadı.', evidence, retryable: false, suggestedAction: 'Proje türünü ve araç gereksinimini doğrulayın; eksik aracı yalnızca bu proje istiyorsa kurulum onayıyla kurun.' }
  if (/ModuleNotFoundError|No module named ['"]?PyInstaller|pyinstaller.*not found/i.test(joined)) return { category: 'missing-packager', summary: 'Python EXE paketleme aracı PyInstaller bulunamadı.', evidence, retryable: false, suggestedAction: 'Python projesi EXE gerektiriyorsa `python -m pip install pyinstaller` komutunu ayrı paket kurulum onayıyla çalıştırın; sonrasında sürümü kontrol edin.' }
  if (/No module named|ModuleNotFoundError/i.test(joined)) return { category: 'missing-dependency', summary: 'Proje için gerekli bir Python modülü bulunamadı.', evidence, retryable: false, suggestedAction: 'Proje bağımlılık manifestini kontrol edin; yalnızca eksik bağımlılığı onaylı proje sanal ortamına kurun.' }
  if (/MSB3644|NETSDK1045|NETSDK1005|The current \.NET SDK does not support|A compatible installed \.NET SDK was not found/i.test(joined)) return { category: 'dotnet-sdk', summary: '.NET SDK veya hedef framework uyumsuz.', evidence, retryable: false, suggestedAction: 'Projede belirtilen TargetFramework ile kurulu SDK sürümlerini karşılaştırın; desteklenmeyen sürüm kurulu varsaymayın.' }
  if (/MSB|CS\d{4}|error CS|Build FAILED|error C\d{4}|LNK\d{4}/i.test(joined)) return { category: 'compile', summary: 'Kaynak kodu veya Windows derleme adımı başarısız.', evidence, retryable: false, suggestedAction: 'Kanıt satırlarına göre ilgili dosyayı inceleyin, en küçük düzeltmeyi yapın ve aynı build/test adımını yeniden çalıştırın.' }
  if (/npm ERR!|ELIFECYCLE|vite.*not recognized|electron-builder.*not found/i.test(joined)) return { category: 'javascript-tooling', summary: 'JavaScript bağımlılığı veya Electron betiği kullanılamadı.', evidence, retryable: false, suggestedAction: 'package.json betiğini ve proje node_modules durumunu denetleyin; paket kurulumu için kullanıcı onayı gerekir.' }
  if (/access is denied|permission denied|eacces|unauthorizedaccess/i.test(joined)) return { category: 'permission', summary: 'Dosya erişimi veya işlem izni reddedildi.', evidence, retryable: false, suggestedAction: 'Hedefin seçili proje kapsamı içinde ve yazılabilir olduğunu denetleyin; yönetici yetkisini otomatik yükseltmeyin.' }
  if (/could not resolve|connection timed out|unable to load the service index|NU1301|failed to download|network is unreachable/i.test(joined)) return { category: 'dependency-network', summary: 'Paket kaynağına veya indirme ağına erişilemedi.', evidence, retryable: true, suggestedAction: 'Ağ ve paket kaynağını denetleyin; çevrimdışı derleme varsa tercih edin ve ağ indirmesi için kullanıcı onayı alın.' }
  if (options.artifactFound === false) return { category: 'missing-artifact', summary: 'Komut başarılı görünse de beklenen EXE/kurulum çıktısı bulunamadı.', evidence, retryable: false, suggestedAction: 'Proje paketleme betiğinin çıktı yolunu kontrol edin; yalnızca sıfırdan büyük, güncel ve geçerli PE dosyasını başarı sayın.' }
  if (options.launchFailed) return { category: 'launch', summary: 'Paketlenmiş uygulama başlatılamadı.', evidence, retryable: false, suggestedAction: 'Gerçek başlatma hatasını ve gereken runtime/DLL dosyalarını inceleyin; GUI görünümünü görsel olarak doğrulanmış saymayın.' }
  if (options.exitCode !== undefined && options.exitCode !== null && options.exitCode !== 0) return { category: 'build', summary: `Windows proje komutu ${options.exitCode} çıkış koduyla başarısız oldu.`, evidence, retryable: false, suggestedAction: 'Komut çıktısındaki ilk gerçek hata ve kök nedeni inceleyin; başarısız adımı başarılı olarak raporlamayın.' }
  return { category: 'unknown', summary: 'Windows proje sonucu belirgin bir hata sınıfına eşlenemedi.', evidence, retryable: false, suggestedAction: 'Tam komut çıktısını ve çıkış kodunu kaydedip proje kaynaklarıyla karşılaştırın.' }
}

export function isValidWindowsPeHeader(bytes: Uint8Array, fileSize: number) {
  if (fileSize < 128 || bytes.length < 68 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return false
  const offset = bytes[0x3c] | (bytes[0x3d] << 8) | (bytes[0x3e] << 16) | (bytes[0x3f] << 24)
  return Number.isSafeInteger(offset) && offset >= 64 && offset + 4 <= fileSize && offset + 4 <= bytes.length
    && bytes[offset] === 0x50 && bytes[offset + 1] === 0x45 && bytes[offset + 2] === 0 && bytes[offset + 3] === 0
}
