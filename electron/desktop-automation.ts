import type { DesktopActionKind, DesktopState, DesktopWindowInfo } from './desktop-control.ts'

export type DesktopProcessInfo = {
  pid: number
  name: string
  status: string
  cpuPercent?: number
  memoryMb?: number
}

export type DesktopAutomationResult = {
  ok: boolean
  message: string
  data?: unknown
}

export type DesktopAutomationExecutor = (action: DesktopActionKind, payload: Record<string, unknown>) => Promise<{
  state?: Partial<DesktopState> & { processes?: Array<Record<string, unknown>>; appLogs?: string[]; screenshotPath?: string | null }
  message?: string
}>

/**
 * Masaüstü işlemleri için güvenli adaptör. Süreç veya PowerShell başlatmaz;
 * bütün çağrıları main.ts içindeki izin, hedef doğrulama ve korumalı native
 * yürütücüye yönlendirir.
 */
export class DesktopAutomation {
  private readonly execute: DesktopAutomationExecutor

  constructor(execute: DesktopAutomationExecutor) {
    this.execute = execute
  }

  async listWindows(): Promise<DesktopWindowInfo[]> {
    const result = await this.execute('window_list', {})
    return result.state?.windows ?? []
  }

  async listProcesses(): Promise<DesktopProcessInfo[]> {
    const result = await this.execute('process_list', {})
    return (result.state?.processes ?? []).map((item) => ({
      pid: Number(item.Id ?? item.pid ?? item.ProcessId ?? 0),
      name: String(item.ProcessName ?? item.name ?? item.Name ?? ''),
      status: item.Responding === false ? 'not responding' : 'running',
      ...(item.CPU !== undefined ? { cpuPercent: Number(item.CPU) } : {}),
      ...(item.WorkingSetSize !== undefined ? { memoryMb: Math.round(Number(item.WorkingSetSize) / (1024 * 1024)) } : {}),
    })).filter((item) => item.pid > 0 && item.name)
  }

  async startApplication(pathOrCommand: string): Promise<DesktopAutomationResult> {
    const result = await this.execute('process_start', { name: pathOrCommand })
    return { ok: true, message: result.message ?? 'Uygulama başlatıldı.', data: result.state }
  }

  async openFileWithDefaultApp(filePath: string): Promise<DesktopAutomationResult> {
    const result = await this.execute('open_file_default', { path: filePath })
    return { ok: true, message: result.message ?? 'Dosya varsayılan uygulamayla açıldı.', data: result.state }
  }

  async captureScreenshot(): Promise<DesktopAutomationResult> {
    const result = await this.execute('screenshot', {})
    return { ok: true, message: result.message ?? 'Ekran görüntüsü alındı.', data: result.state?.screenshotPath ?? result.state }
  }

  async readRecentLogs(logPath: string, tail = 200): Promise<string[]> {
    const result = await this.execute('app_logs', { path: logPath, tail: Math.min(Math.max(Math.floor(tail), 1), 500) })
    return result.state?.appLogs ?? []
  }

  async waitForProcess(pid: number, timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + Math.min(Math.max(Math.floor(timeoutMs), 100), 120_000)
    while (Date.now() < deadline) {
      const processes = await this.listProcesses()
      if (processes.some((process) => process.pid === pid)) return true
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return false
  }
}
