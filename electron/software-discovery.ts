// Ultron Software Discovery: Windows'ta yüklü yazılım, kısayol ve PATH araçlarının
// tespiti. Reader'lar enjekte edilir; ayrıştırma saf işlevlerle test edilebilir.
// Registry erişimi yalnızca Standart Uninstall anahtarlarıymış gibi salt-okunur reg query.
import path from 'node:path'

export type SoftwareSource = 'registry' | 'start-menu' | 'path' | 'known'

export type SoftwareEntry = {
  name: string
  version: string | null
  publisher: string | null
  installLocation: string | null
  /** Kullanılabilir çalıştırılabilir yolu (launch için). path kaynağında dolu. */
  executablePath: string | null
  source: SoftwareSource
  categories: string[]
  capabilities: string[]
}

export type RegistryEntry = {
  keyPath: string
  displayName: string | null
  version: string | null
  publisher: string | null
  installLocation: string | null
  systemComponent: boolean
}

// reg query çıktısı bloklarıdır: "AnahtarPath" satırı + girinti 4 boşluklu DeğerAd Tür Değer satırları.
export function parseRegQueryEntries(stdout: string): RegistryEntry[] {
  const entries: RegistryEntry[] = []
  let current: RegistryEntry | null = null
  const keyLine = /^(?:HKEY_[A-Z_]+\\[^\r\n]*)$/
  const valueLine = /^\s{4}([^\r\n]+?)\s{2,}([A-Z_]+)\s+(.*)$/
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.replace(/\u0000/g, '').trimEnd()
    if (!line.trim()) continue
    if (keyLine.test(line.trim())) {
      current = { keyPath: line.trim(), displayName: null, version: null, publisher: null, installLocation: null, systemComponent: false }
      entries.push(current)
      continue
    }
    if (!current) continue
    const valueMatch = line.match(valueLine)
    if (!valueMatch) continue
    const [, rawName, type, rawValue] = valueMatch
    if (type !== 'REG_SZ' && type !== 'REG_DWORD') continue
    const name = rawName.trim()
    const value = rawValue.trim()
    if (name === 'DisplayName') current.displayName = value
    else if (name === 'DisplayVersion') current.version = value
    else if (name === 'Publisher') current.publisher = value
    else if (name === 'InstallLocation') current.installLocation = value
    else if (name === 'SystemComponent' && type === 'REG_DWORD') current.systemComponent = value.startsWith('0x1')
  }
  return entries.filter((entry) => entry.displayName)
}

// Girdileri birleştirir (isim benzerliği değil kesin küçük-harf eşliği), bilinen
// sistem bileşenlerini ve boş ada sahip olanları dışlar.
export function buildSoftwareCatalog(registryEntries: RegistryEntry[], extras: Array<{ name: string; version?: string | null; publisher?: string | null; executablePath?: string | null; source: SoftwareSource }> = []): SoftwareEntry[] {
  const merged = new Map<string, SoftwareEntry>()
  for (const entry of registryEntries) {
    const name = (entry.displayName ?? '').trim()
    if (!name) continue
    if (entry.systemComponent) continue
    const key = name.toLocaleLowerCase('tr-TR')
    const category = categorizeSoftware(name, entry.publisher)
    merged.set(key, {
      name,
      version: entry.version,
      publisher: entry.publisher,
      installLocation: entry.installLocation,
      executablePath: null,
      source: 'registry',
      categories: [category],
      capabilities: capabilityNamesForSoftware(name, category),
    })
  }
  for (const extra of extras) {
    const name = extra.name.trim()
    if (!name) continue
    const key = name.toLocaleLowerCase('tr-TR')
    const category = categorizeSoftware(name, extra.publisher ?? null)
    const existing = merged.get(key)
    if (existing) {
      existing.executablePath ??= extra.executablePath ?? null
      existing.categories = [...new Set([...existing.categories, category])]
      existing.capabilities = [...new Set([...existing.capabilities, ...capabilityNamesForSoftware(name, category)])]
      continue
    }
    merged.set(key, {
      name,
      version: extra.version ?? null,
      publisher: extra.publisher ?? null,
      installLocation: null,
      executablePath: extra.executablePath ?? null,
      source: extra.source,
      categories: [category],
      capabilities: capabilityNamesForSoftware(name, category),
    })
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'))
}

const categoryKeywords: Array<{ category: string; patterns: RegExp[] }> = [
  { category: 'geliştirme', patterns: [/visual studio|vs code|code\..*electron|node\.?j?t?|python|intellij|android studio|pycharm|git(?![\p{L}\p{N}])|github|gitlab|docker|dotnet|\.net|jdk|gradle|maven|cmake|ninja|rust|golang|php|ruby|perl|xcode|sublime|notepad\+\+|phpstorm|goland|clion|webstorm|.cursor|trae|qt|ventoy/iu] },
  { category: 'ofis', patterns: [/office|word|excel|powerpoint|outlook|onenote|access|libreoffice|openoffice|wps|notion|obsidian|typora/iu] },
  { category: 'tarayıcı', patterns: [/chrome|firefox|edge|brave|opera|safari|vivaldi|thorium/iu] },
  { category: 'medya', patterns: [/photoshop|illustrator|premiere|after effects|davinci|blender|gimp|inkscape|krita|audacity|vlc|musescore|shotcut|openshot|handbrake|ffmpeg|obs|paint\.net|paintdotnet|figma|canva|affinity/iu] },
  { category: 'sistem', patterns: [/driver|nvidia|amd|radeon|runtime|redistribut|wolfram|pdf|7-?zip|winrar|peazip|sistem|microsoft visual (?:c\+\+|redistributable)|.net framework|update|service|antivir|kaspersky|avast|avg|malware/iu] },
]

export function categorizeSoftware(name: string, publisher: string | null): string {
  for (const { category, patterns } of categoryKeywords) {
    if (patterns.some((pattern) => pattern.test(name))) return category
  }
  if (publisher && /microsoft|google|mozilla|adobe/i.test(publisher)) {
    if (/microsoft/i.test(publisher)) return 'sistem'
    return 'diğer'
  }
  return 'diğer'
}

// Bilinen gerçek kontrol yetenekleri; hayalî yetenek üretilmez.
const capabilityKeywords: Array<{ capability: string; patterns: RegExp[] }> = [
  { capability: 'cli-control', patterns: [/git(?![\p{L}\p{N}])|node\.?j?t?|npm|python|docker|ollama|\.?net|dotnet|7-?zip|ffmpeg|scratch|cmake|gradle|maven|cargo|go\b/iu] },
  { capability: 'launch', patterns: [/./iu] },
  { capability: 'editor-open', patterns: [/vs code|visual studio code|code\.exe|notepad|sublime|notepad\+\+|intellij|pycharm/iu] },
]

export function capabilityNamesForSoftware(name: string, category: string): string[] {
  const capabilities = new Set<string>()
  for (const { capability, patterns } of capabilityKeywords) {
    if (capability === 'launch' || patterns.some((pattern) => pattern.test(name) || pattern.test(category)))
      capabilities.add(capability)
  }
  return [...capabilities]
}

// --- PATH araç tespiti (where.exe çıktısı) ---
export const pathToolNames = ['git', 'node', 'npm', 'npx', 'python', 'python3', 'pip', 'pip3', 'code', 'docker', 'ollama', 'dotnet', 'java', 'javac', 'gradle', 'mvn', 'cmake', 'ninja', 'cargo', 'rustc', 'go', 'gcc', 'g++', 'cl', 'tsc', 'sqlite3', 'psql', 'mysql', 'ffmpeg', '7z', '7za', 'pwsh', 'powershell', 'zip', 'tar', 'curl', 'winget']

export function parseWhereOutput(toolName: string, stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  if (!firstLine) return null
  if (!/\.(?:exe|cmd|bat|com|ps1)$/i.test(firstLine)) {
    // 'where' PATH üstünde başka betikler de döndürebilir; en azından yürütebilir türde kal
    if (!/\.(?:exe|cmd|bat)$/i.test(firstLine)) return null
  }
  return firstLine
}

// --- Başlat menüsü kısayolları (salt isim listesi) ---
export function shortcutNameFromFileName(fileName: string): string | null {
  if (!fileName.toLowerCase().endsWith('.lnk')) return null
  const base = fileName.slice(0, -'.lnk'.length)
  // "Suren Uygulama (32-bit)" gibi ekleri korur; kaba temizlik yapar
  const cleaned = base.replace(/\s*\(\d+-bit\)\s*$/i, '').trim()
  return cleaned || null
}

export function buildShortcutEntries(names: string[]): SoftwareEntry[] {
  const entries: SoftwareEntry[] = []
  for (const name of names) {
    const cleaned = shortcutNameFromFileName(name)
    if (!cleaned) continue
    const category = categorizeSoftware(cleaned, null)
    entries.push({
      name: cleaned,
      version: null,
      publisher: null,
      installLocation: null,
      executablePath: null,
      source: 'start-menu',
      categories: [category],
      capabilities: capabilityNamesForSoftware(cleaned, category),
    })
  }
  return dedupeCatalog([...entries])
}

export function dedupeCatalog(entries: SoftwareEntry[]): SoftwareEntry[] {
  const merged = new Map<string, SoftwareEntry>()
  const priority: Record<SoftwareSource, number> = { registry: 3, path: 2, 'start-menu': 1, known: 0 }
  for (const entry of entries) {
    const key = entry.name.toLocaleLowerCase('tr-TR')
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, { ...entry })
      continue
    }
    const preferred = priority[entry.source] > priority[existing.source] ? entry : existing
    const other = preferred === entry ? existing : entry
    merged.set(key, {
      ...preferred,
      version: preferred.version ?? other.version,
      publisher: preferred.publisher ?? other.publisher,
      installLocation: preferred.installLocation ?? other.installLocation,
      executablePath: preferred.executablePath ?? other.executablePath,
      categories: [...new Set([...preferred.categories, ...other.categories])],
      capabilities: [...new Set([...preferred.capabilities, ...other.capabilities])],
    })
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'))
}

// eksik yetenek raporu (yetenek ihtiyaç dili → gerçek, bilinen öneriler)
export type CapabilityNeed = {
  id: string
  label: string
  extensions: string[]
  builtIn: string | null
  suggestions: Array<{ name: string; downloadUrl: string; role: string }>
}

export const capabilityNeeds: CapabilityNeed[] = [
  {
    id: 'pdf',
    label: 'PDF üzerinde çalışma',
    extensions: ['.pdf'],
    builtIn: 'Ultron: PDF metin katmanı yerel çözümleyici (metin araması için) mevcuttur.',
    suggestions: [],
  },
  {
    id: 'docx-xlsx',
    label: 'Word/Excel (.docx/.xlsx) okuma',
    extensions: ['.docx', '.xlsx'],
    builtIn: 'Ultron: ZIP+XML tabanlı yerel okuyucu; metin/hücre değerlerini çıkarır.',
    suggestions: [
      { name: 'LibreOffice', downloadUrl: 'https://www.libreoffice.org/', role: 'Tam ofis düzenleme/sanal yazıcı dönüştürme' },
    ],
  },
  {
    id: 'doc-xls-legacy',
    label: 'Eski Word/Excel (.doc/.xls) okuma',
    extensions: ['.doc', '.xls'],
    builtIn: null,
    suggestions: [
      { name: 'LibreOffice', downloadUrl: 'https://www.libreoffice.org/', role: 'Eski biçimleri dönüştürür veya açar' },
    ],
  },
  {
    id: 'image-edit',
    label: 'Görsel düzenleme',
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    builtIn: null,
    suggestions: [
      { name: 'GIMP', downloadUrl: 'https://www.gimp.org/', role: 'Açık kaynak görsel düzenleme' },
      { name: 'Krita', downloadUrl: 'https://krita.org/', role: 'Dijital çizim ve düzenleme' },
     {
       name: 'ImageMagick',
       downloadUrl: 'https://imagemagick.org/',
       role: 'CLI ile toplu dönüştürme (cli-control yeteneği)'
     },
    ],
  },
  {
    id: 'video-edit',
    label: 'Video kesme/birleştirme',
    extensions: ['.mp4', '.avi', '.mkv', '.mov'],
    builtIn: null,
    suggestions: [
      { name: 'FFmpeg', downloadUrl: 'https://ffmpeg.org/', role: 'CLI ile kesme/birleştirme/dönüştürme' },
      { name: 'Shotcut', downloadUrl: 'https://shotcut.org/', role: 'Grafik arayüzlü düzenleme' },
    ],
  },
  {
    id: 'archive',
    label: 'Arşiv açma/paketleme',
    extensions: ['.zip', '.rar', '.7z'],
    builtIn: 'Ultron: .zip açma (zip-lite) yerel destekle; .rar/.7z desteklenmiyor.',
    suggestions: [
      { name: '7-Zip', downloadUrl: 'https://www.7-zip.org/', role: 'geniş biçim desteği (ayrıca cli-control)' },
    ],
  },
  {
    id: 'cad',
    label: 'CAD/drawing dosyaları',
    extensions: ['.dwg', '.dxf', '.skp', '.step'],
    builtIn: null,
    suggestions: [],
  },
  {
    id: 'python',
    label: 'Python çalıştırma/betikler',
    extensions: ['.py'],
    builtIn: null,
    suggestions: [
      { name: 'Python', downloadUrl: 'https://www.python.org/downloads/', role: 'Resmî Python dağıtımı' },
    ],
  },
]

export function reportCapabilityNeed(requestText: string, software: SoftwareEntry[]): { need: CapabilityNeed; installedHits: SoftwareEntry[] } | null {
  const lower = requestText.toLowerCase()
  const need = capabilityNeeds.find((item) => {
    const matched = item.extensions.some((extension) => lower.includes(extension.replace('.', '')))
    const byId = lower.includes(item.id)
    const byLabelWords = item.label.toLocaleLowerCase('tr-TR').split(/[ /\-]/).filter((word) => word.length >= 4 && !['için', 'okuma', ' üzerinde', 'çalışma', 'kesme', 'açma', 'dosyaları', 'paketleme'].includes(word)).some((word) => lower.includes(word.toLowerCase()))
    return matched || byId || byLabelWords
  })
  if (!need) return null
  const keywords: Record<string, RegExp[]> = {
    pdf: [/pdf/iu],
    'docx-xlsx': [/word|excel|office|libreoffice/iu],
    'doc-xls-legacy': [/word|excel|office|libreoffice/iu],
    'image-edit': [/gimp|krita|photoshop|paint\.?net|imagemagick|affinity/iu],
    'video-edit': [/ffmpeg|shotcut|premiere|davinci|handbrake|openshot/iu],
    archive: [/7-?zip|winrar|peazip/iu],
    cad: [/autocad|sketchup|freecad|inventor|solidworks/iu],
    python: [/python/iu],
  }
  const patterns = keywords[need.id] ?? []
  const installedHits = software.filter((entry) => patterns.some((pattern) => pattern.test(entry.name)))
  return { need, installedHits }
}
