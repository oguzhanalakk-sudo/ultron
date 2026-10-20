#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../electron/project-generator.ts')
const args = process.argv.slice(2)

if (!args.length) {
  console.error('Kullanım: ultron <proje-adı> [--template <şablon>] [--directory <klasör>]')
  console.error('Örnek: ultron my-app --template nextjs-react')
  console.error('Şablonlar: ultron --list')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--experimental-strip-types', scriptPath, ...args], {
  stdio: 'inherit',
  windowsHide: true,
})

if (result.error) {
  console.error(`Ultron CLI başlatılamadı: ${result.error.message}`)
  process.exit(1)
}

if (result.signal) {
  console.error(`Proje üreticisi sinyal ile durdu: ${result.signal}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
