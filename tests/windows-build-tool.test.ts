import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeWindowsBuildFailure, analyzeWindowsProjectFiles, createWindowsBuildPlan, isValidWindowsPeHeader } from '../electron/windows-build-tool.ts'

test('Windows project analyzer finds Python GUI, entry point, test files and project name', () => {
  const result = analyzeWindowsProjectFiles({
    'pyproject.toml': '[project]\nname = "deskboard"\ndependencies = ["PySide6"]',
    'main.py': 'from PySide6 import QtWidgets\nif __name__ == "__main__": main()',
    'tests/test_store.py': 'import unittest',
  })
  assert.equal(result.primaryTechnology, 'python')
  assert.equal(result.projectName, 'deskboard')
  assert.ok(result.frameworks.includes('PySide6'))
  assert.deepEqual(result.entryFiles, ['main.py'])
  assert.deepEqual(result.testFiles, ['tests/test_store.py'])
})

test('Windows project analyzer detects WinForms, WPF, WinUI, Electron, Tauri and CMake', () => {
  assert.ok(analyzeWindowsProjectFiles({ 'app.csproj': '<UseWindowsForms>true</UseWindowsForms>' }).frameworks.includes('Windows Forms'))
  assert.ok(analyzeWindowsProjectFiles({ 'app.csproj': '<UseWPF>true</UseWPF>' }).frameworks.includes('WPF'))
  assert.ok(analyzeWindowsProjectFiles({ 'app.csproj': 'Microsoft.WindowsAppSDK' }).frameworks.includes('WinUI'))
  assert.equal(analyzeWindowsProjectFiles({ 'package.json': '{"dependencies":{"electron":"^1"},"scripts":{"build":"vite build","dist":"electron-builder"}}' }).primaryTechnology, 'electron')
  assert.equal(analyzeWindowsProjectFiles({ 'src-tauri/Cargo.toml': '[dependencies]\ntauri = "2"' }).primaryTechnology, 'tauri')
  assert.equal(analyzeWindowsProjectFiles({ 'CMakeLists.txt': 'project(Desk)' }).primaryTechnology, 'cmake')
})

test('Python package plan uses unique project-local paths and accepts only detected entry files', () => {
  const project = analyzeWindowsProjectFiles({ 'main.py': 'if __name__ == "__main__": main()', 'tests/test_main.py': 'import unittest' })
  const plan = createWindowsBuildPlan(project, { action: 'package', runId: 'w-123', outputKind: 'onefile', windowMode: 'console' })
  assert.match(plan.commands[0], /python -m PyInstaller/)
  assert.match(plan.commands[0], /--onefile --console/)
  assert.equal(plan.expectedRelativePath, 'build/windows/w-123/dist/main.exe')
  assert.throws(() => createWindowsBuildPlan(project, { action: 'package', runId: 'w-123', entryFile: '..\\outside.py' }), /göreli yol/)
  assert.throws(() => createWindowsBuildPlan(project, { action: 'package', runId: 'w-123', entryFile: 'other.py' }), /algılanan/)
})

test('.NET plan records framework-dependent and self-contained publish choices', () => {
  const project = analyzeWindowsProjectFiles({ 'Desk.csproj': '<Project><TargetFramework>net8.0-windows</TargetFramework><UseWPF>true</UseWPF></Project>' })
  const frameworkDependent = createWindowsBuildPlan(project, { action: 'package', runId: 'w-a', selfContained: false, singleFile: false })
  assert.match(frameworkDependent.commands[0], /--self-contained false/)
  assert.match(frameworkDependent.commands[0], /PublishSingleFile=false/)
  assert.match(frameworkDependent.notes[0], /Desktop Runtime/)
  const standalone = createWindowsBuildPlan(project, { action: 'package', runId: 'w-b', selfContained: true, singleFile: true })
  assert.match(standalone.commands[0], /--self-contained true/)
  assert.match(standalone.commands[0], /PublishSingleFile=true/)
  assert.match(standalone.notes[0], /daha büyük/)
})

test('Electron packaging requires an existing package script and never invents an install command', () => {
  const configured = analyzeWindowsProjectFiles({ 'package.json': '{"name":"desktop","devDependencies":{"electron":"1"},"scripts":{"test":"node --test","dist":"electron-builder"}}' })
  assert.match(createWindowsBuildPlan(configured, { action: 'package', runId: 'w-1' }).commands[0], /npm run dist/)
  const unconfigured = analyzeWindowsProjectFiles({ 'package.json': '{"devDependencies":{"electron":"1"}}' })
  assert.throws(() => createWindowsBuildPlan(unconfigured, { action: 'package', runId: 'w-2' }), /doğrulanmış dist veya package/i)
})

test('Tauri package plan calls the CLI from the selected project root without unsupported manifest flags', () => {
  const project = analyzeWindowsProjectFiles({
    'src-tauri/Cargo.toml': '[dependencies]\ntauri = "2"',
    'src-tauri/tauri.conf.json': '{}',
  })
  const plan = createWindowsBuildPlan(project, { action: 'package', projectPath: 'desktop-app', runId: 'w-tauri' })
  assert.deepEqual(plan.commands, ['cargo tauri build'])
  assert.equal(plan.workingDirectory, 'desktop-app')
  assert.equal(plan.expectedRelativePath, 'desktop-app/src-tauri/target/release/bundle')
})

test('CMake build plans configure before building and CTest is not assumed without tests', () => {
  const project = analyzeWindowsProjectFiles({ 'CMakeLists.txt': 'project(Desk)', 'src/main.cpp': 'int main() { return 0; }' })
  assert.throws(() => createWindowsBuildPlan(project, { action: 'test', runId: 'w-1' }), /test dosyası/)
  const build = createWindowsBuildPlan({ ...project, testFiles: ['tests/hello.cpp'] }, { action: 'test', projectPath: 'native', runId: 'w-1' })
  assert.equal(build.commands.length, 3)
  assert.match(build.commands[0], /cmake -S "native"/)
  assert.match(build.commands[2], /ctest --test-dir "native\/build\/windows\/w-1"/)
})

test('Inno Setup only runs an existing in-scope installer script', () => {
  const project = analyzeWindowsProjectFiles({ 'main.py': '__name__', 'setup.iss': '[Setup]\nAppName=Desk', 'tests/test_main.py': 'import unittest' })
  const plan = createWindowsBuildPlan(project, { action: 'installer', runId: 'w-3' })
  assert.match(plan.commands[0], /^iscc /i)
  assert.deepEqual(plan.expectedExtensions, ['.exe'])
})

test('Windows build errors distinguish missing packager, SDK, compile failure, denied and timeout', () => {
  assert.equal(analyzeWindowsBuildFailure("No module named 'PyInstaller'").category, 'missing-packager')
  assert.equal(analyzeWindowsBuildFailure('NETSDK1045: current SDK does not support net9.0').category, 'dotnet-sdk')
  assert.equal(analyzeWindowsBuildFailure('Main.cs(12): error CS1002: ; expected').category, 'compile')
  assert.equal(analyzeWindowsBuildFailure('', { exitCode: -1, launchFailed: true }).category, 'missing-tool')
  assert.equal(analyzeWindowsBuildFailure('', { timedOut: true }).category, 'timeout')
  assert.equal(analyzeWindowsBuildFailure('', { artifactFound: false, exitCode: 0 }).category, 'missing-artifact')
})

test('EXE validation requires MZ plus a bounded PE header signature', () => {
  const valid = new Uint8Array(256)
  valid[0] = 0x4d; valid[1] = 0x5a; valid[0x3c] = 0x80
  valid.set([0x50, 0x45, 0, 0], 0x80)
  assert.equal(isValidWindowsPeHeader(valid, valid.length), true)
  valid[0x80] = 0
  assert.equal(isValidWindowsPeHeader(valid, valid.length), false)
  assert.equal(isValidWindowsPeHeader(new Uint8Array([0x4d, 0x5a]), 128), false)
})
