import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createProject, parseProjectRequest, planProject } from '../electron/project-cli.ts'
import { buildProjectPlan, checkProjectPlan, hasPlanErrors, listPlanStacks } from '../electron/project-plan.ts'
import { writeProjectPlan } from '../electron/project-writer.ts'
import { formatVerificationReport, runVerification, verifyProject } from '../electron/project-verifier.ts'
import { applyChangePlan, changePlanHasErrors, detectProject, planChange } from '../electron/project-change-plan.ts'
import { PROJECT_TEMPLATES } from '../electron/project-template-registry.ts'

async function withTemp<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ultron-pipeline-'))
  try { return await run(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

async function entries(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).sort()
}

// ---------------------------------------------------------------- plan

test('plan: prompt yığını seçer, gerekçe/dil/komut/env/bağımlılık içerir ve diske yazmaz', () => {
  const plan = buildProjectPlan({ name: 'asistan', prompt: 'Python FastAPI ile yapay zeka asistanı API' })
  assert.equal(plan.stack, 'python-fastapi')
  assert.equal(plan.selection.language, 'python')
  assert.match(plan.selection.rationale, /python-fastapi/)
  assert.ok(plan.files.length >= 15)
  assert.ok(plan.directories.includes('app/api/v1'))
  assert.ok(plan.dependencies.python.length > 0)
  assert.ok(plan.envVariables.some((item) => item.name === 'DATABASE_URL'))
  assert.equal(plan.commands.test, 'python -m pytest')
  assert.deepEqual(plan.issues, [])
})

test('plan: yığın seçimi mevcut inferStackFromPrompt ile uyumlu, açık yığın önceliklidir', () => {
  assert.equal(buildProjectPlan({ name: 'a', prompt: 'golang api' }).stack, 'go')
  assert.equal(buildProjectPlan({ name: 'a', prompt: 'rust axum servisi' }).stack, 'rust')
  assert.equal(buildProjectPlan({ name: 'a', prompt: 'electron masaüstü' }).stack, 'electron')
  const explicit = buildProjectPlan({ name: 'a', prompt: 'python', stack: 'express' })
  assert.equal(explicit.stack, 'express')
  assert.match(explicit.selection.rationale, /açıkça/)
})

test('plan: her yığın çok dosyalı ve statik denetimden hatasız geçer; entry dosyaları planda vardır', () => {
  for (const stack of listPlanStacks()) {
    const plan = buildProjectPlan({ name: 'demo-app', description: 'Demo', stack })
    assert.deepEqual(plan.issues.filter((issue) => issue.severity === 'error'), [], stack)
    assert.ok(plan.files.length >= 6, `${stack} çok dosyalı olmalı`)
    const paths = new Set(plan.files.map((file) => file.path))
    for (const entry of PROJECT_TEMPLATES[stack].entryFiles) assert.ok(paths.has(entry), `${stack}: ${entry}`)
    assert.ok(plan.files.every((file) => file.content.trim().length > 0), stack)
  }
})

test('plan: güvenlik varsayılanları (Electron, FastAPI)', () => {
  const electron = buildProjectPlan({ name: 'd', stack: 'electron' }).files.find((file) => file.path === 'electron/main.ts')!.content
  assert.match(electron, /contextIsolation: true/)
  assert.match(electron, /nodeIntegration: false/)
  assert.match(electron, /sandbox: true/)
  const files = buildProjectPlan({ name: 'd', stack: 'python-fastapi' }).files
  const config = files.find((file) => file.path === 'app/core/config.py')!.content
  assert.match(config, /debug: bool = False/i)
  assert.ok(!files.some((file) => /sk-[A-Za-z0-9]{20}|BEGIN (RSA )?PRIVATE KEY/.test(file.content)))
})

test('statik denetim: bozuk plan hata verir ve yazıcı hiçbir dosya yazmaz', async () => {
  await withTemp(async (dir) => {
    const plan = buildProjectPlan({ name: 'bozuk', stack: 'express' })
    plan.files.push({ path: 'src/kirik.js', purpose: 'bozuk', content: "import { x } from './yok.js'\nexport default x\n" })
    assert.ok(hasPlanErrors(checkProjectPlan(plan)))
    const root = path.join(dir, 'bozuk')
    const report = await writeProjectPlan(plan, { root })
    assert.equal(report.ok, false)
    assert.equal(report.created.length, 0)
    assert.equal(report.notAttempted.length, plan.files.length)
    await assert.rejects(() => stat(root), /ENOENT/)
  })
})

test('statik denetim: path traversal ve mutlak yol içeren plan yazılmaz', async () => {
  await withTemp(async (dir) => {
    const plan = buildProjectPlan({ name: 'x', stack: 'node' })
    plan.files.push({ path: '../kacis.txt', purpose: 'x', content: 'x' }, { path: '/tmp/mutlak.txt', purpose: 'x', content: 'x' })
    const report = await writeProjectPlan(plan, { root: path.join(dir, 'x') })
    assert.equal(report.ok, false)
    assert.ok(report.issues.some((issue) => issue.code === 'unsafe-path'))
    assert.deepEqual(await entries(dir), [])
  })
})

// ---------------------------------------------------------------- write

test('yazıcı: üzerine yazmaz, var olanı atlar, symlink kaçışını reddeder', async () => {
  await withTemp(async (dir) => {
    const root = path.join(dir, 'proje')
    await mkdir(root)
    await writeFile(path.join(root, 'README.md'), 'KULLANICI')
    const plan = buildProjectPlan({ name: 'proje', stack: 'node' })
    const report = await writeProjectPlan(plan, { root })
    assert.equal(report.ok, true)
    assert.ok(report.skipped.some((item) => item.path === 'README.md'))
    assert.equal(await readFile(path.join(root, 'README.md'), 'utf8'), 'KULLANICI')
    assert.ok(report.created.length === plan.files.length - 1)

    const outside = path.join(dir, 'dis')
    await mkdir(outside)
    const evil = path.join(dir, 'kotu')
    await mkdir(evil)
    await symlink(outside, path.join(evil, 'src'), 'dir')
    const escaped = await writeProjectPlan(buildProjectPlan({ name: 'kotu', stack: 'node' }), { root: evil })
    assert.equal(escaped.ok, false)
    assert.ok(escaped.issues.some((issue) => issue.code === 'path-escape'))
    assert.deepEqual(await readdir(outside), [])
    assert.equal(escaped.created.length, 0)
  })
})

test('yazıcı: izin reddedilirse hiçbir şey yazılmaz', async () => {
  await withTemp(async (dir) => {
    const root = path.join(dir, 'p')
    const report = await writeProjectPlan(buildProjectPlan({ name: 'p', stack: 'go' }), { root, authorize: () => false })
    assert.equal(report.ok, false)
    assert.match(report.error ?? '', /izni/)
    await assert.rejects(() => stat(root), /ENOENT/)
  })
})

// ---------------------------------------------------------------- entegrasyon

test('entegrasyon: createProject çok dosyalı çıktı verir, ikinci çalıştırma mevcut dosyaları atlar', async () => {
  await withTemp(async (dir) => {
    const request = parseProjectRequest(['api', '--stack', 'python-fastapi', '--dir', path.join(dir, 'api')])
    const first = await createProject(request)
    assert.ok(first.files.length >= 15)
    assert.equal(first.skipped?.length, 0)
    const main = path.join(first.root, 'app', 'main.py')
    await writeFile(main, '# benim\n')
    const second = await createProject(request)
    assert.equal(second.files.length, 0)
    assert.equal(second.skipped?.length, first.files.length)
    assert.equal(await readFile(main, 'utf8'), '# benim\n')
    assert.ok(second.warnings?.some((warning) => /atlandı/.test(warning)))
  })
})

test('entegrasyon: planProject diske yazmaz', async () => {
  await withTemp(async (dir) => {
    const plan = planProject(parseProjectRequest(['x', '--stack', 'rust', '--dir', path.join(dir, 'x')]))
    assert.equal(plan.stack, 'rust')
    assert.deepEqual(await entries(dir), [])
  })
})

test('doğrulayıcı: sağlam proje yapı/statik/build geçer, çalıştırılmayan adımlar not-run olur', async () => {
  await withTemp(async (dir) => {
    const artifact = await createProject(parseProjectRequest(['api', '--stack', 'python-fastapi', '--dir', path.join(dir, 'api')]))
    const report = await verifyProject(artifact.root, { stack: 'python-fastapi', expectedFiles: artifact.plan!.entryFiles })
    const byPhase = Object.fromEntries(report.phases.map((phase) => [phase.phase, phase]))
    assert.equal(byPhase.structure.ok, true)
    assert.equal(byPhase.static.ok, true)
    assert.equal(byPhase.install.checks[0].status, 'not-run')
    assert.equal(byPhase.test.checks[0].status, 'not-run')
    assert.equal(report.complete, false, 'çalıştırılmayan adımlar tam doğrulama sayılmamalı')
    assert.match(formatVerificationReport(report).join('\n'), /NOT-RUN/)
  })
})

test('doğrulayıcı: bozuk projeyi yakalar (eksik dosya, bozuk import, bozuk Python sözdizimi)', async () => {
  await withTemp(async (dir) => {
    const artifact = await createProject(parseProjectRequest(['api', '--stack', 'python-fastapi', '--dir', path.join(dir, 'api')]))
    await rm(path.join(artifact.root, 'app', 'schemas', 'item.py'))
    await writeFile(path.join(artifact.root, 'app', 'core', 'logging.py'), 'def bozuk(:\n')
    const report = await verifyProject(artifact.root, { stack: 'python-fastapi', expectedFiles: ['app/main.py', 'app/yok.py'] })
    assert.equal(report.ok, false)
    const byPhase = Object.fromEntries(report.phases.map((phase) => [phase.phase, phase]))
    assert.equal(byPhase.structure.ok, false)
    assert.equal(byPhase.static.ok, false)
    assert.ok(byPhase.static.issues.some((issue) => issue.code === 'unresolved-import'))
    assert.equal(byPhase.build.ok, false, 'compileall alt paketlerdeki sözdizimi hatasını yakalamalı')
  })
})

test('doğrulayıcı: bozuk manifest ve proje dışı beklenen yol reddedilir', async () => {
  await withTemp(async (dir) => {
    await writeFile(path.join(dir, 'package.json'), '{ bozuk')
    const report = await verifyProject(dir, { stack: 'node', expectedFiles: ['../disari.txt'] })
    assert.equal(report.ok, false)
    assert.ok(report.phases[0].issues.some((issue) => issue.code === 'unsafe-path'))
    assert.ok(report.phases[0].checks.some((check) => check.name === 'package.json geçerli' && check.status === 'failed'))
  })
})

test('doğrulayıcı: izin listesi dışı komutlar reddedilir, izinli yeni komutlar yalnız kesin eşleşir', async () => {
  await withTemp(async (dir) => {
    for (const [command, args] of [
      ['rm', ['-rf', '.']],
      ['npm', ['run', 'build', '--', '--evil']],
      ['npm', ['test', '--', '--x']],
      ['python', ['-m', 'compileall', '-q', '../disari']],
      ['python', ['-m', 'compileall', '-q', '/etc']],
      ['python', ['-c', 'print(1)']],
      ['python', ['-m', 'pytest', '-p', 'evil']],
      ['cargo', ['run']],
    ] as Array<[string, string[]]>) {
      const result = await runVerification(dir, command, args, 5_000)
      assert.equal(result.ok, false, `${command} ${args.join(' ')}`)
      assert.equal(result.exitCode, 126, `${command} ${args.join(' ')}`)
      assert.match(result.stderr, /izin listesinde değil/)
    }
  })
})

test('doğrulayıcı: yazma ve doğrulama ayrı aşamalardır (doğrulama dosya yazmaz)', async () => {
  await withTemp(async (dir) => {
    const artifact = await createProject(parseProjectRequest(['svc', '--stack', 'go', '--dir', path.join(dir, 'svc')]))
    const before = await entries(artifact.root)
    await verifyProject(artifact.root, { stack: 'go', expectedFiles: artifact.plan!.entryFiles })
    assert.deepEqual(await entries(artifact.root), before)
  })
})

// ---------------------------------------------------------------- mevcut projede değişiklik

test('değişiklik planı: projeyi tanır, hedefli düzenler, kullanıcı değişikliğini ezmez', async () => {
  await withTemp(async (dir) => {
    const artifact = await createProject(parseProjectRequest(['svc', '--stack', 'express', '--dir', path.join(dir, 'svc')]))
    const profile = await detectProject(artifact.root)
    assert.equal(profile.language, 'javascript')
    assert.equal(profile.framework, 'express')
    assert.equal(profile.importStyle, 'esm')
    assert.equal(profile.testCommand, 'npm test')

    const request = {
      edits: [{ path: 'src/app.js', oldText: "app.use('/api/items', itemsRouter())", newText: "app.use('/api/items', itemsRouter())\n  app.use('/api/tags', tagsRouter())" }, { path: 'src/app.js', oldText: "import { itemsRouter } from './routes/items.js'", newText: "import { itemsRouter } from './routes/items.js'\nimport { tagsRouter } from './routes/tags.js'" }],
      creates: [{ path: 'src/routes/tags.js', content: "import { Router } from 'express'\n\nexport function tagsRouter() {\n  return Router()\n}\n" }, { path: 'README.md', content: 'ezmemeli' }],
    }
    const plan = await planChange(artifact.root, request)
    assert.equal(changePlanHasErrors(plan), false, JSON.stringify(plan.issues))
    assert.equal(plan.edits.length, 1)
    assert.equal(plan.creates.length, 1)
    assert.deepEqual(plan.skipped.map((item) => item.path), ['README.md'])
    assert.ok(!(await readFile(path.join(artifact.root, 'src/app.js'), 'utf8')).includes('tagsRouter'), 'plan diske yazmamalı')

    // plan sonrası kullanıcı dosyayı değiştirirse uygulama reddedilir
    await writeFile(path.join(artifact.root, 'src/app.js'), (await readFile(path.join(artifact.root, 'src/app.js'), 'utf8')) + '\n// kullanıcı\n')
    const stale = await applyChangePlan(plan)
    assert.equal(stale.ok, false)
    assert.match(stale.error ?? '', /değişmiş|kısmen/)
    assert.ok((await readFile(path.join(artifact.root, 'src/app.js'), 'utf8')).includes('// kullanıcı'))
    assert.ok(!(await readFile(path.join(artifact.root, 'src/app.js'), 'utf8')).includes('tagsRouter'))

    const fresh = await planChange(artifact.root, request)
    const calls: string[] = []
    const report = await applyChangePlan(fresh, { verify: async () => { calls.push('verify'); return { ok: true } } })
    assert.equal(report.ok, true, report.error)
    assert.deepEqual(calls, ['verify', 'verify'])
    assert.deepEqual(report.edited, ['src/app.js'])
    assert.deepEqual(report.created, ['src/routes/tags.js'])
    const content = await readFile(path.join(artifact.root, 'src/app.js'), 'utf8')
    assert.ok(content.includes('tagsRouter') && content.includes('// kullanıcı'))
  })
})

test('değişiklik planı: bozuk import/olmayan hedef/traversal planlanır ama uygulanmaz', async () => {
  await withTemp(async (dir) => {
    const artifact = await createProject(parseProjectRequest(['svc', '--stack', 'node', '--dir', path.join(dir, 'svc')]))
    const plan = await planChange(artifact.root, {
      edits: [{ path: 'src/index.js', oldText: "import { logger } from './logger.js'", newText: "import { logger } from './logger.js'\nimport { x } from './yok.js'" }, { path: 'src/olmayan.js', oldText: 'a', newText: 'b' }],
      creates: [{ path: '../disari.txt', content: 'x' }],
    })
    const codes = plan.issues.map((issue) => issue.code)
    assert.ok(codes.includes('unresolved-import'))
    assert.ok(codes.includes('edit-target'))
    assert.ok(codes.includes('unsafe-path'))
    const before = await readFile(path.join(artifact.root, 'src/index.js'), 'utf8')
    const report = await applyChangePlan(plan)
    assert.equal(report.ok, false)
    assert.equal(await readFile(path.join(artifact.root, 'src/index.js'), 'utf8'), before)
  })
})

test('değişiklik planı: başarısız sonrası doğrulama değişen dosyaları raporlar, başarısız baseline hiçbir şey yazmaz', async () => {
  await withTemp(async (dir) => {
    const artifact = await createProject(parseProjectRequest(['svc', '--stack', 'node', '--dir', path.join(dir, 'svc')]))
    const request = { creates: [{ path: 'src/yeni.js', content: 'export const yeni = 1\n' }] }
    const blocked = await applyChangePlan(await planChange(artifact.root, request), { verify: async () => ({ ok: false, detail: 'zaten bozuk' }) })
    assert.equal(blocked.ok, false)
    assert.equal(blocked.created.length, 0)
    await assert.rejects(() => stat(path.join(artifact.root, 'src/yeni.js')), /ENOENT/)

    let call = 0
    const failed = await applyChangePlan(await planChange(artifact.root, request), { verify: async () => ({ ok: ++call === 1, detail: 'test kırıldı' }) })
    assert.equal(failed.ok, false)
    assert.deepEqual(failed.created, ['src/yeni.js'])
    assert.match(failed.error ?? '', /src\/yeni\.js/)
  })
})
