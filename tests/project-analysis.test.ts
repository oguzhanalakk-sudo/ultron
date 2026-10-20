import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeProjectFiles, checkPlannedPaths } from '../electron/project-analysis.ts'
import { renderTemplateString } from '../electron/project-template-engine.ts'

const pkg = (extra: Record<string, unknown> = {}) => JSON.stringify({ name: 'x', type: 'module', scripts: {}, ...extra })
const codes = (files: Record<string, string>, options = {}) => analyzeProjectFiles(new Map(Object.entries(files)), options).filter((issue) => issue.severity === 'error').map((issue) => issue.code)

test('geçerli TS projesi hatasız geçer', () => {
  assert.deepEqual(codes({ 'package.json': pkg(), 'src/a.ts': "import { b } from './b.ts'\nexport const a = b", 'src/b.ts': 'export const b = 1' }), [])
})

test('bozuk göreli import yakalanır', () => {
  assert.ok(codes({ 'package.json': pkg(), 'src/a.ts': "import { b } from './yok'\nexport const a = b" }).includes('unresolved-import'))
})

test('var olmayan adlandırılmış export yakalanır', () => {
  assert.ok(codes({ 'package.json': pkg(), 'src/a.ts': "import { c } from './b'\nexport const a = c", 'src/b.ts': 'export const b = 1' }).includes('unresolved-export'))
})

test('package.json içinde olmayan npm bağımlılığı yakalanır', () => {
  assert.ok(codes({ 'package.json': pkg(), 'src/a.ts': "import express from 'express'\nexport default express" }).includes('missing-dependency'))
  assert.deepEqual(codes({ 'package.json': pkg({ dependencies: { express: '^5.0.0' } }), 'src/a.ts': "import express from 'express'\nexport default express" }), [])
})

test('Python: eksik yerel modül ve requirements dışı paket yakalanır', () => {
  const found = codes({ 'requirements.txt': 'pytest', 'app/__init__.py': '', 'app/main.py': 'from app.yok import x\nimport fastapi\n' })
  assert.ok(found.includes('unresolved-import'))
  assert.ok(found.includes('missing-dependency'))
})

test('Go: go.mod ve yerel paket tutarlılığı', () => {
  const files = { 'go.mod': 'module demo\n\ngo 1.22\n', 'main.go': 'package main\n\nimport "demo/internal/yok"\n\nfunc main() { yok.Run() }\n' }
  assert.ok(codes(files).includes('unresolved-import'))
})

test('Rust: bildirilmemiş crate ve eksik mod dosyası yakalanır', () => {
  const found = codes({ 'Cargo.toml': '[package]\nname = "x"\nversion = "0.1.0"\n', 'src/main.rs': 'mod eksik;\nuse serde::Serialize;\nfn main() {}\n' })
  assert.ok(found.includes('unresolved-import'))
  assert.ok(found.includes('missing-dependency'))
})

test('olmayan entry dosyası ve olmayan betik hedefi yakalanır', () => {
  assert.ok(codes({ 'package.json': pkg() }, { entryFiles: ['src/main.ts'] }).includes('missing-entry'))
  assert.ok(codes({ 'package.json': pkg({ scripts: { start: 'node server.js' } }) }).length > 0)
  assert.ok(codes({ 'package.json': pkg({ scripts: { build: 'npm run yok' } }) }).includes('missing-script'))
})

test('path traversal, mutlak yol, çakışma ve dosya/klasör çelişkisi reddedilir', () => {
  const issues = checkPlannedPaths(['../x.ts', '/etc/passwd', 'C:\\Windows\\a.txt', 'a/b.ts', 'A/B.ts', 'dir', 'dir/file.ts', 'a/./c.ts'])
  const found = new Set(issues.map((issue) => issue.code))
  assert.ok(found.has('unsafe-path'))
  assert.ok(found.has('duplicate-path'))
  assert.ok(found.has('path-conflict'))
  assert.ok(issues.filter((issue) => issue.code === 'unsafe-path').length >= 4)
})

test('geçersiz manifest JSON/TOML yakalanır', () => {
  assert.ok(codes({ 'package.json': '{ bozuk' }).includes('invalid-manifest'))
  assert.ok(codes({ 'Cargo.toml': '[package\nname=' }).includes('invalid-manifest'))
})

test('şablon motoru: değişken, koşul, yineleme; eval ve fonksiyon yok', () => {
  assert.equal(renderTemplateString('Merhaba {{name}}!', { name: 'Ada' }), 'Merhaba Ada!')
  assert.equal(renderTemplateString('{{#if on}}A{{else}}B{{/if}}', { on: false }), 'B')
  assert.equal(renderTemplateString('{{#each xs}}[{{this}}]{{/each}}', { xs: [1, 2] }), '[1][2]')
  assert.equal(renderTemplateString('{{#each fs}}{{n}},{{/each}}', { fs: [{ n: 'a' }, { n: 'b' }] }), 'a,b,')
  assert.equal(renderTemplateString('{{f}}{{constructor}}{{__proto__}}', { f: () => 'x' }), '')
  assert.equal(renderTemplateString('{{a.b}}', { a: { b: 'ok' } }), 'ok')
  assert.throws(() => renderTemplateString('{{#if a}}açık', { a: true }), /kapatılmamış/)
})
