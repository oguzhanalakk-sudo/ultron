import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { projectFingerprint } from '../electron/project-fingerprint.ts'

async function withFixture(run: (root: string) => Promise<void>) {
  const temporaryParent = path.resolve(os.tmpdir())
  const root = await mkdtemp(path.join(temporaryParent, 'kod-atolyesi-fingerprint-'))
  try { await run(root) }
  finally {
    assert.equal(path.dirname(path.resolve(root)), temporaryParent)
    assert.ok(path.basename(root).startsWith('kod-atolyesi-fingerprint-'))
    await rm(root, { recursive: true, force: true })
  }
}

async function fileInventory(root: string): Promise<string[]> {
  const result: string[] = []
  const visit = async (directory: string, relative: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name
      result.push(`${entry.isDirectory() ? 'directory' : 'file'}:${name}`)
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), name)
    }
  }
  await visit(root, '')
  return result.sort()
}

test('parmak izi içerik, ekleme, silme, dosya adı, klasör yolu ve .env değişikliğini algılar', async () => {
  await withFixture(async (root) => {
    const source = path.join(root, 'src')
    await mkdir(source)
    await writeFile(path.join(source, 'index.ts'), 'export const answer = 41\n')
    await writeFile(path.join(root, '.env'), 'TEST_VALUE=before\n')
    const original = await projectFingerprint([root])
    assert.equal(await projectFingerprint([root]), original, 'Değişmeyen proje aynı parmak izini vermeli')

    const before = await stat(path.join(source, 'index.ts'))
    await writeFile(path.join(source, 'index.ts'), 'export const answer = 42\n')
    await utimes(path.join(source, 'index.ts'), before.atime, before.mtime)
    const contentChanged = await projectFingerprint([root])
    assert.notEqual(contentChanged, original, 'Boyut ve mtime korunurken değişen içerik yakalanmalı')

    await writeFile(path.join(source, 'added.ts'), 'export const added = true\n')
    const fileAdded = await projectFingerprint([root])
    assert.notEqual(fileAdded, contentChanged, 'Yeni kaynak dosyası kanıtı geçersizleştirmeli')
    await unlink(path.join(source, 'added.ts'))
    assert.equal(await projectFingerprint([root]), contentChanged, 'Dosya kümesi eski haline dönünce digest eski değerine dönmeli')

    await rename(path.join(source, 'index.ts'), path.join(source, 'renamed.ts'))
    const fileRenamed = await projectFingerprint([root])
    assert.notEqual(fileRenamed, contentChanged, 'Aynı içerikli dosyanın yeni adı da parmak izine katılmalı')
    await rename(source, path.join(root, 'lib'))
    const pathChanged = await projectFingerprint([root])
    assert.notEqual(pathChanged, fileRenamed, 'Kaynak klasörünün yolu değişince digest değişmeli')

    await writeFile(path.join(root, '.env'), 'TEST_VALUE=after\n')
    const environmentChanged = await projectFingerprint([root])
    assert.notEqual(environmentChanged, pathChanged, 'Gizli yapılandırma okunabilir araçlara açılmadan doğrulama güncelliğine katılmalı')
    await unlink(path.join(root, 'lib', 'renamed.ts'))
    assert.notEqual(await projectFingerprint([root]), environmentChanged, 'Mevcut kaynak dosyasının silinmesi algılanmalı')
  })
})

test('CLI bin klasörü gerçek kaynak sayılır; aynı boyutta değişiklik gizlenmez', async () => {
  await withFixture(async (root) => {
    await mkdir(path.join(root, 'bin'))
    await writeFile(path.join(root, 'bin', 'cli.js'), 'console.log(1)\n')
    const before = await projectFingerprint([root])
    await writeFile(path.join(root, 'bin', 'cli.js'), 'console.log(2)\n')
    assert.notEqual(await projectFingerprint([root]), before)
  })
})

test('üretilen çıktılar ve bağımlılık klasörleri kökte ve kaynak altında digest değiştirmez', async () => {
  await withFixture(async (root) => {
    await mkdir(path.join(root, 'src'))
    await writeFile(path.join(root, 'src', 'index.ts'), 'export const answer = 42\n')
    const fingerprint = await projectFingerprint([root])
    const ignored = ['.git', '.codex-local', 'node_modules', '.gradle', '.idea', '.vscode', 'build', 'dist', 'out', 'target', '.next', 'coverage', '.pytest_cache', '__pycache__', 'test-results', 'playwright-report', '.cache']
    for (const base of [root, path.join(root, 'src')]) {
      for (const name of ignored) {
        const directory = path.join(base, name)
        await mkdir(directory)
        await writeFile(path.join(directory, 'generated.bin'), Buffer.from([0, 1, 2, 255]))
      }
    }
    assert.equal(await projectFingerprint([root]), fingerprint, 'Build veya günlük üretimi başarılı kontrolü kendiliğinden bayatlatmamalı')
    await writeFile(path.join(root, 'build', 'generated.bin'), Buffer.from([9, 8, 7]))
    assert.equal(await projectFingerprint([root]), fingerprint)
    await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
    assert.notEqual(await projectFingerprint([root]), fingerprint, 'Bağımlılık klasörü hariç olsa da lockfile kanıta katılmalı')
  })
})

test('birden fazla yetkili kök ve ikili kaynak içeriği parmak izine katılır', async () => {
  await withFixture(async (root) => {
    const project = path.join(root, 'project')
    const resource = path.join(root, 'resource')
    await mkdir(project)
    await mkdir(resource)
    await writeFile(path.join(project, 'index.ts'), 'export {}\n')
    await writeFile(path.join(resource, 'asset.bin'), Buffer.from([0, 1, 2, 255]))
    const initial = await projectFingerprint([project, resource])
    assert.equal(await projectFingerprint([project, resource]), initial)
    assert.notEqual(await projectFingerprint([project]), initial, 'Kaynak kapsamının kaldırılması kanıtı değiştirmeli')
    await writeFile(path.join(resource, 'asset.bin'), Buffer.from([0, 1, 3, 255]))
    assert.notEqual(await projectFingerprint([project, resource]), initial, 'Ek kaynak değişikliği de algılanmalı')
  })
})

for (const linkName of ['linked-source', '.codex-local']) {
  test(`kapsam içindeki ${linkName} sembolik bağlantısı veya junction takip edilmez`, async () => {
    await withFixture(async (root) => {
      const project = path.join(root, 'project')
      const external = path.join(root, 'external')
      await mkdir(project)
      await mkdir(external)
      await writeFile(path.join(external, 'source.ts'), 'external fixture\n')
      await symlink(external, path.join(project, linkName), process.platform === 'win32' ? 'junction' : 'dir')
      assert.equal((await lstat(path.join(project, linkName))).isSymbolicLink(), true)
      await assert.rejects(projectFingerprint([project]), /sembolik|bağlantı|junction/i)
    })
  })
}

test('açıkça seçilen kök bağlantısı gerçek klasör kimliğine bağlanır', async () => {
  await withFixture(async (root) => {
    const actual = path.join(root, 'actual')
    const linked = path.join(root, 'linked')
    await mkdir(actual)
    await writeFile(path.join(actual, 'source.ts'), 'root link fixture\n')
    await symlink(actual, linked, process.platform === 'win32' ? 'junction' : 'dir')
    const original = await projectFingerprint([actual])
    assert.equal(await projectFingerprint([linked]), original, 'Yetkili kök takma adı farklı kaynak kimliği üretmemeli')
    await writeFile(path.join(actual, 'source.ts'), 'changed root link fixture\n')
    assert.notEqual(await projectFingerprint([linked]), original, 'Gerçek kökteki değişiklik bağlantı üzerinden de algılanmalı')
  })
})

test('özyinelemesiz ek kaynak yalnız doğrudan altındaki dosyaları kapsar', async () => {
  await withFixture(async (root) => {
    await mkdir(path.join(root, 'nested'))
    await writeFile(path.join(root, 'direct.ts'), 'direct source\n')
    await writeFile(path.join(root, 'nested', 'private.ts'), 'outside selected depth\n')
    const nonrecursive = [{ path: root, recursive: false }]
    const original = await projectFingerprint(nonrecursive)
    const recursiveOriginal = await projectFingerprint([root])
    await writeFile(path.join(root, 'nested', 'private.ts'), 'changed outside selected depth\n')
    assert.equal(await projectFingerprint(nonrecursive), original, 'İzin verilmeyen alt kaynak içeriği okunmamalı')
    assert.notEqual(await projectFingerprint([root]), recursiveOriginal, 'Özyinelemeli kapsam aynı değişikliği algılamalı')
    await writeFile(path.join(root, 'direct.ts'), 'changed direct source\n')
    assert.notEqual(await projectFingerprint(nonrecursive), original, 'Doğrudan alt dosya bu kapsama katılmalı')
  })
})

test('erişilemeyen kaynak kökü sessizce boş proje kabul edilmez', async () => {
  await withFixture(async (root) => {
    await assert.rejects(projectFingerprint([path.join(root, 'missing-resource')]), { code: 'ENOENT' })
  })
})

test('20.000.000 bayt kaynak dosyası kabul edilir, tek bayt fazlası doğrulamayı kapatır', async () => {
  await withFixture(async (root) => {
    const largeFile = path.join(root, 'large-source.bin')
    await writeFile(largeFile, Buffer.alloc(20_000_000, 1))
    assert.match(await projectFingerprint([root]), /^[a-f0-9]{64}$/)
    await appendFile(largeFile, Buffer.from([1]))
    await assert.rejects(projectFingerprint([root]), /sınır|boyut/i)
  })
})

test('API yalnız digest döndürür; ham içerik, dosya listesi veya günlük dosyası yazmaz', async () => {
  await withFixture(async (root) => {
    const contents = 'FINGERPRINT_FIXTURE_ONLY=not-a-real-secret\n'
    await mkdir(path.join(root, 'src'))
    await writeFile(path.join(root, '.env'), contents)
    await writeFile(path.join(root, 'src', 'private-config.ts'), 'export const fixture = true\n')
    const before = await fileInventory(root)
    const digest = await projectFingerprint([root])
    assert.equal(typeof digest, 'string')
    assert.match(digest, /^[a-f0-9]{64}$/)
    assert.equal(digest.includes('FINGERPRINT_FIXTURE_ONLY'), false)
    assert.equal(digest.includes('private-config'), false)
    assert.deepEqual(await fileInventory(root), before, 'Parmak izi hesabı projeye içerik veya metaveri yazmamalı')
    assert.equal(await readFile(path.join(root, '.env'), 'utf8'), contents)
    assert.equal(await readFile(path.join(root, 'src', 'private-config.ts'), 'utf8'), 'export const fixture = true\n')
  })
})
