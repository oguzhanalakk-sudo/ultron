import test from 'node:test'
import assert from 'node:assert/strict'
import { DesktopAutomation } from '../electron/desktop-automation.ts'

test('DesktopAutomation mevcut güvenli yürütücüye eylem ve parametreleri yönlendirir', async () => {
  const calls: Array<{ action: string; payload: Record<string, unknown> }> = []
  const automation = new DesktopAutomation(async (action, payload) => {
    calls.push({ action, payload })
    if (action === 'window_list') return { state: { windows: [{ handle: '1', title: 'Not Defteri', process: 'notepad', pid: 42, visible: true, rect: { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 }, focused: true }] } }
    if (action === 'process_list') return { state: { processes: [{ Id: 42, ProcessName: 'notepad', Responding: true }] } }
    if (action === 'app_logs') return { state: { appLogs: ['one', 'two'] } }
    return { message: 'ok', state: { screenshotPath: 'screen.png' } }
  })
  assert.equal((await automation.listWindows())[0].title, 'Not Defteri')
  assert.equal((await automation.listProcesses())[0].pid, 42)
  assert.equal((await automation.startApplication('notepad')).ok, true)
  assert.deepEqual(await automation.readRecentLogs('app.log', 900), ['one', 'two'])
  assert.equal((await automation.captureScreenshot()).data, 'screen.png')
  assert.equal(calls.some((call) => call.action === 'process_start' && call.payload.name === 'notepad'), true)
  assert.equal(calls.some((call) => call.action === 'app_logs' && call.payload.tail === 500), true)
})

test('waitForProcess süreç görünene kadar kontrollü biçimde bekler', async () => {
  let checks = 0
  const automation = new DesktopAutomation(async () => ({ state: { processes: checks++ > 0 ? [{ Id: 9, ProcessName: 'demo' }] : [] } }))
  assert.equal(await automation.waitForProcess(9, 2_000), true)
})
