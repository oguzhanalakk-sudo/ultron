type DesktopWindow = { title?: string; process?: string; pid?: number }
type DesktopProcess = { ProcessName?: string; Id?: number; MainWindowTitle?: string; Responding?: boolean }

export default function DesktopAutomationPanel({
  windows,
  processes,
  status,
  error,
  onRefresh,
  busy = false,
}: {
  windows: DesktopWindow[]
  processes: DesktopProcess[]
  status: string
  error: string
  onRefresh: () => void
  busy?: boolean
}) {
  return (
    <section className="desktop-automation-card" aria-label="Masaüstü otomasyonu özeti">
      <div className="desktop-automation-head">
        <div>
          <small>DESKTOP</small>
          <strong>Masaüstü otomasyonu</strong>
        </div>
        <button type="button" onClick={onRefresh} disabled={busy} className="android-text-action">
          {busy ? 'Yükleniyor…' : 'Yenile'}
        </button>
      </div>
      <div className="desktop-automation-grid">
        <div className="desktop-automation-list">
          <strong>Pencereler</strong>
          {windows.length === 0 ? <span className="desktop-muted">Açık pencere bulunamadı.</span> : windows.slice(0, 12).map((windowInfo, index) => (
            <div className="desktop-automation-row" key={`${windowInfo.pid ?? windowInfo.title ?? 'window'}-${index}`}>
              <span>{windowInfo.title || 'Başlıksız pencere'}</span>
              <small>{windowInfo.process || '—'}</small>
            </div>
          ))}
        </div>
        <div className="desktop-automation-list">
          <strong>Süreçler</strong>
          {processes.length === 0 ? <span className="desktop-muted">Süreç bulunamadı.</span> : processes.slice(0, 12).map((processInfo, index) => (
            <div className="desktop-automation-row" key={`${processInfo.Id ?? processInfo.ProcessName ?? 'process'}-${index}`}>
              <span>{processInfo.ProcessName || 'Bilinmeyen süreç'}</span>
              <small>PID {processInfo.Id ?? '—'}</small>
            </div>
          ))}
        </div>
      </div>
      {error && <div className="panel-error">{error}</div>}
      {status && <div className="desktop-automation-status">{status}</div>}
    </section>
  )
}
