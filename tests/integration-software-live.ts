// Geçici canlı doğrulama: gerçek reg.exe/where.exe çıktılarının parser'larla uyumu.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildShortcutEntries, buildSoftwareCatalog, parseRegQueryEntries, parseWhereOutput } from '../electron/software-discovery.ts'

const execFileAsync = promisify(execFile)

async function main() {
  // 1) gerçek registry çıktısı (tek anahtar, sınırlı)
  const { stdout } = await execFileAsync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s'], { windowsHide: true, encoding: 'utf8', timeout: 15_000, maxBuffer: 4_000_000 })
  const entries = parseRegQueryEntries(stdout)
  assert.ok(entries.length > 0, 'HKCU Uninstall taraması en az bir girdi vermeli')
  console.log(`[OK] registry: ${entries.length} girdi`)

  // 2) gerçek where.exe çıktısı
  const whereOut = await execFileAsync('where.exe', ['node'], { windowsHide: true, encoding: 'utf8', timeout: 6_000 }).then((r) => r.stdout, () => '')
  const nodePath = parseWhereOutput('node', whereOut)
  if (nodePath) {
    assert.ok(/\.(exe|cmd|bat)$/i.test(nodePath))
    console.log(`[OK] where.exe: node → ${nodePath}`)
  } else {
    console.log('[BILGI] node PATH üzerinde yok; where boş dönebilir (hata değil)')
  }

  // 3) Başlat menüsü kısayol sayımı (kullanıcı klasörü)
  const startMenu = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const shortcutNames: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3) return
    let list
    try { list = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const item of list) {
      const child = path.join(dir, item.name)
      if (item.isDirectory()) await walk(child, depth + 1)
      else if (item.isFile() && item.name.toLowerCase().endsWith('.lnk')) shortcutNames.push(item.name)
    }
  }
  await walk(startMenu, 0)
  const shortcutEntries = buildShortcutEntries(shortcutNames)
  console.log(`[OK] başlat menüsü: ${shortcutNames.length} .lnk → ${shortcutEntries.length} girdi`)

  // 4) katalog birleştirme: registry + where ecipleri
  const catalog = buildSoftwareCatalog(
    entries,
    nodePath ? [{ name: 'node', executablePath: nodePath, source: 'path' as const }] : [],
  )
  console.log(`[OK] katalog: ${catalog.length} birleşik girdi`)
  console.log('SOFTWARE-LIVE-PASS')
}

await main().catch((error) => { console.error('SOFTWARE-LIVE-FAIL', error); process.exit(1) })
