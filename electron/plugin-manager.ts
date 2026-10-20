// Ultron Plugin Manager (saf çekirdek):
// - manifest doğrulama (katı alan kümesi, slug ve sürüm kuralları)
// - sürüm karşılaştırma ve semver-lite aralık kontrolü
// - bağımlılık ve araç-adı çakışma denetimleri
// - eklenti veri yolu güvenliği (plugin veri klasörü dışına çıkmaz)
// Runtime (fork, kurulum dosya işlemleri) main.ts tarafında; bu modül saf işlevleri sunar.
import { createHash } from 'node:crypto'
import path from 'node:path'

export const allowedPluginPermissions = ['storage', 'clipboard', 'network'] as const
export type PluginPermission = (typeof allowedPluginPermissions)[number]

export type PluginToolDef = {
  name: string
  description: string
  parameters?: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export type PluginManifest = {
  id: string
  name: string
  version: string
  entry: string
  description?: string
  tools: PluginToolDef[]
  permissions: PluginPermission[]
  dependencies?: Record<string, string>
}

export type ManifestValidationResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; errors: string[] }

const idPattern = /^[a-z][a-z0-9-]{2,31}$/
const toolNamePattern = /^[a-zA-Z][a-zA-Z0-9_-]{1,39}$/
const versionPattern = /^\d+\.\d+\.\d+$/
const jsonSchemaScalar = new Set(['string', 'number', 'boolean', 'integer', 'array', 'object'])

export function validateManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['manifest.json okunamadı veya boş.'] }
  const candidate = raw as Record<string, unknown>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  if (!id) errors.push('id alanı zorunludur (örn. "ornek-eklenti").')
  else if (!idPattern.test(id)) errors.push('id biçimi geçersiz: küçük harf/sayı/tire, 3-32 karakter, harfle başlar.')
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  if (!name || name.length > 80) errors.push('name alanı zorunludur (en fazla 80 karakter).')
  const version = typeof candidate.version === 'string' ? candidate.version.trim() : ''
  if (!versionPattern.test(version ?? '')) errors.push('version biçimi X.Y.Z olmalıdır (örn. 1.2.0).')
  const entry = typeof candidate.entry === 'string' ? candidate.entry.trim() : ''
  if (!entry) errors.push('entry alanı zorunludur (örn. "main.js").')
  else if (!/\.c?js$/i.test(entry)) errors.push('entry yalnızca .js/.cjs olabilir.')
  else if (path.isAbsolute(entry) || entry.includes('..') || entry.replace(/\\/g, '/').startsWith('/')) errors.push('entry göreli ve içinde olmalıdır ( ".." veya mutlak yol geçersiz).')
  const description = typeof candidate.description === 'string' ? candidate.description.trim().slice(0, 400) : undefined
  const toolsRaw = candidate.tools
  if (!Array.isArray(toolsRaw) || toolsRaw.length === 0) errors.push('tools alanı en az bir araç tanımlamalıdır.')
  const tools: PluginToolDef[] = []
  if (Array.isArray(toolsRaw)) {
    const seen = new Set<string>()
    for (const item of toolsRaw) {
      if (!item || typeof item !== 'object') { errors.push('tools öğesi nesne olmalıdır.'); continue }
      const tool = item as Record<string, unknown>
      const toolName = typeof tool.name === 'string' ? tool.name.trim() : ''
      if (!toolNamePattern.test(toolName)) { errors.push(`araç adı geçersiz: ${JSON.stringify(toolName)}`); continue }
      if (seen.has(toolName)) { errors.push(`araç adı tekrarlı: ${toolName}`); continue }
      seen.add(toolName)
      const toolDescription = typeof tool.description === 'string' ? tool.description.trim().slice(0, 400) : ''
      if (!toolDescription) errors.push(`"${toolName}".description boş olamaz.`)
      parameters: {
        const rawParameters = tool.parameters
        if (rawParameters === undefined || rawParameters === null) { tools.push({ name: toolName, description: toolDescription }); break parameters }
        if (typeof rawParameters !== 'object') { errors.push(`"${toolName}".parameters nesne olmalıdır.`); break parameters }
        const parameters = rawParameters as { type?: unknown; properties?: unknown; required?: unknown }
        if (parameters.type !== 'object') { errors.push(`"${toolName}".parameters.type "object" olmalıdır.`); break parameters }
        if (!parameters.properties || typeof parameters.properties !== 'object' || Array.isArray(parameters.properties)) { errors.push(`"${toolName}".parameters.properties eksik.`); break parameters }
        const properties = parameters.properties as Record<string, unknown>
        for (const [key, value] of Object.entries(properties)) {
          const type = (value as { type?: unknown })?.type
          if (typeof type !== 'string' || !jsonSchemaScalar.has(type)) { errors.push(`"${toolName}" parametre "${key}" için geçerli type yok (string|number|boolean|integer|array|object).`); break }
        }
        let required: string[] | undefined
        if (Array.isArray(parameters.required)) {
          required = parameters.required.filter((item): item is string => typeof item === 'string')
          for (const name of required) if (!(name in properties)) errors.push(`"${toolName}".required "${name}" parametrede tanımlı değil.`)
        }
        tools.push({ name: toolName, description: toolDescription, parameters: { type: 'object', properties, ...(required ? { required } : {}) } })
      }
    }
  }
  const permissionsRaw = candidate.permissions
  const permissions: PluginPermission[] = []
  if (permissionsRaw !== undefined) {
    if (!Array.isArray(permissionsRaw)) errors.push('permissions alanı dizi olmalıdır.')
    else {
      for (const item of permissionsRaw) {
        if (typeof item !== 'string' || !(allowedPluginPermissions as readonly string[]).includes(item)) {
          errors.push(`izin geçersiz: ${JSON.stringify(item)}. Geçerli izinler: ${allowedPluginPermissions.join(', ')}.`)
          continue
        }
        if (!permissions.includes(item as PluginPermission)) permissions.push(item as PluginPermission)
      }
    }
  }
  let dependencies: Record<string, string> | undefined
  if (candidate.dependencies !== undefined) {
    if (!candidate.dependencies || typeof candidate.dependencies !== 'object' || Array.isArray(candidate.dependencies)) {
      errors.push('dependencies alanı {eklentiId: aralık} nesnesi olmalıdır.')
    } else {
      dependencies = {}
      for (const [key, value] of Object.entries(candidate.dependencies as Record<string, unknown>)) {
        if (!idPattern.test(key)) { errors.push(`bağımlılık id geçersiz: ${key}`); continue }
        if (typeof value !== 'string' || !/^(\^|>=)?\d+\.\d+\.\d+$/.test(value)) { errors.push(`bağımlılık aralığı geçersiz: ${key} → ${JSON.stringify(value)} (X.Y.Z, ^X.Y.Z veya >=X.Y.Z)`); continue }
        dependencies[key] = value
      }
    }
  }
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    manifest: {
      id, name, version,
      entry: entry.replace(/\\/g, '/'),
      ...(description ? { description } : {}),
      tools,
      permissions,
      ...(dependencies && Object.keys(dependencies).length ? { dependencies } : {}),
    },
  }
}

// semver-lite: numeric tuple karşılaştırması (X.Y.Z)
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [a1, a2, a3] = parse(a)
  const [b1, b2, b3] = parse(b)
  if (a1 !== b1) return a1 - b1
  if (a2 !== b2) return a2 - b2
  return a3 - b3
}

// aralık desteği: "1.2.3" (tam), "^1.2.3" (aynı major, >=), ">=1.2.3"
export function satisfiesRange(version: string, range: string): boolean {
  const normalized = range.trim()
  if (normalized.startsWith('^')) {
    const base = normalized.slice(1)
    return version === base || (compareVersions(version, base) >= 0 && version.split('.')[0] === base.split('.')[0])
  }
  if (normalized.startsWith('>=')) return compareVersions(version, normalized.slice(2)) >= 0
  return version === normalized
}

export type DependencyIssue = { id: string; required: string; installed: string | null }

export function checkDependencies(manifest: PluginManifest, installed: Record<string, string>): DependencyIssue[] {
  if (!manifest.dependencies) return []
  const issues: DependencyIssue[] = []
  for (const [id, range] of Object.entries(manifest.dependencies)) {
    const installedVersion = installed[id] ?? null
    if (!installedVersion || !satisfiesRange(installedVersion, range)) issues.push({ id, required: range, installed: installedVersion })
  }
  return issues
}

export type EnabledPluginTools = { id: string; toolNames: string[] }

// Çakışma denetimi: aynı araç adı iki etkin eklentide tanımlanamaz.
export function checkToolConflicts(candidate: PluginManifest, enabled: EnabledPluginTools[]): string[] {
  const conflicts: string[] = []
  const candidateNames = new Set(candidate.tools.map((tool) => tool.name))
  for (const other of enabled) {
    if (other.id === candidate.id) continue
    for (const toolName of other.toolNames) {
      if (candidateNames.has(toolName)) conflicts.push(`${candidate.id} ↔ ${other.id}: "${toolName}"`)
    }
  }
  return conflicts
}

// Eklenti agent araç adı: model ile paylaşılacak benzersiz ad.
export function pluginAgentToolName(pluginId: string, toolName: string): string {
  return `plugin_${pluginId}_${toolName}`
}

// Eklenti veri yolu: yalnızca <base>/<pluginId>/ içinde olabilir.
export function pluginDataPath(base: string, pluginId: string, relative: string): string | null {
  if (!idPattern.test(pluginId)) return null
  const clean = relative.replace(/\\/g, '/')
  if (clean.includes('..') || path.isAbsolute(clean) || clean.startsWith('/')) return null
  const target = path.resolve(base, pluginId, clean || 'data.json')
  const scopedRoot = path.resolve(base, pluginId)
  if (!target.startsWith(scopedRoot + path.sep) && target !== scopedRoot) return null
  return target
}

export type PluginStateEntry = {
  id: string
  version: string
  enabled: boolean
  permissions: PluginPermission[]
  installedAt: string
  updatedAt: string
  lastRunAt?: string
  lastRunCallCount?: number
  lastError?: string
  checksum?: string
  name?: string
}

export type PluginStateFile = {
  version: 1
  plugins: Record<string, PluginStateEntry>
}

export function defaultPluginState(): PluginStateFile {
  return { version: 1, plugins: {} }
}

// Paket imzası: dosya yolları + içerik hash'leri (tutarlı sıralama ile)
export function computePackageChecksum(files: Array<{ relativePath: string; content: Buffer | string }>): string {
  const hash = createHash('sha256')
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  for (const file of sorted) {
    hash.update(file.relativePath)
    hash.update('\u0000')
    hash.update(typeof file.content === 'string' ? file.content : file.content)
  }
  return hash.digest('hex')
}

export function isPluginAgentToolName(name: string): boolean {
  return /^plugin_[a-z0-9-]+_[a-zA-Z][a-zA-Z0-9_-]{1,39}$/.test(name)
}

export function parsePluginAgentToolName(name: string): { pluginId: string; toolName: string } | null {
  const match = /^plugin_([a-z0-9-]+)_([a-zA-Z][a-zA-Z0-9_-]{1,39})$/.exec(name)
  if (!match) return null
  return { pluginId: match[1], toolName: match[2] }
}
