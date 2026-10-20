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
      name: 'web-durum', description: 'Şablon dosyası olmayan web şablonu', category: 'web',
      techStack: { language: 'typescript', framework: 'nextjs' }, features: [],
    }, { workspaceRoot })
    assert.equal(result.success, true)
    const projectRoot = path.join(workspaceRoot, 'web-durum')
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
