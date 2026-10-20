import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildProjectFromSpec, listTemplates, type ProjectSpec } from '../electron/project-scaffold.ts'

const spec: ProjectSpec = {
  name: 'safe-project', description: 'Scoped scaffold test', category: 'library',
  techStack: { language: 'typescript', framework: 'minimal' }, features: [],
}

async function listFilesRecursive(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await listFilesRecursive(full, rel))
    else files.push(rel)
  }
  return files
}

test('project scaffold yalnız verilen çalışma alanında yeni dosyalar oluşturur', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ultron-scaffold-'))
  try {
    const result = await buildProjectFromSpec(spec, { workspaceRoot })
    assert.equal(result.success, true)
    assert.equal(await stat(path.join(workspaceRoot, 'safe-project', 'README.md')).then(() => true), true)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('project scaffold çalışma alanından çıkış veren yolları reddeder', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ultron-scaffold-'))
  try {
    await assert.rejects(() => buildProjectFromSpec({ ...spec, name: '../outside' }, { workspaceRoot }), /kapsamı dışına|tek bir klasör/)
    const result = await buildProjectFromSpec({ ...spec, structure: { directories: ['../outside'], files: [] } }, { workspaceRoot })
    assert.equal(result.success, false)
    await assert.rejects(() => stat(path.join(workspaceRoot, 'safe-project')), /ENOENT/)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('şablon dosyaları eksikse boş dosya üretilmez, minimal iskelet ve uyarı döner', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ultron-scaffold-'))
  try {
    const result = await buildProjectFromSpec({
      name: 'masaustu-durum', description: 'Şablon dosyası olmayan masaüstü şablonu', category: 'desktop', templateId: 'tauri-react',
      techStack: { language: 'typescript', framework: 'tauri' }, features: [],
    }, { workspaceRoot })
    assert.equal(result.success, true)
    const projectRoot = path.join(workspaceRoot, 'masaustu-durum')
    const files = await listFilesRecursive(projectRoot)
    assert.ok(files.length > 0, 'En az bir dosya oluşmalı')
    for (const file of files) {
      const content = await readFile(path.join(projectRoot, file), 'utf8')
      assert.ok(content.trim().length > 0, `Boş dosya oluşturulmamalı: ${file}`)
    }
    assert.ok((result.warnings ?? []).length > 0, 'Eksik şablon dosyaları için uyarı dönmeli')
    assert.match(result.warnings[0], /bulunamadı|minimal iskelet/)
    assert.equal(result.templateName, 'Minimal Project', 'Uygulanan şablon adı sonuçta belirtilmeli')
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('şablon listesi kullanılabilirliği doğru bildirir', () => {
  const templates = listTemplates()
  assert.ok(templates.length > 0, 'En az bir şablon tanımlı olmalı')
  for (const template of templates) {
    assert.equal(typeof template.available, 'boolean', 'Her şablon için available alanı olmalı')
  }
})

test('yapı dosyası eksik şablona işaret ederse dosya atlanır ve uyarı üretilir', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ultron-scaffold-'))
  try {
    const result = await buildProjectFromSpec({
      ...spec,
      structure: { directories: [], files: [{ path: 'kaynak/ozel.ts', template: 'yok/olmayan.hbs' }] },
    }, { workspaceRoot })
    assert.equal(result.success, true)
    assert.ok(result.filesCreated.includes('kaynak/ozel.ts') === false, 'Eksik şablona bağlı dosya oluşturulmamalı')
    assert.ok((result.warnings ?? []).some((warning) => warning.includes('yok/olmayan.hbs')), 'Eksik şablon dosyası uyarıda belirtilmeli')
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('yerleşik şablonlar Minimal Project yerine gerçek çok dosyalı proje üretir', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ultron-scaffold-'))
  try {
    for (const template of listTemplates().filter((item) => item.available)) {
      const name = `proje-${template.id}`
      const result = await buildProjectFromSpec({
        name, description: 'Çok dosyalı üretim', category: template.category as ProjectSpec['category'], templateId: template.id,
        techStack: { language: 'typescript', framework: 'x' }, features: [],
      }, { workspaceRoot })
      assert.equal(result.success, true, `${template.id}: ${result.error}`)
      assert.notEqual(result.templateName, 'Minimal Project', template.id)
      assert.ok(result.filesCreated.length >= 5, `${template.id} en az 5 dosya üretmeli`)
      assert.equal(result.warnings.length, 0, `${template.id}: ${result.warnings.join('; ')}`)
    }
    assert.equal(listTemplates().find((item) => item.id === 'tauri-react')?.available, false)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('yerleşik şablon ikinci çalıştırmada mevcut dosyaları ezmez, atlar', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ultron-scaffold-'))
  const request: ProjectSpec = { name: 'api', description: 'x', category: 'api', templateId: 'fastapi-python', techStack: { language: 'python', framework: 'fastapi' }, features: [] }
  try {
    const first = await buildProjectFromSpec(request, { workspaceRoot })
    const target = path.join(workspaceRoot, 'api', 'app', 'main.py')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(target, '# kullanıcı değişikliği\n')
    const second = await buildProjectFromSpec(request, { workspaceRoot })
    assert.equal(second.filesCreated.length, 0)
    assert.equal(second.filesSkipped.length, first.filesCreated.length)
    assert.equal(await readFile(target, 'utf8'), '# kullanıcı değişikliği\n')
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
