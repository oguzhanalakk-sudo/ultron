import { useState } from 'react'

const TOOLS = ['git', 'gh', 'node', 'npm', 'python', 'pytest', 'tsc', 'eslint', 'prettier', 'docker']

export default function DeveloperToolsPanel({ projectPath, setToast }: { projectPath: string | null; setToast: (message: string) => void }) {
  const [status, setStatus] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadTools() {
    setLoading(true); setError('')
    try {
      const results = await window.kodAtolyesi.getToolAvailability(TOOLS)
      setStatus(Object.fromEntries(results.map((result) => [result.name, result.available ? `${result.version ?? 'var'} · kurulu` : `eksik · ${result.reason ?? 'N/A'}`])))
    } catch (event) { setError(event instanceof Error ? event.message : 'Araç durumu okunamadı.') } finally { setLoading(false) }
  }

  async function runGitStatus() {
    if (!projectPath) { setError('Önce bir proje klasörü açın.'); return }
    setLoading(true); setError('')
    try {
      const result = await window.kodAtolyesi.runGitTool({ args: ['status', '--short'], reason: 'Geliştirici panelinden Git durumunu kontrol et' })
      if (result.blocked) { setError(result.blockReason ?? result.stderr ?? 'Git işlemi engellendi.'); return }
      if (result.approvalRequired) { setToast('Git durum kontrolü için onay bekleniyor.'); return }
      setToast('Git durumu kontrol edildi.')
    } catch (event) { setError(event instanceof Error ? event.message : 'Git işlemi başarısız.') } finally { setLoading(false) }
  }

  return <div className="android-panel developer-tools-panel">
    <div className="panel-intro"><div><strong>Geliştirici araçları</strong><span>Ortam araçları ve güvenli Git işlemleri</span></div><button className="icon-button tiny" onClick={() => void loadTools()} disabled={loading} title="Araçları kontrol et">{loading ? '…' : 'Yenile'}</button></div>
    <div className="desktop-action-row"><button className="android-text-action" onClick={() => void loadTools()} disabled={loading}>Araçları kontrol et</button><button className="android-text-action" onClick={() => void runGitStatus()} disabled={loading || !projectPath}>Git durumunu kontrol et</button></div>
    <div className="developer-tools-list">{Object.entries(status).map(([name, value]) => <div className="developer-tool-row" key={name}><code>{name}</code><span className={value.includes('eksik') ? 'invalid' : 'valid'}>{value}</span></div>)}</div>
    {!projectPath && <div className="panel-hint">Git işlemleri için önce proje klasörü açın.</div>}
    {error && <div className="panel-error">{error}</div>}
  </div>
}
