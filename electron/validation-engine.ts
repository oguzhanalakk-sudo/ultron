export type ValidationStatus = 'passed' | 'failed' | 'skipped' | 'blocked'

export type ValidationCategory =
  | 'typecheck'
  | 'build'
  | 'unit'
  | 'integration'
  | 'smoke'
  | 'runtime'
  | 'regression'
  | 'security'
  | 'environment'

export type ValidationResult = {
  id: string
  category: ValidationCategory
  command: string
  status: ValidationStatus
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
  evidence: string[]
  assumptions: string[]
  unverifiedAreas: string[]
  issue?: string
  fixed?: boolean
}

export type ValidationPlan = {
  projectType: 'electron' | 'web' | 'python' | 'generic'
  changedFiles: string[]
  requiredChecks: ValidationCategory[]
  optionalChecks: ValidationCategory[]
}

export type ValidationFailureAnalysis = {
  category: 'syntax' | 'type' | 'build' | 'runtime' | 'dependency' | 'permission' | 'environment' | 'integration' | 'unknown'
  summary: string
  likelyRootCause: string
  fixHints: string[]
}

export type ValidationCommandOutcome = { code: number | null; stdout: string; stderr: string }

function validationId() {
  return `validation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const commandSets: Record<ValidationPlan['projectType'], Array<{ category: ValidationCategory; command: string }>> = {
  electron: [
    { category: 'typecheck', command: 'npm run typecheck' },
    { category: 'build', command: 'npm run build' },
    { category: 'security', command: 'npm run test:permissions' },
  ],
  web: [
    { category: 'typecheck', command: 'npm run typecheck' },
    { category: 'build', command: 'npm run build' },
    { category: 'unit', command: 'npm test -- --runInBand' },
  ],
  python: [
    { category: 'runtime', command: 'python -m compileall .' },
    { category: 'unit', command: 'pytest -q' },
  ],
  generic: [
    { category: 'typecheck', command: 'npm run typecheck' },
    { category: 'build', command: 'npm run build' },
  ],
}

export class ValidationEngine {
  private readonly runCommand: (command: string) => Promise<ValidationCommandOutcome>

  constructor(runCommand: (command: string) => Promise<ValidationCommandOutcome>) {
    this.runCommand = runCommand
  }

  async runValidationPlan(plan: ValidationPlan): Promise<ValidationResult[]> {
    const required = new Set(plan.requiredChecks)
    const optional = new Set(plan.optionalChecks)
    const selected = commandSets[plan.projectType].filter((item) => required.has(item.category) || optional.has(item.category))
    const commands = selected.length ? selected : commandSets[plan.projectType]
    const results: ValidationResult[] = []

    for (const item of commands) {
      const start = Date.now()
      let outcome: ValidationCommandOutcome
      try {
        outcome = await this.runCommand(item.command)
      } catch (error) {
        outcome = { code: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
      }
      const durationMs = Date.now() - start
      const status: ValidationStatus = outcome.code === 0 ? 'passed' : outcome.code === null ? 'blocked' : 'failed'
      const issue = status === 'failed' || status === 'blocked' ? this.extractIssue(outcome.stdout, outcome.stderr) : undefined
      results.push({
        id: validationId(), category: item.category, command: item.command, status,
        exitCode: outcome.code, durationMs,
        stdout: this.trim(outcome.stdout, 12_000), stderr: this.trim(outcome.stderr, 12_000),
        evidence: status === 'passed' ? ['komut başarılı olarak tamamlandı'] : [],
        assumptions: ['komut çıktısı ve exit code doğrulama kanıtı olarak kullanıldı'],
        unverifiedAreas: status === 'passed' ? [] : ['hata öncesi çalışma davranışı doğrudan doğrulanmadı'],
        ...(issue ? { issue } : {}),
      })
    }
    return results
  }

  private extractIssue(stdout: string, stderr: string): string {
    const combined = `${stdout}\n${stderr}`.trim()
    return combined ? combined.slice(0, 400) : 'Komut hata döndürdü ancak açıklayıcı çıktı üretmedi.'
  }

  private trim(value: string, max: number): string {
    return String(value ?? '').slice(0, max)
  }

  static analyzeFailure(output: string): ValidationFailureAnalysis {
    const text = String(output ?? '').toLocaleLowerCase('en-US')
    if (/syntaxerror|unexpected token|missing semicolon|parse error/.test(text)) return { category: 'syntax', summary: 'Sözdizimi hatası tespit edildi.', likelyRootCause: 'Derleme öncesi sözdizimi bozuldu.', fixHints: ['Tür ve sözdizimi hatalarını kontrol et.', 'Değişikliği küçük parçalara ayır.', 'Aynı dosyadaki komut sırasını doğrula.'] }
    if (/cannot find module|module not found|importerror|no matching distribution/.test(text)) return { category: 'dependency', summary: 'Bağımlılık eksik veya uyumsuz.', likelyRootCause: 'Paket veya modül çözümü bozuldu.', fixHints: ['Manifest ve lockfile dosyalarını kontrol et.', 'Kurulu bağımlılıkları doğrula.'] }
    if (/ts(2345|2322|2554)|type .* is not assignable|property .* does not exist/.test(text)) return { category: 'type', summary: 'Tür hatası tespit edildi.', likelyRootCause: 'Tip sözleşmesi veya kullanım değişti.', fixHints: ['Tipleri netleştir.', 'Bileşen ve ara yüz tiplerini kontrol et.'] }
    if (/build failed|compilation failed|vite build|electron-builder|error:/.test(text)) return { category: 'build', summary: 'Derleme veya build hatası.', likelyRootCause: 'Build pipeline veya yapılandırma başarısız oldu.', fixHints: ['Derleme komutunu tek başına çalıştır.', 'Oluşturulan artefaktı doğrula.'] }
    if (/timed out|econnrefused|connection refused|network error/.test(text)) return { category: 'integration', summary: 'İntegrasyon veya ağ bağlantısı sorunu.', likelyRootCause: 'Harici servis veya bağımlılık erişilemiyor.', fixHints: ['Bağlantı hedefini kontrol et.', 'Offline test veya mock kullan.'] }
    if (/permission denied|eacces|eperm|access denied/.test(text)) return { category: 'permission', summary: 'İzin hatası tespit edildi.', likelyRootCause: 'İşletim sistemi veya uygulama erişimi reddetti.', fixHints: ['İzin katmanını kontrol et.', 'Ayrıcalık gerektiren komut için onay iste.'] }
    if (/environment|not recognized|command not found|not found/.test(text)) return { category: 'environment', summary: 'Geliştirme ortamı veya komut bulunamadı.', likelyRootCause: 'Gerekli araç PATH üzerinde değil veya kurulu değil.', fixHints: ['Ortam araçlarını ve sürümlerini denetle.', 'Komutun gerçekten mevcut olduğunu doğrula.'] }
    return { category: 'unknown', summary: 'Hata türü net değil.', likelyRootCause: 'Çıktı yeterince ayrıntılı değil; manuel inceleme gerekli.', fixHints: ['İlgili stack trace satırlarını incele.', 'Hedef testi küçük adımda yeniden çalıştır.'] }
  }
}
