import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeAndroidBuildFailure, analyzeAndroidProjectFiles, isSafeAndroidGradleTask, isValidZipContainer, parseAndroidDevices } from '../electron/android-build-tool.ts'

test('Android Gradle görev allowlisti biçim ve görev adlarını doğrular', () => {
  assert.equal(isSafeAndroidGradleTask('assembleDebug'), true)
  assert.equal(isSafeAndroidGradleTask('app:testDebugUnitTest'), true)
  assert.equal(isSafeAndroidGradleTask('clean'), false)
  assert.equal(isSafeAndroidGradleTask('assembleDebug; Remove-Item x'), false)
  assert.equal(isSafeAndroidGradleTask(':app:assembleRelease'), true)
})

test('Android proje analizi modül, dil, manifest, wrapper ve testleri bulur', () => {
  const result = analyzeAndroidProjectFiles({
    'settings.gradle.kts': 'rootProject.name = "Sample"\ninclude(":app")',
    'gradle/wrapper/gradle-wrapper.properties': 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.13-bin.zip',
    'gradlew.bat': '@echo off',
    'app/build.gradle.kts': 'plugins { id("com.android.application") }\nandroid { namespace = "dev.sample"; compileSdk = 36; defaultConfig { applicationId = "dev.sample"; minSdk = 24 } }\ndependencies { implementation("x:y:1") }',
    'app/src/main/AndroidManifest.xml': '<manifest/>',
    'app/src/main/java/dev/sample/MainActivity.java': 'class MainActivity {}',
    'app/src/test/java/dev/sample/ExampleTest.java': 'class ExampleTest {}',
  })
  assert.equal(result.isAndroidProject, true)
  assert.equal(result.rootProjectName, 'Sample')
  assert.equal(result.hasGradleWrapper, true)
  assert.equal(result.modules[0].kind, 'application')
  assert.equal(result.modules[0].applicationId, 'dev.sample')
  assert.equal(result.modules[0].compileSdk, '36')
  assert.equal(result.modules[0].minSdk, '24')
  assert.equal(result.modules[0].hasUnitTests, true)
  assert.deepEqual(result.languages, ['Java'])
  assert.equal(result.findings.length, 0)
})

test('Android olmayan veya eksik proje için somut bulgular üretilir', () => {
  const result = analyzeAndroidProjectFiles({ 'package.json': '{"name":"web"}' })
  assert.equal(result.isAndroidProject, false)
  assert.ok(result.findings.some((finding) => /Android Gradle modülü/.test(finding)))
})

test('ADB cihaz listesi cihaz durumlarını ve emülatörü parse eder', () => {
  assert.deepEqual(parseAndroidDevices('List of devices attached\nZX1A device product:x model:Pixel_7\nemulator-5554 device product:sdk\nR58 unauthorized usb:1'), [
    { serial: 'ZX1A', state: 'device', details: 'product:x model:Pixel_7' },
    { serial: 'emulator-5554', state: 'device', details: 'product:sdk' },
    { serial: 'R58', state: 'unauthorized', details: 'usb:1' },
  ])
})

test('Android derleme hata analizi ağ, imza, iptal ve başarısız testleri ayırır', () => {
  assert.equal(analyzeAndroidBuildFailure('Could not resolve host repo.maven.apache.org').category, 'dependency-network')
  assert.equal(analyzeAndroidBuildFailure('Execution failed for task :app:packageRelease. Keystore file not found').category, 'signing')
  assert.equal(analyzeAndroidBuildFailure('Test failed: expected true').category, 'test')
  assert.equal(analyzeAndroidBuildFailure('', { cancelled: true }).category, 'cancelled')
  assert.equal(analyzeAndroidBuildFailure('', { timedOut: true }).retryable, true)
  assert.equal(analyzeAndroidBuildFailure('', { artifactFound: false }).category, 'missing-artifact')
})

test('Android build hata sınıfları eksik JDK/SDK, yapılandırma, kaynak, emulator ve yetki sorunlarını ayırır', () => {
  assert.equal(analyzeAndroidBuildFailure('JAVA_HOME is not set and no java command could be found').category, 'missing-java')
  assert.equal(analyzeAndroidBuildFailure('SDK location not found. Define a valid SDK location').category, 'missing-sdk')
  assert.equal(analyzeAndroidBuildFailure('Minimum supported Gradle version is 8.13').category, 'sdk-version')
  assert.equal(analyzeAndroidBuildFailure('Could not create task :app:assembleDebug because plugin was not found').category, 'gradle-configuration')
  assert.equal(analyzeAndroidBuildFailure('Manifest merger failed with multiple errors').category, 'manifest')
  assert.equal(analyzeAndroidBuildFailure('MainActivity.java: cannot find symbol').category, 'source')
  assert.equal(analyzeAndroidBuildFailure('No connected devices found').category, 'emulator')
  assert.equal(analyzeAndroidBuildFailure('device emulator-5554 offline').category, 'device-disconnected')
  assert.equal(analyzeAndroidBuildFailure('Permission denied writing build cache').category, 'permission')
  assert.equal(analyzeAndroidBuildFailure('Gradle Wrapper not found').category, 'missing-wrapper')
  assert.equal(analyzeAndroidBuildFailure('Could not find dependency x:y:1').category, 'dependency')
})

test('APK/AAB ZIP bütünlüğü EOCD ve dizin sınırlarından doğrulanır', () => {
  const archive = new Uint8Array([0x50,0x4b,0x03,0x04,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x50,0x4b,0x01,0x02,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0x50,0x4b,0x05,0x06,0,0,0,0,1,0,1,0,12,0,0,0,24,0,0,0,0,0])
  assert.equal(isValidZipContainer(archive.subarray(0, 4), archive, archive.length), true)
  assert.equal(isValidZipContainer(new Uint8Array([1,2,3,4]), archive, archive.length), false)
  assert.equal(isValidZipContainer(archive.subarray(0, 4), archive.subarray(0, -2), archive.length), false)
})
