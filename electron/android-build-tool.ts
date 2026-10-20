export type AndroidBuildFailureCategory =
  | 'missing-java' | 'missing-sdk' | 'missing-wrapper' | 'dependency-network' | 'dependency'
  | 'sdk-version' | 'gradle-configuration' | 'manifest' | 'source' | 'test' | 'signing'
  | 'timeout' | 'cancelled' | 'missing-artifact' | 'emulator' | 'device-disconnected' | 'permission' | 'unknown'

export type AndroidBuildFailure = {
  category: AndroidBuildFailureCategory
  summary: string
  evidence: string[]
  retryable: boolean
  suggestedAction: string
}

export type AndroidDevice = { serial: string; state: string; details: string }

export type AndroidModuleAnalysis = {
  path: string
  buildFile: string
  kind: 'application' | 'library' | 'unknown'
  namespace: string | null
  applicationId: string | null
  compileSdk: string | null
  minSdk: string | null
  languages: string[]
  usesCompose: boolean
  hasUnitTests: boolean
  hasDeviceTests: boolean
  dependencyCount: number
}

export type AndroidProjectAnalysis = {
  isAndroidProject: boolean
  rootProjectName: string | null
  hasGradleWrapper: boolean
  wrapperDistribution: string | null
  modules: AndroidModuleAnalysis[]
  manifestFiles: string[]
  languages: string[]
  findings: string[]
}

export function isSafeAndroidGradleTask(task: string) {
  return /^:?(?:(?:[A-Za-z][\w.-]*):)*(?:assembleDebug|assembleRelease|bundleDebug|bundleRelease|test|testDebugUnitTest|testReleaseUnitTest|connectedDebugAndroidTest|connectedAndroidTest|lint|lintDebug|lintRelease|check|tasks|projects)$/.test(task)
}

export function parseAndroidDevices(output: string): AndroidDevice[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed || /^List of devices attached$/i.test(trimmed) || /^\*\s+daemon/i.test(trimmed)) return []
    const [serial, state, ...details] = trimmed.split(/\s+/)
    if (!serial || !state || /^adb$/i.test(serial) || /^error:/i.test(serial)) return []
    return [{ serial, state, details: details.join(' ') }]
  })
}

export function analyzeAndroidProjectFiles(files: Record<string, string>): AndroidProjectAnalysis {
  const normalized = Object.fromEntries(Object.entries(files).map(([name, value]) => [name.replace(/\\/g, '/').replace(/^\.\//, ''), value]))
  const names = Object.keys(normalized)
  const buildFiles = names.filter((name) => /(^|\/)(?:build\.gradle(?:\.kts)?|build\.gradle)$/.test(name))
  const manifestFiles = names.filter((name) => /(^|\/)src\/main\/AndroidManifest\.xml$/i.test(name))
  const wrapperProperties = Object.entries(normalized).find(([name]) => /(^|\/)gradle\/wrapper\/gradle-wrapper\.properties$/i.test(name))?.[1]
  const settings = Object.entries(normalized).find(([name]) => /(^|\/)settings\.gradle(?:\.kts)?$/i.test(name))?.[1] ?? ''
  const applicationModules: AndroidModuleAnalysis[] = []

  for (const buildFile of buildFiles) {
    const content = normalized[buildFile]
    if (!/com\.android\.(?:application|library)|com\.android\.application|com\.android\.library/.test(content)) continue
    const parent = buildFile.includes('/') ? buildFile.slice(0, buildFile.lastIndexOf('/')) : '.'
    const appKind = /com\.android\.application/.test(content) ? 'application' : /com\.android\.library/.test(content) ? 'library' : 'unknown'
    const moduleFiles = names.filter((name) => name.startsWith(`${parent === '.' ? '' : `${parent}/`}src/`))
    const sourceFiles = moduleFiles.filter((name) => /\.(?:kt|java)$/i.test(name))
    const namespace = content.match(/\bnamespace\s*(?:=\s*)?["']([^"']+)["']/)?.[1] ?? null
    const applicationId = content.match(/\bapplicationId\s*(?:=\s*)?["']([^"']+)["']/)?.[1] ?? namespace
    const sdk = (key: string) => content.match(new RegExp(`\\b${key}\\s*(?:=\\s*)?(?:\\(?\\s*)?["']?([\\w.]+)`))?.[1] ?? null
    applicationModules.push({
      path: parent, buildFile, kind: appKind, namespace, applicationId,
      compileSdk: sdk('compileSdk(?:Version)?'), minSdk: sdk('minSdk(?:Version)?'),
      languages: [...new Set(sourceFiles.map((name) => name.toLowerCase().endsWith('.kt') ? 'Kotlin' : 'Java'))],
      usesCompose: /compose\s*=\s*true|org\.jetbrains\.compose|@Composable/.test(content) || sourceFiles.some((name) => normalized[name].includes('@Composable')),
      hasUnitTests: moduleFiles.some((name) => /\/src\/test\//.test(`/${name}`)),
      hasDeviceTests: moduleFiles.some((name) => /\/src\/(?:androidTest|instrumentedTest)\//.test(`/${name}`)),
      dependencyCount: (content.match(/\b(?:implementation|api|testImplementation|androidTestImplementation|kapt|ksp)\s*\(?/g) ?? []).length,
    })
  }
  const languages = [...new Set(applicationModules.flatMap((module) => module.languages))]
  if (applicationModules.some((module) => module.usesCompose)) languages.push('Jetpack Compose')
  const isAndroidProject = buildFiles.some((name) => /com\.android\.(?:application|library)/.test(normalized[name])) || manifestFiles.length > 0
  const findings: string[] = []
  if (!isAndroidProject) findings.push('Android Gradle modülü veya AndroidManifest.xml bulunamadı.')
  if (isAndroidProject && !manifestFiles.length) findings.push('src/main/AndroidManifest.xml bulunamadı.')
  if (applicationModules.some((module) => module.kind === 'application' && !module.applicationId)) findings.push('En az bir uygulama modülünde applicationId/namespace bulunamadı.')
  if (isAndroidProject && !names.some((name) => /(^|\/)gradlew(?:\.bat)?$/i.test(name))) findings.push('Gradle Wrapper betiği bulunamadı; sistem Gradle kurulumu gerekir.')
  if (isAndroidProject && !applicationModules.length) findings.push('Android eklentisi kullanan uygulama modülü bulunamadı.')
  const projectName = settings.match(/rootProject\.name\s*=\s*["']([^"']+)["']/)?.[1] ?? null
  const wrapperDistribution = wrapperProperties?.match(/distributionUrl\s*=\s*(.+)/)?.[1]?.replace(/\\:/g, ':').trim() ?? null
  return {
    isAndroidProject, rootProjectName: projectName, hasGradleWrapper: names.some((name) => /(^|\/)gradlew(?:\.bat)?$/i.test(name)),
    wrapperDistribution, modules: applicationModules, manifestFiles, languages: [...new Set(languages)], findings,
  }
}

export function analyzeAndroidBuildFailure(output: string, options: { exitCode?: number | null; timedOut?: boolean; cancelled?: boolean; artifactFound?: boolean } = {}): AndroidBuildFailure {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const evidence = lines.filter((line) => /\b(?:error|exception|failed|failure|cannot|could not|unable|denied|timed out|timeout|no such|not found|unsupported|no connected|no devices)\b/i.test(line)).slice(-8).map((line) => line.slice(0, 500))
  const joined = `${output}\n${evidence.join('\n')}`.toLowerCase()
  let category: AndroidBuildFailureCategory = 'unknown'
  let summary = 'Derleme sonucu doğrulanamadı.'
  let suggestedAction = 'Son Gradle çıktısını ve ilgili proje yapılandırmasını inceleyip en küçük gerekli düzeltmeyi yapın.'
  let retryable = false

  if (options.cancelled || /kullanıcı işlemi iptal etti|\[iptal edildi\]/i.test(joined)) { category = 'cancelled'; summary = 'Derleme kullanıcı tarafından iptal edildi.'; suggestedAction = 'İptal sonrası çıktı dosyalarının güncelliğini yeniden kontrol edin.' }
  else if (options.timedOut || /\[zaman aşımı\]|timed out|timeout waiting for|daemon disappeared/i.test(joined)) { category = 'timeout'; summary = 'Gradle derlemesi zaman aşımına uğradı veya Gradle işlemi beklenmedik biçimde durdu.'; suggestedAction = 'Gradle daemon ve bellek çıktısını inceleyin; derleme sürecini sınırları içinde yeniden deneyin.'; retryable = true }
  else if (/no java|java_home is not set|jdk.*not found|requires java|could not determine java version/i.test(joined)) { category = 'missing-java'; summary = 'Android derlemesi için uygun bir JDK bulunamadı.'; suggestedAction = 'JDK kurulumunu ve JAVA_HOME değerini denetleyin; AGP 8.x için en az JDK 17 gerekir.' }
  else if (/sdk location not found|android_sdk_root|failed to find target|failed to install the following sdk components|platform .* not found|sdk directory.*does not exist/i.test(joined)) { category = 'missing-sdk'; summary = 'Android SDK veya istenen SDK bileşeni bulunamadı.'; suggestedAction = 'ANDROID_SDK_ROOT/ANDROID_HOME değerini, compileSdk platformunu ve SDK lisanslarını kontrol edin.' }
  else if (/gradlew(?:\.bat)? not found|gradle wrapper.*not found|no gradle wrapper|gradle.*not recognized/i.test(joined)) { category = 'missing-wrapper'; summary = 'Kullanılabilir Gradle Wrapper veya Gradle kurulumu bulunamadı.'; suggestedAction = 'Proje kökünde geçerli gradlew/gradlew.bat ve wrapper JAR bulunduğunu doğrulayın.' }
  else if (/could not create task|could not find method|could not get unknown property|plugin .* was not found|project with path .* could not be found|build file .* unexpected tokens/i.test(joined)) { category = 'gradle-configuration'; summary = 'Gradle proje veya eklenti yapılandırması başarısız.'; suggestedAction = 'Gerçek hata satırındaki settings/build.gradle dosyasını, pluginManagement ve include edilen modülleri inceleyin.' }
  else if (/could not resolve|could not find .* in (?:google|maven)|failed to resolve|could not download|unknownhost|connection timed out|network is unreachable|sslhandshakeexception|pkix path building failed/i.test(joined)) { category = 'dependency-network'; summary = 'Gradle bağımlılıkları çözümlenemedi veya indirme bağlantısı başarısız oldu.'; suggestedAction = 'Ağ, proxy, repository adresi ve TLS sertifika ayarlarını kontrol edin; indirme tamamlanmadan kaynak kodunu değiştirmeyin.'; retryable = true }
  else if (/dependency .*not found|could not find dependency|could not find [^\r\n]*:[^\r\n]*:[^\r\n]*|no matching variant|duplicate class|version conflict/i.test(joined)) { category = 'dependency'; summary = 'Gradle bağımlılık sürümü veya varyantı çözümlenemedi.'; suggestedAction = 'İlgili bağımlılık koordinatlarını, repository listesini ve Android/Java sürüm uyumluluğunu kontrol edin.' }
  else if (/compileSdkVersion .* not supported|android gradle plugin.*requires|requires compile sdk|minimum supported gradle version|unsupported class file major version|incompatible.*gradle/i.test(joined)) { category = 'sdk-version'; summary = 'Gradle, Android Gradle Plugin, JDK veya compileSdk sürümleri uyumsuz.'; suggestedAction = 'AGP, Gradle, JDK ve Android SDK resmi uyumluluk tablosuna göre eşleştirin.' }
  else if (/manifest merger failed|error:.*manifest|androidmanifest\.xml.*error|manifest.*missing/i.test(joined)) { category = 'manifest'; summary = 'Android manifest birleştirme veya manifest doğrulaması başarısız.'; suggestedAction = 'Çakışan manifest bildirimlerini, paket adını ve izinleri ilgili manifest dosyalarında inceleyin.' }
  else if (/no tests found|tests failed|test .*failed|assertionerror|there were failing tests|connected.*test.*failed/i.test(joined)) { category = 'test'; summary = 'Android testleri başarısız oldu veya çalıştırılacak test bulunamadı.'; suggestedAction = 'Başarısız test adını ve raporunu inceleyin; test sonucunu derleme sonucundan ayrı raporlayın.' }
  else if (/keystore|signingconfig|signing config|store file.*not found|key alias|password was incorrect|failed to read key/i.test(joined)) { category = 'signing'; summary = 'Release imzalama yapılandırması eksik veya geçersiz.'; suggestedAction = 'Kullanıcının anahtarını koruyarak imzalama ayarlarını yerel secret/environment yönetimiyle yapılandırın; anahtarları loglamayın.' }
  else if (/no connected devices|no devices found|no devices\/emulator found|emulator.*not found|no avds/i.test(joined)) { category = 'emulator'; summary = 'Bağlı cihaz veya uygun Android emülatörü bulunamadı.'; suggestedAction = 'ADB cihaz listesini kontrol edin; gerçek cihaz yoksa test edilmediğini raporlayın.' }
  else if (/device .*offline|device .*unauthorized|device not found|transport.*error|connection reset by peer/i.test(joined)) { category = 'device-disconnected'; summary = 'ADB cihaz bağlantısı kesildi veya yetkilendirilmedi.'; suggestedAction = 'Cihaz bağlantısını ve USB hata ayıklama yetkisini kullanıcıyla doğrulayın; cihaz verilerini sıfırlamayın.' }
  else if (/permission denied|access is denied|eacces|operation not permitted/i.test(joined)) { category = 'permission'; summary = 'Android derleme dosya veya araç erişim izni nedeniyle durdu.'; suggestedAction = 'Proje ve SDK klasörü izinlerini salt okunur kontrol edin; otomatik yönetici yetkisi yükseltmeyin.' }
  else if (/compilation error|cannot find symbol|unresolved reference|incompatible types|expecting .*\)|unexpected tokens|e: file:/i.test(joined)) { category = 'source'; summary = 'Java veya Kotlin kaynak kodu derlenemedi.'; suggestedAction = 'Hata satırındaki mevcut kaynak dosyasını okuyun, en küçük düzeltmeyi yapın ve aynı derleme/testi yeniden çalıştırın.' }
  else if (options.artifactFound === false) { category = 'missing-artifact'; summary = 'Gradle başarıyla çıksa da beklenen APK/AAB çıktısı bulunamadı.'; suggestedAction = 'Görevin varyantını ve modülün outputs/apk veya outputs/bundle klasörünü doğrulayın.' }
  else if (options.exitCode !== undefined && options.exitCode !== null && options.exitCode !== 0) { summary = `Gradle görevi ${options.exitCode} çıkış koduyla başarısız oldu.` }
  return { category, summary, evidence, retryable, suggestedAction }
}

export function isValidZipContainer(head: Uint8Array, tail: Uint8Array, fileSize: number) {
  if (!Number.isSafeInteger(fileSize) || fileSize < 22 || head.length < 4 || tail.length < 22) return false
  const read32 = (bytes: Uint8Array, offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
  if (head[0] !== 0x50 || head[1] !== 0x4b || !([0x03, 0x05, 0x07].includes(head[2]) && [0x04, 0x06, 0x08].includes(head[3]))) return false
  const tailBase = fileSize - tail.length
  for (let offset = tail.length - 22; offset >= Math.max(0, tail.length - 65_557); offset--) {
    if (read32(tail, offset) !== 0x06054b50) continue
    if (offset + 22 > tail.length) return false
    const disk = tail[offset + 4] | (tail[offset + 5] << 8)
    const centralDisk = tail[offset + 6] | (tail[offset + 7] << 8)
    const entries = tail[offset + 10] | (tail[offset + 11] << 8)
    const centralSize = read32(tail, offset + 12)
    const centralOffset = read32(tail, offset + 16)
    const commentLength = tail[offset + 20] | (tail[offset + 21] << 8)
    const absoluteEnd = tailBase + offset + 22 + commentLength
    return disk === 0 && centralDisk === 0 && entries > 0 && absoluteEnd === fileSize && centralOffset + centralSize <= fileSize && centralOffset >= 0
  }
  return false
}
