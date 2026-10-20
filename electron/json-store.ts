// Ultron sürümlü JSON deposu: uygulama içi kalıcı veriler (eklenti durumu, yazılım
// kataloğu, dosya indeksi, arama geçmişi) için tek tip şema.
// SQLite yok; mevcut proje mimarisi dosya tabanlı JSON kullandığı için talimattaki
// tablo adları bu depolara uyarlanır (bkz. docs/technical-status.md).
// Saf işlevler; dosya erişimi yalnızca async zarf üzerinden, atomik yazıyla yapılır.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomically } from './atomic-json.ts'

export type StoredDocument<T> = { version: number; updatedAt: string; data: T }
export type Migration<T> = { from: number; to: number; migrate: (data: unknown) => unknown }

// Kullanımdaki tablo-adı → depo-dosyası uyarlaması (talimat bölüm 10):
export type KnownStoreId =
  | 'plugins'            // → plugins + plugin_versions + plugin_permissions + plugin_sources + plugin_dependencies
  | 'plugins-backup'     // → geri alma (rollback) kopyaları
  | 'installed_software' // → installed_software
  | 'application_adapters' // → application_adapters (adaptör test kayıtları)
  | 'file_index'         // → file_index
  | 'file_search_history' // → file_search_history
  | 'plugin_runtime'     // → plugin son çalışma/hata kayıtları

export function storeFileName(id: KnownStoreId): string {
  const map: Record<KnownStoreId, string> = {
    plugins: 'plugins.json',
    'plugins-backup': 'plugins-backup.json',
    installed_software: 'software-catalog.json',
    application_adapters: 'adapter-results.json',
    file_index: 'file-index.json',
    file_search_history: 'file-search-history.json',
    plugin_runtime: 'plugin-runtime.json',
  }
  return map[id]
}

// Şema sürümü desteklenmiyorsa (daha yeni, bilinmeyen sürüm) veriyi bozmadan döndürür?
// Hayır: daha yeni sürümü eski uygulama yazarsa veri kaybı olur; bunu engellemek için
// daha yeni sürüm okunduğunda hata fırlatılır, dosya değiştirilmez.
export class StoreVersionError extends Error {
  constructor(apiVersion: number, fileVersion: number) {
    super(`Depo şeması bu sürümden daha yeni (dosya: v${fileVersion}, uygulama: v${apiVersion}). Dosya değiştirilmedi.`)
    this.name = 'StoreVersionError'
  }
}

// Veri şemasını günceller: version uyuşmuyorsa kayıtlı migration zinciri uygulanır.
// Migration yoksa ve sürüm atlanmışsa, _legacy alanında ham veriyi saklamak yerine
// güvenli davranış: eksik alanları varsayılanla doldurup sürümü yükselt (yıkıcı olmayan).
export function migrateDocument<T>(raw: unknown, options: {
  currentVersion: number
  fallback: () => T
  migrations: Migration<T>[]
  validate?: (data: T) => boolean
}): StoredDocument<T> {
  const now = new Date().toISOString()
  if (!raw || typeof raw !== 'object') return { version: options.currentVersion, updatedAt: now, data: options.fallback() }
  const document = raw as { version?: unknown; data?: unknown; updatedAt?: unknown }
  if (typeof document.version !== 'number' || !Number.isInteger(document.version)) return { version: options.currentVersion, updatedAt: now, data: options.fallback() }
  let version = document.version
  let data: unknown = document.data
  if (version > options.currentVersion) throw new StoreVersionError(options.currentVersion, version)
  for (const migration of options.migrations) {
    if (version < migration.to && version >= migration.from) {
      data = migration.migrate(data)
      version = migration.to
    }
  }
  if (version !== options.currentVersion) data = options.fallback()
  let typed = data as T
  if (options.validate && !options.validate(typed)) {
    typed = options.fallback()
  }
  return { version: options.currentVersion, updatedAt: typeof document.updatedAt === 'string' ? document.updatedAt : now, data: typed }
}

export function createJsonStore<T>(options: {
  currentVersion: number
  fallback: () => T
  migrations: Migration<T>[]
  validate?: (data: T) => boolean
}) {
  const read = async (file: string): Promise<StoredDocument<T>> => {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
      return migrateDocument(raw, options)
    } catch (error) {
      if (error instanceof StoreVersionError) throw error
      // Bozuk veya eksik dosya: değerli veri kaybolmasın diye ham kopyayı yana sakla.
      try {
        const exists = await fs.stat(file).then(() => true, () => false)
        if (exists) await fs.copyFile(file, `${path.dirname(file)}/${path.basename(file)}.${Date.now()}.corrupt.bak`)
      } catch { /* yedekleme başarısız olsa da devam et */ }
      return { version: options.currentVersion, updatedAt: new Date().toISOString(), data: options.fallback() }
    }
  }
  const write = async (file: string, data: T) => {
    await writeJsonAtomically(file, { version: options.currentVersion, updatedAt: new Date().toISOString(), data })
  }
  return { read, write }
}
