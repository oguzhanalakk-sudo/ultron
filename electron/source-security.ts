export type SecurityFinding = {
  rule: string
  severity: 'high' | 'medium'
  path: string
  line: number
  summary: string
  recommendation: string
}

type Rule = { id: string; severity: SecurityFinding['severity']; pattern: RegExp; summary: string; recommendation: string }

const rules: Rule[] = [
  { id: 'hardcoded-credential', severity: 'high', pattern: /\b(?:api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"][^'"\r\n]{8,}['"]/i, summary: 'Kaynak kodda sabit kimlik bilgisi olabilecek bir değer var.', recommendation: 'Değeri iptal edip ortam değişkenine veya güvenli gizli bilgi deposuna taşı.' },
  { id: 'dynamic-evaluation', severity: 'high', pattern: /\beval\s*\(|\bnew\s+Function\s*\(/i, summary: 'Dinamik kod değerlendirmesi kullanılıyor.', recommendation: 'Mümkünse veri odaklı ayrıştırma kullan; girişleri doğrula ve bu çağrının kaynağını kısıtla.' },
  { id: 'unsafe-deserialization', severity: 'high', pattern: /\bpickle\.(?:load|loads)\s*\(|\byaml\.load\s*\(/i, summary: 'Güvenilmeyen veride kod çalıştırabilen serileştirme/ayrıştırma API’si kullanılıyor olabilir.', recommendation: 'Güvenli ayrıştırıcıya geç veya verinin kaynağını doğrula; YAML için SafeLoader kullan.' },
  { id: 'shell-command-construction', severity: 'high', pattern: /\b(?:exec|execSync)\s*\(\s*[^\n]{0,180}\+|\bsubprocess\.(?:run|Popen|call)\s*\(\s*[^\n]{0,180}shell\s*=\s*True/i, summary: 'Komut çalıştırma girdiye bağlı metin birleştirmesi veya shell modu içeriyor olabilir.', recommendation: 'Komutu argüman dizisiyle çalıştır; dış girdiyi komut metnine ekleme.' },
  { id: 'unsafe-html-injection', severity: 'medium', pattern: /\bdangerouslySetInnerHTML\b|\binnerHTML\s*=/i, summary: 'HTML enjeksiyonuna açık olabilecek bir DOM/API kullanımı var.', recommendation: 'İçeriği güvenilir bir sanitizer ile temizle veya metin düğümü olarak göster.' },
]

export function analyzeSourceSecurity(files: { path: string; content: string }[]): SecurityFinding[] {
  const findings: SecurityFinding[] = []
  for (const file of files) {
    const lines = file.content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      for (const rule of rules) {
        if (!rule.pattern.test(line)) continue
        findings.push({ rule: rule.id, severity: rule.severity, path: file.path, line: index + 1, summary: rule.summary, recommendation: rule.recommendation })
        if (findings.length >= 200) return findings
      }
    }
  }
  return findings
}
