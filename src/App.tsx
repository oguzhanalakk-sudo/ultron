import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { diffLines } from 'diff'
import {
  Activity, AlertCircle, ArrowRight, ArrowUp, Bot, Brain, Check, CheckCheck,
  ChevronDown, ChevronRight, Circle, Clock3, Code2, Copy, File, FileCode2,
  FileJson2, FileText, Folder, FolderOpen, GitCompareArrows,
  Hammer, ListTree, LoaderCircle, MoreHorizontal, PanelRightClose,
  PanelRightOpen, Pause, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Monitor,
  SquareTerminal, Trash2, Undo2, X, Zap, Smartphone, Radio,
  Globe2, Database, Cpu, Gauge, Box, Download, Puzzle, ChevronsRight,
} from 'lucide-react'
import type { ActivityItem, AndroidDevice, AndroidEnvironment, AppConfig, AppEvent, ApprovalDecision, ApprovalGrantScope, ApprovalRequest, BuildRecord, LocalAIStatus, LocalPullProgress, MemoryKind, ModelStatus, PermissionCategory, PermissionGrant, PermissionProfile, ProjectInfo, ProjectMemory, Proposal, ResourceRoot, TaskPlan, TaskRecord, TreeNode, UserMemory, VoiceStatus, WorkspaceState, WebProjectAnalysis, WindowsEnvironment } from '../electron/shared'
import { broadAccessPermissions } from '../electron/shared'
import type { AndroidProjectAnalysis } from '../electron/android-build-tool'
import type { WindowsProjectAnalysis } from '../electron/windows-build-tool'
import DesktopAutomationPanel from './DesktopAutomationPanel'
import DeveloperToolsPanel from './DeveloperToolsPanel'
import { openUrlInBrowser } from './open-url'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type SideTab = 'changes' | 'activity' | 'android' | 'web' | 'research' | 'windows' | 'localai' | 'memory' | 'files' | 'software' | 'plugins' | 'desktop' | 'tools'
// Yan panel sekmeleri tek kaynaktan üretilir: hem geniş sekme çubuğu hem de daraltılmış dikey şerit aynı listeyi kullanır.
const SIDE_TABS: Array<{ id: SideTab; label: string; icon: typeof Activity }> = [
  { id: 'changes', label: 'Değişiklikler', icon: GitCompareArrows },
  { id: 'activity', label: 'İşlemler', icon: Activity },
  { id: 'android', label: 'Android', icon: Smartphone },
  { id: 'web', label: 'Web', icon: Globe2 },
  { id: 'research', label: 'Araştırma', icon: Search },
  { id: 'windows', label: 'Windows', icon: Monitor },
  { id: 'localai', label: 'Yerel AI', icon: Cpu },
  { id: 'memory', label: 'Hafıza', icon: Database },
  { id: 'files', label: 'Dosyalar', icon: Search },
  { id: 'software', label: 'Yazılımlar', icon: Box },
  { id: 'plugins', label: 'Eklentiler', icon: Puzzle },
  { id: 'desktop', label: 'Masaüstü', icon: Monitor },
  { id: 'tools', label: 'Araçlar', icon: Hammer },
]
const RIGHT_PANEL_STORAGE_KEY = 'ultron.rightPanelCollapsed'
type SettingsForm = { provider: AppConfig['provider']; baseUrl: string; model: string; profileName: string; profileInstructions: string; autoLearn: boolean; apiKey: string; apiKeyConfigured: boolean; clearApiKey: boolean }

const timeNow = () => new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
const formatBytes = (text: string) => new Blob([text]).size < 1024 ? `${new Blob([text]).size} B` : `${(new Blob([text]).size / 1024).toFixed(1)} KB`
const formatFileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1024 ** 3 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / (1024 ** 3)).toFixed(1)} GB`
const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return ''
  const minutes = Math.floor(Math.max(0, diff) / 60000)
  if (minutes < 1) return 'şimdi'
  if (minutes < 60) return `${minutes} dk`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} sa`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} gün`
  return new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })
}
const permissionCategoryLabel = (category: PermissionCategory | '*') => ({ development: 'Geliştirme komutları', package: 'Paket kurulumu', system: 'Salt okunur PowerShell sorgusu', 'system-script': 'PowerShell betiği', 'network-scan': 'Özel ağ envanteri', destructive: 'Yıkıcı komut', 'security-audit': 'Güvenlik denetimi', 'file-rename': 'Dosya yeniden adlandırma', 'file-delete': 'Geri alınabilir dosya silme', 'screen-capture': 'Ekranı görüntüleme', 'input-control': 'Fare ve klavye kontrolü', 'app-launch': 'Uygulama başlatma', 'file-read': 'Dosya okuma', 'file-create': 'Dosya oluşturma', 'file-edit': 'Dosya düzenleme', '*': 'Tüm uygun kategoriler' })[category]
const permissionScopeLabel = (grant: PermissionGrant) => grant.scope === 'task' ? 'Görev' : grant.scope === 'project' ? 'Proje' : 'Kalıcı kategori'
const grantableCategories: PermissionCategory[] = ['development', 'package', 'system', 'security-audit', 'file-rename', 'file-delete', 'screen-capture', 'app-launch', 'file-read', 'file-create', 'file-edit', 'input-control']
const agentStageLabel = (stage: TaskRecord['stage']) => ({ analyzing: 'Analiz', planning: 'Planlama', awaiting_approval: 'Onay bekliyor', executing: 'Uygulama', evaluating: 'Sonuçları değerlendiriyor', correcting: 'Hata düzeltme', testing: 'Test / derleme', finalizing: 'Son doğrulama', paused: 'Duraklatıldı', interrupted: 'Kesildi', blocked: 'Engellendi', completed: 'Tamamlandı', failed: 'Başarısız', cancelled: 'İptal edildi' })[stage]
const agentErrorLabel = (category: NonNullable<TaskRecord['errorAnalysis']>['category']) => ({ syntax: 'Sözdizimi', build: 'Derleme', runtime: 'Çalışma zamanı', dependency: 'Bağımlılık', configuration: 'Yapılandırma', permission: 'Yetki', filesystem: 'Dosya sistemi', network: 'Ağ', test: 'Test', resources: 'Kaynak', unknown: 'Bilinmeyen' })[category]

function IconForFile({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (['tsx', 'ts', 'jsx', 'js', 'kt', 'java', 'py', 'go', 'rs', 'css'].includes(ext ?? '')) return <FileCode2 size={14} className="file-icon code" />
  if (['json', 'xml', 'yaml', 'yml', 'toml', 'gradle', 'properties'].includes(ext ?? '')) return <FileJson2 size={14} className="file-icon config" />
  if (['md', 'txt', 'html'].includes(ext ?? '')) return <FileText size={14} className="file-icon text" />
  return <File size={14} className="file-icon" />
}

function TreeItem({ node, depth, onOpen }: { node: TreeNode; depth: number; onOpen: (path: string) => void }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.kind === 'directory' && Boolean(node.children?.length)
  if (node.kind === 'directory') return <div className="tree-group">
    <button className="tree-item folder-row" style={{ paddingLeft: 12 + depth * 13 }} onClick={() => setExpanded(!expanded)}>
      {hasChildren ? expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="tree-spacer" />}
      {expanded ? <FolderOpen size={14} className="folder-icon" /> : <Folder size={14} className="folder-icon" />}
      <span>{node.name}</span>
    </button>
    {expanded && node.children?.map((child) => <TreeItem key={child.path} node={child} depth={depth + 1} onOpen={onOpen} />)}
  </div>
  return <button className="tree-item file-row" style={{ paddingLeft: 27 + depth * 13 }} onClick={() => onOpen(node.path)}><IconForFile name={node.name} /><span>{node.name}</span></button>
}

function DiffPreview({ proposal }: { proposal: Proposal }) {
  const changes = useMemo(() => diffLines(proposal.oldContent, proposal.newContent), [proposal.oldContent, proposal.newContent])
  let count = 0
  return <div className="diff-preview"><div className="diff-file-head"><GitCompareArrows size={13} /><span>{proposal.path}</span></div>
    <div className="diff-lines">{changes.map((part, index) => part.value.split(/(?<=\n)/).filter(Boolean).map((line, lineIndex) => {
      count++
      if (count > 96) return null
      return <div key={`${index}-${lineIndex}`} className={`diff-line ${part.added ? 'added' : part.removed ? 'removed' : ''}`}><span className="diff-sign">{part.added ? '+' : part.removed ? '−' : ' '}</span><code>{line.replace(/\n$/, '') || ' '}</code></div>
    }))}{count > 96 && <div className="diff-more">Önizleme kısaltıldı</div>}</div>
  </div>
}

function Markdown({ children, onOpenUrlError }: { children: string; onOpenUrlError?: () => void }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children: label, href, ...props }) => <a {...props} href={href} target="_blank" rel="noreferrer" onClick={(event) => {
      event.preventDefault()
      if (href) void openUrlInBrowser(href).then((opened) => { if (!opened) onOpenUrlError?.() })
    }}>{label}</a>,
    code: ({ className, children: value, ...props }) => className ? <code className={className} {...props}>{value}</code> : <code className="inline-code" {...props}>{value}</code>,
  }}>{children}</ReactMarkdown>
}

function AndroidWorkspacePanel({ environment, devices, analysis, build, projectOpen, loading, error, onRefresh, onAnalyze }: {
  environment: AndroidEnvironment | null; devices: AndroidDevice[]; analysis: AndroidProjectAnalysis | null; build: BuildRecord | null
  projectOpen: boolean; loading: boolean; error: string; onRefresh: () => void; onAnalyze: () => void
}) {
  const stateLabel = (state: string) => state === 'available' ? 'Hazır' : state === 'missing' ? 'Eksik' : state === 'error' ? 'Kontrol hatası' : 'İsteğe bağlı'
  const currentBuild = build?.android
  return <div className="android-panel">
    <div className="panel-intro android-panel-intro"><div><strong>Android araçları</strong><span>SDK, Gradle ve cihaz durumu</span></div><button className="icon-button tiny" onClick={onRefresh} title="Android durumunu yenile"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>
    {error && <div className="android-inline-error"><AlertCircle size={13} /><span>{error}</span></div>}
    {environment ? <>
      <div className="android-env-summary"><div><small>İşletim sistemi</small><strong>{environment.os}</strong></div><div><small>Android SDK</small><strong title={environment.sdkPath}>{environment.sdkAvailable ? 'Kurulu' : 'Bulunamadı'}</strong></div><div><small>Platformlar</small><strong>{environment.installedPlatforms.join(', ') || 'Yok'}</strong></div></div>
      <div className="android-section-head"><strong>Geliştirme ortamı</strong><span>{environment.checks.filter((item) => item.required && item.state === 'available').length}/{environment.checks.filter((item) => item.required).length} gerekli araç hazır</span></div>
      <div className="android-check-list">{environment.checks.map((check) => <div className="android-check-row" key={check.id}><span className={`android-state-dot ${check.state}`} /><div><strong>{check.label}</strong><small>{check.version ?? check.detail ?? check.path ?? 'Sürüm bilgisi yok'}</small></div><span className={`android-state-label ${check.state}`}>{stateLabel(check.state)}</span></div>)}</div>
      {environment.recommendations.length > 0 && <div className="android-recommendations"><strong>Kurulum önerileri</strong>{environment.recommendations.map((item) => <p key={item}>{item}</p>)}</div>}
    </> : <div className="android-loading">{loading ? 'Android geliştirme ortamı denetleniyor…' : 'Durum bilgisi yok.'}</div>}

    <div className="android-section-head"><strong>ADB cihazları</strong><span>{devices.filter((device) => device.state === 'device').length} yetkili</span></div>
    {devices.length ? <div className="android-device-list">{devices.map((device) => <div className="android-device-row" key={device.serial}><Smartphone size={14} /><div><strong>{device.serial}</strong><small>{device.details || 'Android cihaz'}</small></div><span className={`device-state ${device.state}`}>{device.state === 'device' ? 'Bağlı' : device.state === 'unauthorized' ? 'Yetki bekliyor' : device.state}</span></div>)}</div> : <div className="android-empty-row"><Radio size={14} /> Bağlı cihaz/emülatör yok. Derleme yapılabilir; cihaz testi doğrulanmış sayılmaz.</div>}

    <div className="android-section-head android-project-heading"><strong>Seçili proje</strong><button className="android-text-action" onClick={onAnalyze} disabled={!projectOpen || loading}>{loading ? 'İnceleniyor…' : 'Projeyi analiz et'}</button></div>
    {!projectOpen ? <div className="android-empty-row">Proje kökü açıldığında Gradle modülleri ve Manifest taranır.</div> : analysis ? analysis.isAndroidProject ? <>
      <div className="android-analysis-summary"><strong>{analysis.rootProjectName ?? 'Android proje'}</strong><span>{analysis.languages.join(' · ') || 'Kaynak dili bulunmadı'}</span><span>{analysis.hasGradleWrapper ? 'Gradle Wrapper var' : 'Wrapper eksik'}</span></div>
      {analysis.modules.map((module) => <div className="android-module-row" key={module.path}><div><strong>{module.path} · {module.kind}</strong><small>{module.applicationId ?? module.namespace ?? 'Uygulama kimliği yok'} · SDK {module.compileSdk ?? 'belirsiz'} / min {module.minSdk ?? 'belirsiz'}</small></div><span>{module.languages.join('+') || '—'}{module.usesCompose ? ' · Compose' : ''}</span></div>)}
      {analysis.findings.map((finding) => <div className="android-finding" key={finding}><AlertCircle size={12} />{finding}</div>)}
    </> : <div className="android-empty-row">Açık klasörde Android Gradle modülü bulunamadı. Android proje kökünü seçin.</div> : <div className="android-loading">Projeyi analiz etmek için düğmeye basın.</div>}

    {currentBuild && <div className="android-last-build"><div className="android-section-head"><strong>Son Android görevi</strong><span className={currentBuild.failure ? 'failed' : 'passed'}>{currentBuild.failure ? 'Doğrulama başarısız' : `Çıkış ${build?.exitCode ?? '—'}`}</span></div><div><b>{currentBuild.task}</b> · {currentBuild.buildType} · {(currentBuild.durationMs / 1000).toFixed(1)} sn</div><div className="android-test-state">Test durumu: {currentBuild.testStatus === 'passed' ? 'başarılı' : currentBuild.testStatus === 'failed' ? 'başarısız' : currentBuild.testStatus === 'cancelled' ? 'iptal' : 'çalıştırılmadı'}</div>{currentBuild.failure && <p>{currentBuild.failure.summary}</p>}{currentBuild.artifacts.map((artifact) => <div className="android-artifact-row" key={artifact.path}><span className={artifact.validZip ? 'valid' : 'invalid'}>{artifact.validZip ? '✓' : '!'}</span><code title={artifact.path}>{artifact.path}</code><small>{artifact.format.toUpperCase()} · {formatFileSize(artifact.size)}</small></div>)}</div>}
  </div>
}

function WebWorkspacePanel({ analysis, projectOpen, loading, error, onAnalyze }: {
  analysis: WebProjectAnalysis | null; projectOpen: boolean; loading: boolean; error: string; onAnalyze: () => void
}) {
  const front = analysis?.frontend.length ? analysis.frontend.join(' · ') : 'Algılanmadı'
  const back = analysis?.backend.length ? analysis.backend.join(' · ') : 'Algılanmadı'
  const db = analysis?.databases.length ? analysis.databases.join(' · ') : 'Algılanmadı'
  return <div className="android-panel web-panel">
    <div className="panel-intro android-panel-intro"><div><strong>Web proje araçları</strong><span>Arayüz, API ve veritabanı analizi</span></div><button className="icon-button tiny" onClick={onAnalyze} disabled={!projectOpen || loading} title="Web projesini analiz et"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>
    {!projectOpen ? <div className="android-empty-row">Proje kökü açıldığında web dosyaları ve kullandığı yığın taranır.</div> : loading ? <div className="android-loading">Proje dosyaları yerel olarak analiz ediliyor…</div> : error ? <div className="android-inline-error"><AlertCircle size={12} />{error}</div> : !analysis ? <div className="web-panel-empty"><Globe2 size={20} /><strong>Web projesini analiz et</strong><span>Dosyalardan arayüz, sunucu, veri katmanı ve test komutları bulunur.</span><button onClick={onAnalyze}>Analizi başlat</button></div> : <>
      <div className="web-stack-list"><div><Globe2 size={13} /><span>ÖN YÜZ</span><strong>{front}</strong></div><div><ServerCogIcon /><span>ARKA UÇ</span><strong>{back}</strong></div><div><Database size={13} /><span>VERİTABANI</span><strong>{db}</strong></div></div>
      <div className="web-metrics"><div><b>{analysis.filesScanned}</b><span>tarama dosyası</span></div><div><b>{analysis.apiFiles.length}</b><span>API / rota dosyası</span></div><div><b>{analysis.migrationFiles.length}</b><span>migration</span></div></div>
      <div className="android-section-head"><strong>Test ve derleme</strong><span>{analysis.tests.length ? `${analysis.tests.length} yapılandırma` : 'algılanmadı'}</span></div>
      <div className="web-chip-list">{analysis.tests.length ? analysis.tests.map((item) => <span key={item}>{item}</span>) : <span>Test komutu bulunamadı</span>}{analysis.packageManagers.map((item) => <span key={item}>{item}</span>)}</div>
      {Object.keys(analysis.packageScripts).length > 0 && <div className="web-scripts"><small>PACKAGE SCRIPTS</small>{Object.entries(analysis.packageScripts).slice(0, 8).map(([name, command]) => <div key={name}><b>{name}</b><code>{command}</code></div>)}</div>}
      {analysis.recommendations.map((item) => <div className="web-recommendation" key={item}><AlertCircle size={12} />{item}</div>)}
      <div className="web-analysis-foot">{[...analysis.dataAccess, ...analysis.packageManagers.filter((item) => item !== 'npm')].join(' · ') || 'Özel ORM veya ek paket yöneticisi algılanmadı'}</div>
    </>}
  </div>
}

type ResearchHit = { title: string; url: string; snippet: string; provider: string; publishedAt: string | null; rank: number }
type ResearchSummary = { title: string; text: string; url: string }

function ResearchPanel() {
  const [query, setQuery] = useState('React 19 useEffect SSR hatası')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ResearchHit[]>([])
  const [selected, setSelected] = useState<ResearchHit | null>(null)
  const [summary, setSummary] = useState<ResearchSummary | null>(null)
  const [error, setError] = useState('')
  const search = useCallback(async () => {
    if (query.trim().length < 3 || loading) return
    setLoading(true); setError('')
    try {
      const response = await window.kodAtolyesi.researchSearch(query.trim(), 8, 'tr')
      setResults(response.hits); setSelected(response.hits[0] ?? null)
      if (response.hits[0]) await selectSource(response.hits[0])
      else setSummary(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Arama başarısız.'); setResults([]); setSummary(null) }
    finally { setLoading(false) }
  }, [loading, query])
  const selectSource = useCallback(async (item: ResearchHit) => {
    setSelected(item)
    try { const page = await window.kodAtolyesi.researchFetch(item.url); setSummary({ title: page.title || item.title, text: page.text || item.snippet, url: page.url || item.url }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Kaynak okunamadı.') }
  }, [])
  return <div className="research-panel">
    <div className="android-section-head"><strong>Güvenli web araştırması</strong><span>{loading ? 'Araştırılıyor…' : results.length ? `${results.length} sonuç` : 'Hazır'}</span></div>
    <div className="research-search-row"><input className="settings-input" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search() }} placeholder="Web araştırma sorgusu" /><button className="panel-action" disabled={loading || query.trim().length < 3} onClick={() => void search()}>{loading ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />} Araştır</button></div>
    {error && <div className="panel-error"><AlertCircle size={13} />{error}</div>}
    <div className="research-grid"><div className="research-results">{results.map((item) => <button className={`research-result${selected?.url === item.url ? ' selected' : ''}`} key={`${item.url}-${item.rank}`} onClick={() => void selectSource(item)}><div><strong>{item.title}</strong><small>{item.provider}</small></div><code>{item.url}</code><span>{item.snippet || 'Özet yok.'}</span></button>)}{!results.length && !error && <div className="panel-blank small">Güncel kaynakları aramak için sorgu girin.</div>}</div><div className="research-summary"><small>SEÇİLİ KAYNAK</small>{summary ? <><strong>{summary.title}</strong><code>{summary.url}</code><p>{summary.text}</p></> : <span>Bir sonuç seçerek güvenli sayfa özetini okuyun.</span>}</div></div>
    <div className="research-security"><ShieldCheck size={12} /> Yalnızca güvenli http/https kaynakları okunur; localhost ve özel ağ adresleri reddedilir.</div>
  </div>
}

function WindowsWorkspacePanel({ environment, analysis, build, projectOpen, loading, error, onRefresh, onAnalyze }: {
  environment: WindowsEnvironment | null; analysis: WindowsProjectAnalysis | null; build: BuildRecord | null
  projectOpen: boolean; loading: boolean; error: string; onRefresh: () => void; onAnalyze: () => void
}) {
  const stateLabel = (state: string) => state === 'available' ? 'Hazır' : state === 'missing' ? 'Eksik' : state === 'error' ? 'Kontrol hatası' : 'İsteğe bağlı'
  const desktopBuild = build?.windows
  return <div className="android-panel windows-panel">
    <div className="panel-intro android-panel-intro"><div><strong>Windows masaüstü araçları</strong><span>SDK, framework ve paketleme durumu</span></div><button className="icon-button tiny" onClick={onRefresh} title="Windows araçlarını yenile"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>
    {error && <div className="android-inline-error"><AlertCircle size={13} /><span>{error}</span></div>}
    {environment ? <>
      <div className="android-env-summary windows-env-summary"><div><small>Windows</small><strong>{environment.os}</strong></div><div><small>Mimari</small><strong>{environment.architecture}</strong></div><div><small>RAM</small><strong>{formatFileSize(environment.memoryTotalBytes)}</strong></div></div>
      <div className="windows-machine-meta"><Monitor size={13} /> {environment.cpu} · {environment.cpuCores} mantıksal çekirdek · {formatFileSize(environment.memoryFreeBytes)} boş RAM</div>
      <div className="android-section-head"><strong>Geliştirme araçları</strong><span>{environment.checks.filter((item) => item.state === 'available').length}/{environment.checks.length} hazır</span></div>
      <div className="android-check-list">{environment.checks.map((check) => <div className="android-check-row" key={check.id}><span className={`android-state-dot ${check.state}`} /><div><strong>{check.label}</strong><small title={check.path ?? check.detail ?? ''}>{check.version ?? check.detail ?? check.path ?? 'Sürüm sorgulanamadı'}</small></div><span className={`android-state-label ${check.state}`}>{stateLabel(check.state)}</span></div>)}</div>
      {environment.pythonEnvironments.length > 0 && <div className="windows-python-env"><strong>Python ortamları</strong>{environment.pythonEnvironments.map((item) => <code key={item}>{item}</code>)}</div>}
      {environment.recommendations.map((item) => <div className="web-recommendation" key={item}><AlertCircle size={12} />{item}</div>)}
    </> : <div className="android-loading">{loading ? 'Windows geliştirme araçları denetleniyor…' : 'Durum bilgisi yok.'}</div>}

    <div className="android-section-head android-project-heading"><strong>Seçili proje</strong><button className="android-text-action" onClick={onAnalyze} disabled={!projectOpen || loading}>{loading ? 'İnceleniyor…' : 'Projeyi analiz et'}</button></div>
    {!projectOpen ? <div className="android-empty-row">Proje kökünü açıp Windows masaüstü teknoloji yığınını analiz edin.</div> : loading && !analysis ? <div className="android-loading">Kaynak ve proje yapılandırması taranıyor…</div> : analysis ? analysis.primaryTechnology !== 'unknown' ? <>
      <div className="android-analysis-summary"><strong>{analysis.projectName}</strong><span>{analysis.technologies.join(' · ')}</span><span>{analysis.frameworks.join(' · ') || 'Framework yok'}</span></div>
      <div className="web-metrics windows-metrics"><div><b>{analysis.filesScanned}</b><span>dosya</span></div><div><b>{analysis.projectFiles.length}</b><span>proje yapılandırması</span></div><div><b>{analysis.testFiles.length}</b><span>test dosyası</span></div></div>
      {analysis.projectFiles.slice(0, 12).map((item) => <div className="windows-project-file" key={item}><code>{item}</code></div>)}
      {analysis.recommendations.map((item) => <div className="web-recommendation" key={item}><AlertCircle size={12} />{item}</div>)}
    </> : <div className="android-empty-row">Desteklenen Python, .NET, Electron, Tauri veya CMake projesi algılanmadı.</div> : <div className="android-loading">Projeyi analiz etmek için düğmeye basın.</div>}

    {desktopBuild && <div className="android-last-build windows-last-build"><div className="android-section-head"><strong>Son Windows işlemi</strong><span className={desktopBuild.failure ? 'failed' : 'passed'}>{desktopBuild.failure ? 'Başarısız' : `Çıkış ${build?.exitCode ?? '—'}`}</span></div><div><b>{desktopBuild.action}</b> · {desktopBuild.technology} · {(desktopBuild.durationMs / 1000).toFixed(1)} sn</div><div className="android-test-state">Test: {desktopBuild.testStatus === 'passed' ? 'başarılı' : desktopBuild.testStatus === 'failed' ? 'başarısız' : desktopBuild.testStatus === 'cancelled' ? 'iptal' : 'çalıştırılmadı'}</div>{desktopBuild.failure && <p>{desktopBuild.failure.summary}<br /><small>{desktopBuild.failure.suggestedAction}</small></p>}{desktopBuild.artifacts.map((artifact) => <div className="android-artifact-row" key={artifact.path}><span className={artifact.valid ? 'valid' : 'invalid'}>{artifact.valid ? '✓' : '!'}</span><code title={artifact.path}>{artifact.path}</code><small>{artifact.kind.toUpperCase()} · {formatFileSize(artifact.size)}</small></div>)}{desktopBuild.notes.map((note) => <p className="windows-build-note" key={note}>{note}</p>)}</div>}
  </div>
}

function LocalAIPanel({ status, voice, loading, error, action, progress, pullName, onPullName, onRefresh, onPull, onDelete, onToggleLoad, onTest, onSelectModel }: {
  status: LocalAIStatus | null; voice: VoiceStatus | null; loading: boolean; error: string; action: string; progress: LocalPullProgress | null
  pullName: string; onPullName: (value: string) => void; onRefresh: () => void; onPull: (model: string) => void
  onDelete: (model: string) => void; onToggleLoad: (model: string, loaded: boolean) => void
  onTest: (model: string) => void; onSelectModel: (model: string) => void
}) {
  const hardware = status?.hardware
  const memoryUsed = hardware ? Math.max(0, hardware.memoryTotalBytes - hardware.memoryFreeBytes) : 0
  const memoryPercent = hardware && hardware.memoryTotalBytes > 0 ? Math.min(100, Math.round((memoryUsed / hardware.memoryTotalBytes) * 100)) : 0
  const diskPercent = hardware?.diskTotalBytes && hardware.diskFreeBytes !== null ? Math.min(100, Math.round(((hardware.diskTotalBytes - hardware.diskFreeBytes) / hardware.diskTotalBytes) * 100)) : null
  const busy = Boolean(action)
  return <div className="android-panel localai-panel">
    <div className="panel-intro android-panel-intro"><div><strong>Yerel AI çekirdeği</strong><span>Ollama · donanım · model yönetimi</span></div><button className="icon-button tiny" onClick={onRefresh} disabled={loading} title="Yerel AI durumunu yenile"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>
    {error && <div className="android-inline-error"><AlertCircle size={13} /><span>{error}</span></div>}

    <div className="localai-status-card">
      <div className="localai-status-head"><span className={`localai-dot ${status?.connected ? 'online' : ''}`} /><strong>{status?.connected ? 'Yerel Ollama bağlı' : 'Ollama yanıt vermiyor'}</strong><span className="localai-version">{status?.version ? `v${status.version}` : ''}</span></div>
      <div className="localai-status-meta"><span>Adres <code>{status?.baseUrl ?? '—'}</code></span><span>Seçili model <b>{status?.selectedModel ?? '—'}</b></span><span>Kurulu model <b>{status?.models.length ?? 0}</b> · kapladığı alan {formatFileSize(status?.diskUsageBytes ?? 0)}</span></div>
      {status?.note && <p className="localai-note"><AlertCircle size={12} />{status.note}</p>}
      {!status && <p className="localai-note">{loading ? 'Yerel AI durumu okunuyor…' : 'Yerel AI durumu henüz yüklenmedi.'}</p>}
    </div>

    {hardware && <div className="localai-section">
      <h4><Cpu size={13} /> Donanım (yerel ölçüm)</h4>
      <div className="localai-hardware">
        <div><span>İşlemci</span><b>{hardware.cpu}</b><small>{hardware.cpuCores} mantıksal çekirdek · {hardware.architecture}</small></div>
        <div><span>Ekran kartı</span><b>{hardware.gpu ?? 'Ayrık GPU bulunamadı'}</b><small>{hardware.gpuMemoryBytes ? `${formatFileSize(hardware.gpuMemoryBytes)} VRAM` : 'VRAM bilgisi okunamadı'}</small></div>
      </div>
      <div className="localai-meter"><div><span>RAM</span><b>{formatFileSize(memoryUsed)} / {formatFileSize(hardware.memoryTotalBytes)}</b></div><div className="localai-track"><i style={{ width: `${memoryPercent}%` }} /></div></div>
      {diskPercent !== null && <div className="localai-meter"><div><span>Disk (C:)</span><b>{formatFileSize(hardware.diskFreeBytes ?? 0)} boş / {formatFileSize(hardware.diskTotalBytes ?? 0)}</b></div><div className="localai-track"><i style={{ width: `${diskPercent}%` }} /></div></div>}
      <p className="localai-foot">İşletim sistemi: {hardware.os} · Ölçüm: {new Date(hardware.detectedAt).toLocaleTimeString('tr-TR')}</p>
    </div>}

    <div className="localai-section">
      <h4><Gauge size={13} /> Ölçülen performans</h4>
      <div className="localai-stats">
        <div><span>Yanıt</span><b>{status?.stats.requests ?? 0}</b></div>
        <div><span>Hata</span><b>{status?.stats.failedRequests ?? 0}</b></div>
        <div><span>Son yanıt</span><b>{status?.stats.lastDurationMs ? `${(status.stats.lastDurationMs / 1000).toFixed(1)} sn` : '—'}</b></div>
        <div><span>Son hız</span><b>{status?.stats.lastTokensPerSecond ? `${status.stats.lastTokensPerSecond} tok/sn` : '—'}</b></div>
      </div>
      <p className="localai-foot">{status?.stats.lastMeasuredAt ? `Son ölçüm ${new Date(status.stats.lastMeasuredAt).toLocaleString('tr-TR')} · toplam ${status.stats.totalEvaluatedTokens} değerlendirilen token` : 'Henüz ölçülmüş model yanıtı yok. Değerler yalnızca gerçek Ollama yanıtlarından sonra gösterilir.'}</p>
    </div>

    <div className="localai-section">
      <h4><Box size={13} /> Kurulu modeller <span className="localai-section-count">{status?.models.length ?? 0}</span></h4>
      {status?.models.length ? <div className="localai-models">{status.models.map((model) => <div className={`localai-model ${model.name === status.selectedModel ? 'selected' : ''}`} key={model.name}>
        <div className="localai-model-head"><strong>{model.name}</strong>{model.loaded && <span className="localai-badge loaded">bellekte</span>}{model.name === status.selectedModel && <span className="localai-badge selected">seçili</span>}</div>
        <div className="localai-model-meta"><span>{formatFileSize(model.sizeBytes)}</span>{model.parameterSize && <span>{model.parameterSize}</span>}{model.quantization && <span>{model.quantization}</span>}{model.family && <span>{model.family}</span>}</div>
        <p className={`localai-fit ${model.fit.level}`}><b>{model.fit.label}</b> · {model.fit.detail}</p>
        <div className="localai-model-actions">
          {model.name !== status.selectedModel && <button disabled={busy} onClick={() => onSelectModel(model.name)}>Kullan</button>}
          <button disabled={busy} onClick={() => onToggleLoad(model.name, !model.loaded)}>{model.loaded ? 'Bellekten boşalt' : 'Belleğe yükle'}</button>
          <button disabled={busy} onClick={() => onTest(model.name)}>{action === 'test' ? 'Test ediliyor…' : 'Test et'}</button>
          {model.name !== status.selectedModel && <button className="danger" disabled={busy} onClick={() => onDelete(model.name)}><Trash2 size={11} /> Sil</button>}
        </div>
      </div>)}</div> : <p className="localai-empty">{status?.connected ? 'Ollama kataloğunda kurulu model yok. Aşağıdan isteğe bağlı model indirebilirsin, mevcut Ollama modellerini de kullanabilirsin.' : 'Ollama yanıt vermediği için model listesi okunamadı.'}</p>}
    </div>

    <div className="localai-section">
      <h4><Download size={13} /> Model indir <span className="localai-section-count">isteğe bağlı</span></h4>
      <p className="localai-note"><AlertCircle size={12} />İndirme yalnızca sen başlattığında çalışır ve internet gerektirir. Ultron hiçbir bulut yapay zekâ servisine istek göndermez; model Ollama'nın yerel kataloğuna eklenir.</p>
      <div className="localai-pull">
        <input value={pullName} onChange={(event) => onPullName(event.target.value)} placeholder="qwen2.5-coder:7b" disabled={busy} list="localai-model-suggestions" aria-label="İndirilecek yerel model adı" />
        <datalist id="localai-model-suggestions">{status?.recommendations.map((item) => <option key={item.name} value={item.name} />)}</datalist>
        <button disabled={busy || !pullName.trim()} onClick={() => onPull(pullName.trim())}>{action === 'pull' ? 'İndiriliyor…' : 'İndir'}</button>
      </div>
      {progress && <div className={`localai-progress ${progress.done ? 'done' : ''}`}><div><span>{progress.model}</span><b>{progress.error ? 'hata' : progress.status}{progress.percent !== null && !progress.error ? ` · %${progress.percent}` : ''}</b></div><div className="localai-track"><i style={{ width: `${progress.percent ?? 0}%` }} /></div>{progress.error && <p>{progress.error}</p>}</div>}
      {status?.recommendations.length ? <div className="localai-recommendations">{status.recommendations.map((item) => <div key={item.name}><b>{item.name}</b><span>{item.reason} · {item.sizeHint}</span></div>)}</div> : null}
      <p className="localai-foot">Model dosyaları Ultron klasöründe değil, Ollama'nın kendi model deposunda tutulur. Mevcut dosyaları kullanmak için Ollama'da görünen bir modeli yukarıdan seçmen yeterli.</p>
    </div>

    {voice && <div className="localai-section">
      <h4><Radio size={13} /> Ses araçları <span className="localai-section-count">{voice.available ? 'bulundu' : 'eksik'}</span></h4>
      <div className="localai-voice">
        {[...voice.speechToText, ...voice.textToSpeech].map((item) => <div key={item.id}><span className={`localai-dot ${item.state === 'available' ? 'online' : ''}`} /><div><b>{item.label}</b><small title={item.path ?? ''}>{item.path ?? item.note}</small></div><span className={`localai-badge ${item.state === 'available' ? 'selected' : ''}`}>{item.state === 'available' ? 'bulundu' : 'yok'}</span></div>)}
      </div>
      <p className="localai-foot">{voice.note}</p>
    </div>}
  </div>
}

function ServerCogIcon() { return <span className="web-server-icon" aria-hidden="true">API</span> }

const memoryKindOptions: { kind: MemoryKind; label: string; hint: string }[] = [
  { kind: 'preference', label: 'Tercih', hint: 'İletişim ve çalışma tercihleri' },
  { kind: 'knowledge', label: 'Bilgi', hint: 'Kalıcı olmasını istediğin bilgiler' },
  { kind: 'feedback', label: 'Geri bildirim', hint: 'Düzeltmeler ve öğrenilen dersler' },
  { kind: 'conversation', label: 'Konuşma/görev özeti', hint: 'Otomatik öğrenme açıkken görev özetleri' },
]

function MemoryPanel({ memory, loading, error, projectPath, onRefresh }: { memory: UserMemory | null; loading: boolean; error: string; projectPath: string | null; onRefresh: () => void }) {
  const [kind, setKind] = useState<MemoryKind>('knowledge')
  const [draft, setDraft] = useState('')
  const [action, setAction] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const entries = memory?.entries ?? []
  async function run(label: string, task: () => Promise<unknown>) {
    setAction(label); setNotice('')
    try { await task() } catch (exception) { setNotice((exception as Error).message) } finally { setAction('') }
  }
  async function addEntry() {
    if (!draft.trim()) return
    await run('add', async () => {
      const result = await window.kodAtolyesi.addUserMemory({ kind, text: draft.trim() })
      setDraft('')
      setNotice(result.action === 'merged' ? 'Benzer bir kayıt vardı; yeni bilgiyle güncellendi.' : result.action === 'conflict' ? 'Kayıt eklendi; önceki bir kayıtla çelişki olarak işaretlendi.' : 'Kayıt yerel hafızaya eklendi.')
    })
  }
  return <div className="android-panel memory-panel">
    <div className="panel-intro android-panel-intro"><div><strong>Kişisel hafıza</strong><span>Yalnızca bu bilgisayarda · kullanıcı onaylı</span></div><button className="icon-button tiny" onClick={onRefresh} disabled={loading} title="Hafızayı yenile"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>
    {error && <div className="android-inline-error"><AlertCircle size={13} /><span>{error}</span></div>}
    <p className="localai-note"><AlertCircle size={12} />Sohbette "şunu hatırla: …" veya "hafızaya kaydet: …" dediğinde kayıt buraya eklenir. "Bunu unut: …" ile silinir. Otomatik öğrenme yalnızca ayarlardan açıldığında çalışır ve hiçbir veri cihazdan çıkmaz.</p>
    <div className="memory-add">
      <select value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)} aria-label="Hafıza türü">{memoryKindOptions.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}</select>
      <textarea id="memory-draft" value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={2000} placeholder={`${memoryKindOptions.find((option) => option.kind === kind)?.hint}…`} />
      <button className="apply-button" disabled={Boolean(action) || !draft.trim()} onClick={() => void addEntry()}>{action === 'add' ? 'Ekleniyor…' : 'Hafızaya ekle'}</button>
    </div>
    {notice && <p className="localai-foot">{notice}</p>}
    {memoryKindOptions.map((group) => {
      const groupEntries = entries.filter((entry) => entry.kind === group.kind)
      if (!groupEntries.length) return null
      return <div className="memory-group" key={group.kind}>
        <div className="android-section-head"><strong>{group.label}</strong><span>{groupEntries.length} kayıt</span></div>
        {groupEntries.map((entry) => <div className={`memory-entry ${entry.conflictWith ? 'conflict' : ''}`} key={entry.id}>
          {editing?.id === entry.id ? <div className="memory-edit">
            <textarea value={editing.text} rows={3} maxLength={2000} onChange={(event) => setEditing({ id: entry.id, text: event.target.value })} />
            <div className="memory-entry-actions">
              <button disabled={Boolean(action)} onClick={() => void run('save', async () => { await window.kodAtolyesi.updateUserMemory(entry.id, { text: editing.text }); setEditing(null) })}>{action === 'save' ? 'Kaydediliyor…' : 'Kaydet'}</button>
              <button disabled={Boolean(action)} onClick={() => setEditing(null)}>Vazgeç</button>
            </div>
          </div> : <>
            <p>{entry.text}</p>
            <div className="memory-entry-meta">
              {entry.projectPath ? <span title={entry.projectPath}>Proje: {entry.projectPath.split(/[\\/]/).pop()}</span> : <span>Genel</span>}
              <span>{new Date(entry.updatedAt).toLocaleString('tr-TR')}</span>
              {entry.conflictWith && <span className="memory-conflict">Çelişki işaretli</span>}
              {entry.tags.map((tag) => <code key={tag}>{tag}</code>)}
            </div>
            <div className="memory-entry-actions">
              <button disabled={Boolean(action)} onClick={() => setEditing({ id: entry.id, text: entry.text })}><Pencil size={11} /> Düzenle</button>
              <button className="danger" disabled={Boolean(action)} onClick={() => void run('delete', () => window.kodAtolyesi.deleteUserMemory(entry.id))}><Trash2 size={11} /> Sil</button>
            </div>
          </>}
        </div>)}
      </div>
    })}
    {memory && !entries.length && <div className="panel-blank small"><div className="blank-icon"><Database size={17} /></div><strong>Hafıza henüz boş</strong><p>Sohbette "şunu hatırla: …" diyerek veya yukarıdaki formla kalıcı bilgi ekleyebilirsin.</p></div>}
    {entries.length > 0 && <div className="memory-danger-zone">
      {confirmClear ? <div className="memory-entry-actions"><button className="danger" disabled={Boolean(action)} onClick={() => void run('clear', async () => { await window.kodAtolyesi.clearUserMemory(); setConfirmClear(false) })}>Evet, tüm hafızayı sil</button><button disabled={Boolean(action)} onClick={() => setConfirmClear(false)}>Vazgeç</button></div> : <button className="danger" onClick={() => setConfirmClear(true)}><Trash2 size={12} /> Tüm hafızayı temizle</button>}
    </div>}
    <p className="localai-foot">Depolama: kullanıcı veri klasöründeki <code>memory.json</code> · en fazla 400 kayıt{projectPath ? ` · açık proje: ${projectPath}` : ''}. Hafıza hiçbir dış servise gönderilmez; dilediğin kaydı düzenleyip silebilirsin.</p>
  </div>
}

function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [taskHistory, setTaskHistory] = useState<TaskRecord[]>([])
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [activityLog, setActivityLog] = useState<ActivityItem[]>([])
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([])
  const [approvalScopes, setApprovalScopes] = useState<Record<string, ApprovalGrantScope>>({})
  const [status, setStatus] = useState<ModelStatus | null>(null)
  const [androidEnvironment, setAndroidEnvironment] = useState<AndroidEnvironment | null>(null)
  const [androidDevices, setAndroidDevices] = useState<AndroidDevice[]>([])
  const [androidProject, setAndroidProject] = useState<AndroidProjectAnalysis | null>(null)
  const [androidLoading, setAndroidLoading] = useState(false)
  const [androidError, setAndroidError] = useState('')
  const [webAnalysis, setWebAnalysis] = useState<WebProjectAnalysis | null>(null)
  const [webLoading, setWebLoading] = useState(false)
  const [webError, setWebError] = useState('')
  const [windowsEnvironment, setWindowsEnvironment] = useState<WindowsEnvironment | null>(null)
  const [windowsAnalysis, setWindowsAnalysis] = useState<WindowsProjectAnalysis | null>(null)
  const [windowsLoading, setWindowsLoading] = useState(false)
  const [windowsError, setWindowsError] = useState('')
  const [localAi, setLocalAi] = useState<LocalAIStatus | null>(null)
  const [localAiLoading, setLocalAiLoading] = useState(false)
  const [localAiError, setLocalAiError] = useState('')
  const [localAiAction, setLocalAiAction] = useState('')
  const [pullModelName, setPullModelName] = useState('')
  const [pullProgress, setPullProgress] = useState<LocalPullProgress | null>(null)
  const [voice, setVoice] = useState<VoiceStatus | null>(null)
  const [userMemory, setUserMemory] = useState<UserMemory | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryError, setMemoryError] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('Hazır')
  const [draft, setDraft] = useState('')
  const [rightTab, setRightTab] = useState<SideTab>('changes')
  const [rightOpen, setRightOpen] = useState(true)
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    try { return window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY) === '1' } catch { return false }
  })
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalCommand, setTerminalCommand] = useState('')
  const [terminalContent, setTerminalContent] = useState('')
  const [runningCommandId, setRunningCommandId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [fileView, setFileView] = useState<{ path: string; content: string } | null>(null)
  const [toast, setToast] = useState('')
  const [desktopPaused, setDesktopPaused] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearchTerm = useDeferredValue(searchTerm)
  const [settings, setSettings] = useState<SettingsForm>({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b', profileName: '', profileInstructions: '', autoLearn: false, apiKey: '', apiKeyConfigured: false, clearApiKey: false })
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadWorkspace = useCallback(async () => {
    setWorkspaceReady(false)
    try {
      const saved = await window.kodAtolyesi.getWorkspace()
      setWorkspace(saved)
      setMessages(saved.messages.map((message) => ({ ...message, id: crypto.randomUUID() })))
      setTaskHistory(await window.kodAtolyesi.getTasks())
      setActivityLog(await window.kodAtolyesi.getAudit())
    } catch (error) { setToast((error as Error).message) }
    finally { setWorkspaceReady(true) }
  }, [])

  const refreshProject = useCallback(async (current = project) => {
    if (!current) { setTree([]); return }
    try { setTree(await window.kodAtolyesi.getTree()) } catch (error) { setToast((error as Error).message) }
  }, [project])

  const refreshStatus = useCallback(async () => {
    try { setStatus(await window.kodAtolyesi.getStatus()) } catch { setStatus(null) }
  }, [])

  const refreshAndroid = useCallback(async (includeProject = Boolean(project)) => {
    setAndroidLoading(true); setAndroidError('')
    const [environmentResult, devicesResult, projectResult] = await Promise.allSettled([
      window.kodAtolyesi.getAndroidEnvironment(), window.kodAtolyesi.getAndroidDevices(),
      includeProject ? window.kodAtolyesi.analyzeAndroidProject() : Promise.resolve(null),
    ])
    const errors: string[] = []
    if (environmentResult.status === 'fulfilled') setAndroidEnvironment(environmentResult.value)
    else errors.push((environmentResult.reason as Error).message)
    if (devicesResult.status === 'fulfilled') setAndroidDevices(devicesResult.value)
    else { setAndroidDevices([]); errors.push((devicesResult.reason as Error).message) }
    if (projectResult.status === 'fulfilled') setAndroidProject(projectResult.value)
    else { setAndroidProject(null); errors.push((projectResult.reason as Error).message) }
    setAndroidError(errors.join(' · ')); setAndroidLoading(false)
  }, [project])

  const refreshWeb = useCallback(async () => {
    if (!project) { setWebAnalysis(null); return }
    setWebLoading(true); setWebError('')
    try { setWebAnalysis(await window.kodAtolyesi.analyzeWebProject()) }
    catch (error) { setWebAnalysis(null); setWebError((error as Error).message) }
    finally { setWebLoading(false) }
  }, [project])

  const refreshWindows = useCallback(async (includeProject = Boolean(project)) => {
    setWindowsLoading(true); setWindowsError('')
    const [environmentResult, analysisResult] = await Promise.allSettled([
      window.kodAtolyesi.getWindowsEnvironment(),
      includeProject ? window.kodAtolyesi.analyzeWindowsProject() : Promise.resolve(null),
    ])
    const errors: string[] = []
    if (environmentResult.status === 'fulfilled') setWindowsEnvironment(environmentResult.value)
    else errors.push((environmentResult.reason as Error).message)
    if (analysisResult.status === 'fulfilled') setWindowsAnalysis(analysisResult.value?.analysis ?? null)
    else { setWindowsAnalysis(null); errors.push((analysisResult.reason as Error).message) }
    setWindowsError(errors.join(' · ')); setWindowsLoading(false)
  }, [])

  const refreshLocalAI = useCallback(async () => {
    setLocalAiLoading(true); setLocalAiError('')
    try { setLocalAi(await window.kodAtolyesi.getLocalAIStatus()) }
    catch (error) { setLocalAiError((error as Error).message) }
    finally { setLocalAiLoading(false) }
  }, [])

  const refreshMemory = useCallback(async () => {
    setMemoryLoading(true); setMemoryError('')
    try { setUserMemory(await window.kodAtolyesi.getUserMemory()) }
    catch (error) { setMemoryError((error as Error).message) }
    finally { setMemoryLoading(false) }
  }, [])

  async function runLocalAiAction(label: string, task: () => Promise<unknown>) {
    setLocalAiAction(label); setLocalAiError('')
    try { await task() }
    catch (error) { setLocalAiError((error as Error).message) }
    finally { setLocalAiAction('') }
  }

  useEffect(() => {
    void window.kodAtolyesi.getProject().then((value) => { setProject(value); if (value) void refreshProject(value); void loadWorkspace(); void refreshAndroid(Boolean(value)); void refreshWindows(Boolean(value)); void refreshLocalAI() })
    void refreshStatus()
    void refreshMemory()
    void window.kodAtolyesi.getVoiceStatus().then(setVoice).catch(() => undefined)
    void window.kodAtolyesi.getSettings().then((value) => setSettings((current) => ({ ...current, provider: value.provider, baseUrl: value.baseUrl, model: value.model, profileName: value.profile.name, profileInstructions: value.profile.instructions, autoLearn: value.profile.autoLearn, apiKey: '', apiKeyConfigured: value.apiKeyConfigured, clearApiKey: false })))
    const unlisten = window.kodAtolyesi.onEvent((event: AppEvent) => {
      if (event.type === 'status') setPhase(event.text)
      if (event.type === 'delta') setMessages((current) => {
        if (!current.length || current[current.length - 1].role !== 'assistant') return [...current, { id: crypto.randomUUID(), role: 'assistant', content: event.text }]
        const updated = [...current]
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + event.text }
        return updated
      })
      if (event.type === 'activity') setActivityLog((items) => [event.item, ...items].slice(0, 100))
      if (event.type === 'proposal') { setProposals((items) => [event.proposal, ...items.filter((item) => item.id !== event.proposal.id)]); setRightTab('changes') }
      if (event.type === 'approval') { setApprovals((items) => [...items.filter((item) => item.requestId !== event.request.requestId), event.request]); setRightTab('activity'); setRightOpen(true); setRightCollapsed(false); setTerminalOpen(true); setTerminalContent((content) => `${content}\r\nOnay bekleniyor: ${event.request.command}\r\n`.slice(-60_000)) }
      if (event.type === 'approval-resolved') {
        setApprovals((items) => items.filter((item) => item.requestId !== event.requestId))
        setApprovalScopes((scopes) => { const next = { ...scopes }; delete next[event.requestId]; return next })
      }
      if (event.type === 'command-output') { setTerminalOpen(true); setTerminalContent((content) => `${content}${event.text}`.slice(-60_000)) }
      if (event.type === 'command-status') setRunningCommandId((current) => event.status === 'running' ? event.requestId : current === event.requestId ? null : current)
      if (event.type === 'task-history') setTaskHistory(event.tasks)
      if (event.type === 'workspace') setWorkspace(event.workspace)
      if (event.type === 'task') setWorkspace((current) => current ? { ...current, task: event.task } : current)
      if (event.type === 'memory') setWorkspace((current) => current ? { ...current, memory: event.memory } : current)
      if (event.type === 'user-memory') setUserMemory(event.memory)
      if (event.type === 'build-result') setWorkspace((current) => current ? { ...current, lastBuild: event.result } : current)
      if (event.type === 'files-changed') void window.kodAtolyesi.getTree().then(setTree)
      if (event.type === 'localai-pull') setPullProgress(event.progress)
      if (event.type === 'localai-status') setLocalAi(event.status)
      if (event.type === 'done') { setPhase(({ completed: 'Tamamlandı', needs_review: 'Kısmen tamamlandı · doğrulama bekliyor', failed: 'Başarısız', cancelled: 'İptal edildi', paused: 'Duraklatıldı', blocked: 'Engellendi' })[event.status]); if (!event.message) return; setMessages((current) => {
        if (current.length && current[current.length - 1].role === 'assistant' && !current[current.length - 1].content.trim()) { const updated = [...current]; updated[updated.length - 1] = { ...updated[updated.length - 1], content: event.message }; return updated }
        if (!current.length || current[current.length - 1].role === 'user') return [...current, { id: crypto.randomUUID(), role: 'assistant', content: event.message }]
        return current
      }) }
      if (event.type === 'error') { setPhase('Hata'); setToast(event.message) }
    })
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'o') { event.preventDefault(); void openProject() }
      if (key === 'j') { event.preventDefault(); setTerminalOpen((isOpen) => !isOpen) }
      if (key === 'p') { event.preventDefault(); document.querySelector<HTMLInputElement>('.tree-search input')?.focus() }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => { unlisten(); window.removeEventListener('keydown', handleShortcut) }
  }, [])

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages, busy])
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(timer) } }, [toast])
  // Yan panelin daraltılmış/geniş durumu yeniden açılışta korunur.
  useEffect(() => {
    try { window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, rightCollapsed ? '1' : '0') } catch { /* depolama kapalıysa yalnız bu oturum geçerli */ }
  }, [rightCollapsed])
  useEffect(() => {
    if (!project || !workspaceReady) return
    const timer = window.setTimeout(() => { void window.kodAtolyesi.saveWorkspace({ messages: messages.map(({ role, content }) => ({ role, content })) }).catch((error) => setToast((error as Error).message)) }, 450)
    return () => window.clearTimeout(timer)
  }, [messages, project, workspaceReady])

  const visibleTree = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase()
    if (!query) return tree
    const filter = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((node) => {
      if (node.kind === 'directory') { const children = filter(node.children ?? []); return node.name.toLowerCase().includes(query) || children.length ? [{ ...node, children }] : [] }
      return node.name.toLowerCase().includes(query) ? [node] : []
    })
    return filter(tree)
  }, [tree, deferredSearchTerm])

  async function openProject() {
    try {
      const next = await window.kodAtolyesi.openProject()
      if (!next) return null
      setProject(next); setMessages([]); setProposals([]); setActivityLog([]); setTerminalContent(''); setWebAnalysis(null); setWebError(''); setWindowsAnalysis(null); setWindowsError('')
      await refreshProject(next)
      await loadWorkspace()
      void refreshAndroid(true)
      void refreshWindows(true)
      setToast(`Açıldı: ${next.name}`)
      return next
    } catch (error) { setToast((error as Error).message); return null }
  }

  async function openFile(relativePath: string) {
    try { setFileView({ path: relativePath, content: await window.kodAtolyesi.readFile(relativePath) }) }
    catch (error) { setToast((error as Error).message) }
  }

  async function submit(textOverride?: string) {
    const text = (textOverride ?? draft).trim()
    if (!text || busy) return
    const newApplication = /(?:yeni|sıfırdan(?:\s+bir)?|bir)\s+(?:yapay\s+zek[âa]\s+)?(?:asistan\p{L}*\s+)?(?:uygulama|application|app)(?:sı)?\s*(?:istiyorum|oluştur\w*|yap\w*|geliştir\w*|başlat\w*)|(?:yapay\s+zek[âa]\s+)?asistan\p{L}*\s+(?:uygulaması\s+)?(?:istiyorum|oluştur\w*|yap\w*|geliştir\w*)/iu.test(text)
    if (!project && newApplication) {
      const selected = await openProject()
      if (!selected) { setToast('Yeni uygulamanın yazılacağı çalışma klasörünü seçmeden devam edemem.'); return }
    }
    setDraft('')
    const nextMessages: Message[] = [...messages, { id: crypto.randomUUID(), role: 'user', content: text }, { id: crypto.randomUUID(), role: 'assistant', content: '' }]
    setMessages(nextMessages); setBusy(true); setPhase('İstek gönderiliyor…')
    try { await window.kodAtolyesi.sendMessage(nextMessages.slice(0, -1).map(({ role, content }) => ({ role, content }))) }
    catch (error) {
      setMessages((current) => { const updated = [...current]; const last = updated[updated.length - 1]; if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: `**Bağlantı hatası**\n\n${(error as Error).message}` }; return updated })
      setPhase('Bağlantı hatası')
    } finally { setBusy(false) }
  }

  async function resumeTask(task: TaskRecord) {
    if (busy || !project) return
    const text = `Önceki görevi sürdür: ${task.request}\n\nÖnce mevcut proje dosyalarını, görevdeki son işlemleri ve güncel izin kapsamlarını yeniden kontrol et. Önceki işlem onaylarını yeni veya kapsamı değişen işlemlere taşıma. Bekleyen adımları tamamla ve ilgili doğrulamaları çalıştır.`
    const nextMessages: Message[] = [...messages, { id: crypto.randomUUID(), role: 'user', content: text }, { id: crypto.randomUUID(), role: 'assistant', content: '' }]
    setMessages(nextMessages); setBusy(true); setPhase('Görev yeniden doğrulanıyor…')
    try { await window.kodAtolyesi.resumeTask(task.id, nextMessages.slice(0, -1).map(({ role, content }) => ({ role, content }))) }
    catch (error) {
      setMessages((current) => { const updated = [...current]; const last = updated[updated.length - 1]; if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: `**Görev sürdürülemedi**\n\n${(error as Error).message}` }; return updated })
      setPhase('Görev sürdürülemedi')
    } finally { setBusy(false) }
  }

  async function controlAgent(action: 'pause' | 'cancel') {
    try {
      const result = action === 'pause' ? await window.kodAtolyesi.pauseAgent() : await window.kodAtolyesi.cancelAgent()
      setToast(result.message)
      if (result.ok) setApprovals((items) => items.filter((item) => item.taskId !== workspace?.task?.id))
      if (action === 'cancel') setDesktopPaused(true)
    } catch (error) { setToast((error as Error).message) }
  }

  // Masaüstü otomasyonu kullanıcı tarafından durdurulabilir/devam ettirilebilir.
  async function toggleDesktopPaused() {
    try {
      const next = !(await window.kodAtolyesi.getDesktopPaused())
      setDesktopPaused(await window.kodAtolyesi.setDesktopPaused(next))
      setToast(next ? 'Masaüstü otomasyonu durduruldu.' : 'Masaüstü otomasyonu devam ediyor.')
    } catch (error) { setToast((error as Error).message) }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit() }
  }

  async function applyChange(id: string) {
    try {
      const result = await window.kodAtolyesi.applyProposal(id)
      if (result.ok) { setProposals((items) => items.filter((item) => item.id !== id)); await refreshProject(); setToast(result.message) }
      else setToast(result.message)
    } catch (error) { setToast((error as Error).message) }
  }

  async function rejectChange(id: string) {
    try { await window.kodAtolyesi.discardProposal(id); setProposals((items) => items.filter((item) => item.id !== id)) }
    catch (error) { setToast((error as Error).message) }
  }

  async function undoChange() {
    try {
      const result = await window.kodAtolyesi.undoLast()
      if (result.ok) await refreshProject()
      setToast(result.message)
    } catch (error) { setToast((error as Error).message) }
  }

  async function commandApproval(requestId: string, decision: ApprovalDecision) {
    setApprovals((items) => items.filter((item) => item.requestId !== requestId))
    setApprovalScopes((scopes) => { const next = { ...scopes }; delete next[requestId]; return next })
    try {
      await window.kodAtolyesi.resolveApproval(requestId, decision)
      if (!decision.approved) setTerminalContent((content) => `${content}\r\nKomut çalıştırılmadı.\r\n`)
    } catch (error) { setToast((error as Error).message) }
  }

  async function cancelApproval(requestId: string) {
    setApprovals((items) => items.filter((item) => item.requestId !== requestId))
    setApprovalScopes((scopes) => { const next = { ...scopes }; delete next[requestId]; return next })
    try { const result = await window.kodAtolyesi.cancelCommand(requestId); setToast(result.message) }
    catch (error) { setToast((error as Error).message) }
  }

  async function submitCommand(event: FormEvent) {
    event.preventDefault()
    if (!terminalCommand.trim()) return
    try { await window.kodAtolyesi.runCommand(terminalCommand); setTerminalCommand('') }
    catch (error) { setTerminalContent((content) => `${content}\r\n${(error as Error).message}\r\n`) }
  }

  async function startNewTask() {
    if (busy) { setToast('Çalışan görevi durdurduktan veya duraklattıktan sonra yeni görev açabilirsiniz.'); return }
    try {
      if (project) {
        // Yeni görev: görev planı ve görünen/persist edilen sohbet geçmişi birlikte sıfırlanır.
        const updated = await window.kodAtolyesi.saveWorkspace({ task: null, messages: [] })
        setWorkspace(updated)
      } else {
        // Proje yokken sohbet geçmişi kullanıcı veri klasöründe tutulur; "Yeni görev" onu temizler.
        const updated = await window.kodAtolyesi.clearChatHistory()
        setWorkspace(updated)
      }
      setMessages([]); setPhase('Hazır')
    } catch (error) { setToast((error as Error).message) }
  }

  // Yan panel sekmesi seçimi: hem geniş sekme çubuğu hem de daraltılmış şerit aynı yolu kullanır.
  const selectSideTab = (id: SideTab) => {
    setRightTab(id)
    if (id === 'localai') void refreshLocalAI()
    if (id === 'memory') void refreshMemory()
  }
  const sideTabBadge = (id: SideTab): number | string | null => {
    if (id === 'changes') return proposals.length || null
    if (id === 'localai') return localAiAction ? '…' : null
    if (id === 'memory') return userMemory?.entries.length || null
    return null
  }

  const noProjectContent: ReactNode = <div className="welcome-wrap"><div className="welcome-mark"><Code2 size={26} /></div><div className="welcome-eyebrow"><Sparkles size={13} /> {settings.profileName.trim() ? `${settings.profileName.trim()}, kodlama asistanın hazır` : 'Kodlama asistanın hazır'}</div>
    {project ? <h1>Bugün ne<br /><span>geliştirelim?</span></h1> : <h1>Birlikte bir şeyler<br /><span>inşa edelim.</span></h1>}
    <p className="welcome-copy">{project ? `${project.name} projesini açtım. Kodlarını inceleyip gerçek değişiklikler önerebilirim; her öneri önce diff olarak gösterilir.` : 'Proje kodlarını inceleyip gerçek değişiklikler önerebilirim. Başlamak için bir proje klasörü aç.'}</p>
    <button className="open-project-large" onClick={() => void openProject()}><FolderOpen size={17} /> {project ? 'Başka proje aç' : 'Proje klasörü aç'} <span>Ctrl + O</span></button>
    <div className="starter-grid"><button onClick={() => project ? (() => { setDraft('Sıfırdan yeni bir uygulama geliştir: önce gereksinimleri ve uygun teknoloji yığınını belirle, seçili çalışma alanında çakışmayan yeni bir klasör oluştur, çalışan temel uygulamayı gerçek dosyalarla yaz, testlerini çalıştır ve sonucu doğrula. Uygulama türü ve özellikleri: '); window.setTimeout(() => textareaRef.current?.focus(), 0) })() : void openProject()}><Plus size={16} /><strong>Yeni uygulama başlat</strong><span>Sıfırdan kod yaz ve çalıştır</span></button><button onClick={() => project ? void submit('Projeyi analiz et. Dosya yapısını ve kullanılan teknolojileri incele; önemli başlangıç dosyalarını oku ve kısa bir genel bakış ver.') : void openProject()}><ListTree size={16} /><strong>Projeyi analiz et</strong><span>Yapıyı ve teknolojileri anla</span></button><button onClick={() => project ? void submit('Projeyi incele, belirgin bir hata veya sorun bulursan ilgili mevcut dosyayı oku ve düzeltme taslağını hazırla. Terminal komutlarını çalıştırmadan önce onayımı iste.') : void openProject()}><AlertCircle size={16} /><strong>Bir hatayı düzelt</strong><span>Kodu incele ve çözüm öner</span></button><button onClick={() => project ? void submit('Android geliştirme ortamını denetle, seçili klasördeki Android projesini analiz et ve debug APK üret. Android projesi alt klasördeyse build_android için doğru project_path ver. Önce Android birim testlerini çalıştır, sonra APK/AAB yapısını doğrula. Cihaz bağlı değilse gerçek cihaz doğrulaması yapılmadığını ayrıca belirt.') : void openProject()}><Hammer size={16} /><strong>Android APK oluştur</strong><span>Derle, test et ve çıktıyı doğrula</span></button></div>
    <div className="welcome-trust"><ShieldCheck size={14} /> Dosyalar seçtiğin proje klasöründe kalır <i /> Değişiklikler onayından sonra uygulanır</div>
  </div>

  return <div className={rightCollapsed ? 'app-shell right-panel-collapsed' : 'app-shell'}>
    <div className="workspace">
      <aside className="left-sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><Code2 size={15} /></div>
          <span className="brand-name">Ultron</span>
          <button className="icon-button tiny" title="Proje klasörünü değiştir" onClick={() => void openProject()}><MoreHorizontal size={15} /></button>
        </div>
        <button className="new-task-button" onClick={() => void startNewTask()} disabled={busy} title="Yeni görev"><Pencil size={14} /><span>Yeni görev</span></button>
        <nav className="sidebar-nav">
          <button className="sidebar-tool" onClick={() => { setRightTab('changes'); setRightOpen(true); setRightCollapsed(false) }}><GitCompareArrows size={15} /><span>Değişiklikler</span><span className="tool-count">{proposals.length || ''}</span></button>
          <button className="sidebar-tool" onClick={() => { setRightTab('activity'); setRightOpen(true); setRightCollapsed(false) }}><Activity size={15} /><span>İşlem geçmişi</span><span className="tool-count">{activityLog.length || ''}</span></button>
          <button className="sidebar-tool" onClick={() => setWorkspaceOpen(true)}><Brain size={15} /><span>Hafıza ve yetkiler</span><span className="tool-count">{workspace?.memory.updatedAt ? '●' : ''}</span></button>
          <button className="sidebar-tool" onClick={() => { setRightTab('localai'); setRightOpen(true); setRightCollapsed(false); void refreshLocalAI() }}><Cpu size={15} /><span>Yerel AI</span><span className="tool-count">{localAi?.models.length ? localAi.models.length : localAi?.connected ? '●' : ''}</span></button>
          <button className="sidebar-tool" onClick={() => { setRightTab('memory'); setRightOpen(true); setRightCollapsed(false); void refreshMemory() }}><Database size={15} /><span>Kişisel hafıza</span><span className="tool-count">{userMemory?.entries.length || ''}</span></button>
          <button className="sidebar-tool" onClick={() => setTerminalOpen(!terminalOpen)}><SquareTerminal size={15} /><span>Terminal</span><kbd>Ctrl J</kbd></button>
        </nav>
        {project ? <>
          <div className="threads-section">
            <div className="threads-heading"><span>Görevler</span><span className="tool-count">{taskHistory.length || ''}</span></div>
            <button className="thread-project" onClick={() => void openProject()} title={project.path}><Folder size={13} /><span>{project.name}</span><ChevronDown size={12} /></button>
            <div className="thread-list">
              {taskHistory.slice(0, 6).map((task) => {
                const resumable = ['interrupted', 'paused', 'blocked', 'needs_review', 'failed', 'cancelled'].includes(task.status) || (task.status === 'completed' && task.pendingSteps.length > 0)
                return <button key={task.id} className={`thread-row ${workspace?.task?.id === task.id ? 'active' : ''}`} title={`${task.title} · ${task.status}`} onClick={() => { if (resumable && !busy) void resumeTask(task); else setToast(resumable ? 'Çalışan görevi bitirmeden veya duraklatmadan yeni görev açılamaz.' : 'Bu görevde sürdürülecek adım yok.') }}>
                  <span className="thread-title">{task.title}</span>
                  <span className="thread-time">{relativeTime(task.updatedAt)}</span>
                </button>
              })}
              {!taskHistory.length && <div className="thread-empty">Henüz görev yok</div>}
            </div>
          </div>
          <div className="sidebar-section-title"><span>DOSYALAR</span><span>{tree.reduce((n, item) => n + (item.kind === 'file' ? 1 : (item.children?.length ?? 0)), 0)}</span></div>
          <div className="tree-search"><Search size={13} /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Dosyalarda ara" /><kbd>Ctrl P</kbd></div>
          <div className="file-tree">{visibleTree.length ? visibleTree.map((node) => <TreeItem key={node.path} node={node} depth={0} onOpen={(path) => void openFile(path)} />) : <div className="tree-empty">{searchTerm ? 'Eşleşme bulunamadı' : 'Gösterilecek dosya yok'}</div>}</div>
          <div className="sidebar-spacer" />
        </> : <div className="sidebar-empty"><FolderOpen size={22} /><p>Bir proje açınca görevler ve dosyalar burada görünür.</p><button onClick={() => void openProject()}>Klasör seç</button></div>}
        <div className="profile-area">
          {profileOpen && <>
            <div className="profile-menu-backdrop" onClick={() => setProfileOpen(false)} />
            <div className="profile-menu" role="menu">
              <div className="profile-menu-head">
                <span className="profile-avatar">{settings.profileName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'U'}</span>
                <span className="profile-meta"><strong>{settings.profileName.trim() || 'Kişisel'}</strong><small>{status?.selectedModel || 'Yerel model'}</small></span>
              </div>
              <button className="profile-menu-item" role="menuitem" onClick={() => { setProfileOpen(false); setSettingsOpen(true) }}><Settings2 size={14} />Ayarlar</button>
              <button className="profile-menu-item" role="menuitem" onClick={() => { setProfileOpen(false); setWorkspaceOpen(true) }}><ShieldCheck size={14} />Hafıza ve yetkiler</button>
              <button className="profile-menu-item" role="menuitem" onClick={() => { setProfileOpen(false); void openProject() }}><FolderOpen size={14} />Proje klasörünü değiştir</button>
              <div className="profile-menu-sep" />
              <button className="profile-menu-item" role="menuitem" disabled={busy} onClick={() => { setProfileOpen(false); void startNewTask() }}><Pencil size={14} />Yeni görev</button>
            </div>
          </>}
          <button className="profile-chip" onClick={() => setProfileOpen(!profileOpen)} title="Profil ve ayarlar">
            <span className="profile-avatar">{settings.profileName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'U'}</span>
            <span className="profile-meta"><strong>{settings.profileName.trim() || 'Kişisel'}</strong><small>{status?.selectedModel || 'Yerel model'}</small></span>
            <ChevronDown size={13} className={profileOpen ? 'rotated' : ''} />
          </button>
        </div>
      </aside>

      <main className="main-column">
        <div className="main-toolbar">
          <div className="breadcrumbs">
            <span className="thread-title-main">{workspace?.task?.title ?? (project ? 'Yeni görev' : 'Çalışma alanı')}</span>
            {project && <span className="thread-project-name">{project.name}</span>}
            {busy && <><span className="crumb-separator">/</span><span className="phase-text"><LoaderCircle size={12} className="spin" />{phase}</span></>}
          </div>
          <div className="toolbar-actions">
            {busy && <><button className="toolbar-button" onClick={() => void controlAgent('pause')}><Pause size={13} /><span>Duraklat</span></button><button className="toolbar-button stop-task" onClick={() => void controlAgent('cancel')}><X size={13} /><span>Görevi durdur</span></button></>}
            <button className="icon-button top-icon" title="Terminal" onClick={() => setTerminalOpen(!terminalOpen)}><SquareTerminal size={16} /></button>
            <button className={`icon-button top-icon${desktopPaused ? ' desktop-paused' : ''}`} title={desktopPaused ? 'Masaüstü otomasyonu durduruldu — devam ettir' : 'Masaüstü otomasyonunu durdur'} onClick={() => void toggleDesktopPaused()}>{desktopPaused ? <ShieldCheck size={16} /> : <Monitor size={16} />}</button>
            <button className="icon-button top-icon" title="Ayarlar" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /></button>
            <button className="icon-button tiny" title={rightOpen ? (rightCollapsed ? 'Yan paneli genişlet' : 'Yan paneli kapat') : 'Yan paneli aç'} onClick={() => { if (!rightOpen) { setRightOpen(true); return } if (rightCollapsed) { setRightCollapsed(false); return } setRightOpen(false) }}>{rightOpen && !rightCollapsed ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button>
          </div>
        </div>
        <div className="conversation-scroll" ref={scrollRef}>
          {!messages.length ? noProjectContent : <div className="conversation">
            {messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === 'assistant' ? <div className="assistant-mark"><Sparkles size={14} /></div> : <div className="user-avatar">{settings.profileName.trim().charAt(0).toLocaleUpperCase('tr-TR') || 'S'}</div>}</div><div className="message-body"><div className="message-topline"><strong>{message.role === 'assistant' ? 'Ultron' : 'Sen'}</strong>{message.role === 'assistant' && <span className="message-model"><Bot size={11} /> {status?.selectedModel ?? 'Yerel model'}</span>}{message.role === 'assistant' && message.content && <span className="message-time">{timeNow()}</span>}</div>{message.content ? <div className="markdown-body"><Markdown onOpenUrlError={() => setToast('Bağlantı varsayılan tarayıcıda açılamadı.')}>{message.content}</Markdown></div> : busy && message.role === 'assistant' ? <div className="thinking"><span /><span /><span /><em>{phase}</em></div> : null}</div></article>)}
            {busy && <div className="agent-progress"><LoaderCircle size={13} className="spin" /><span>{phase}</span><div className="progress-track"><i /></div></div>}
          </div>}
        </div>
        <div className="composer-area"><div className="composer" data-disabled={busy}>
          <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onInputKeyDown} disabled={busy} placeholder={project ? 'Takip değişikliği isteyin…' : 'Merhaba de ya da sohbet et; görev için önce proje aç'} rows={2} />
          <div className="composer-bottom"><div className="composer-tools"><button className="model-pill" onClick={() => setSettingsOpen(true)} title="Model ve sağlayıcı ayarları"><span className={`connection-dot ${status?.connected ? 'online' : ''}`} />{status?.selectedModel || 'Model seç'}<ChevronDown size={12} /></button><span className="context-pill"><Folder size={12} />{project?.name ?? 'Proje seçilmedi'}</span><span className="scope-note"><ShieldCheck size={12} /> Klasörle sınırlı</span></div><div className="composer-send"><span className="enter-hint">↵ gönder</span><button className="send-button" onClick={() => void submit()} disabled={busy || !draft.trim()} title="Gönder"><ArrowUp size={16} /></button></div></div>
        </div><div className="composer-footnote"><span className="local-indicator"><Circle size={6} fill="currentColor" /> Yerel · {project?.name ?? 'Proje seçilmedi'}</span><span>Yapay zekâ hatalı kod üretebilir · değişiklikleri uygulamadan önce incele</span></div></div>
      </main>

      {rightOpen && <aside className={rightCollapsed ? 'right-sidebar collapsed' : 'right-sidebar'}>{rightCollapsed
        ? <div className="right-rail">
          <button className="icon-button tiny rail-expand" title="Yan paneli genişlet" onClick={() => setRightCollapsed(false)}><PanelRightOpen size={15} /></button>
          {SIDE_TABS.map((tab) => { const Icon = tab.icon; const badge = sideTabBadge(tab.id); return <button key={tab.id} className={`rail-tab${rightTab === tab.id ? ' active' : ''}`} title={tab.label} aria-label={tab.label} onClick={() => { selectSideTab(tab.id); setRightCollapsed(false) }}><Icon size={15} />{badge !== null && <span className="rail-badge">{badge}</span>}</button> })}
        </div>
        : <>
        <div className="right-tabs"><div className="right-tabs-scroll">{SIDE_TABS.map((tab) => { const Icon = tab.icon; const badge = sideTabBadge(tab.id); return <button key={tab.id} className={rightTab === tab.id ? 'active' : ''} onClick={() => selectSideTab(tab.id)}><Icon size={14} />{tab.label}{badge !== null && <span className="tab-count">{badge}</span>}</button> })}</div>
          <button className="icon-button tiny right-collapse" title="Yan paneli daralt" aria-label="Yan paneli daralt" onClick={() => setRightCollapsed(true)}><ChevronsRight size={14} /></button>
        </div>
        {rightTab === 'changes' ? <div className="right-panel-content"><div className="panel-intro"><div><strong>İnceleme alanı</strong><span>Dosyalarda uygulanmayı bekleyen öneriler</span></div><button className="icon-button tiny" title="Son değişikliği geri al" onClick={() => void undoChange()}><Undo2 size={15} /></button></div>
          {proposals.length ? <div className="proposal-list">{proposals.map((proposal) => <div className="proposal-card" key={proposal.id}><div className="proposal-heading"><div className="proposal-title"><span className={`proposal-dot ${proposal.applied ? 'applied' : ''}`} /><strong>{proposal.path}</strong></div><span className="proposal-size">{formatBytes(proposal.newContent)}</span></div><p>{proposal.description}</p><DiffPreview proposal={proposal} /><div className="proposal-actions">{proposal.applied ? <span className="applied-label"><Check size={13} /> Otomatik uygulandı · geri alınabilir</span> : <><button className="reject-button" onClick={() => void rejectChange(proposal.id)}><X size={13} /> Reddet</button><button className="apply-button" onClick={() => void applyChange(proposal.id)}><Check size={13} /> Uygula</button></>}</div></div>)}</div> : <div className="panel-blank"><div className="blank-icon"><GitCompareArrows size={18} /></div><strong>Henüz değişiklik yok</strong><p>Asistandan kod yazmasını istediğinde önerileri burada inceleyebilirsin.</p><div className="panel-hint"><span className="hint-mark add">+</span><span>Yeni satır</span><span className="hint-mark remove">−</span><span>Silinen satır</span></div></div>}
          <div className="safety-note"><ShieldCheck size={14} /><span><b>Kontrol sende</b> Her değişiklik önizlenir ve uygulamadan önce yedeklenir.</span></div>
        </div> : rightTab === 'activity' ? <div className="activity-panel"><div className="panel-intro activity-intro"><div><strong>Görev durumu</strong><span>{busy ? phase : activityLog.length ? 'Son işlemler' : 'Henüz bir işlem yok'}</span></div>{busy ? <LoaderCircle size={15} className="spin accent" /> : <span className="ready-chip"><Circle size={7} fill="currentColor" /> {phase}</span>}</div>
          <TaskStatusPanel task={workspace?.task ?? null} build={workspace?.lastBuild ?? null} executionTask={taskHistory.find((item) => item.id === workspace?.task?.id)} />
          {taskHistory.length > 0 && <TaskHistoryPanel tasks={taskHistory} currentTaskId={workspace?.task?.id} busy={busy} onResume={(task) => void resumeTask(task)} />}
          {approvals.map((request) => <ApprovalCard key={request.requestId} request={request} taskTitle={workspace?.task?.title} selectedScope={approvalScopes[request.requestId] ?? 'operation'} onScopeChange={(scope) => setApprovalScopes((items) => ({ ...items, [request.requestId]: scope }))} onApprove={(scope) => void commandApproval(request.requestId, { approved: true, scope, remember: scope !== 'operation' })} onReject={() => void commandApproval(request.requestId, { approved: false, scope: 'operation', remember: false })} onCancel={() => void cancelApproval(request.requestId)} />)}
          <div className="audit-toolbar"><span>Bu projede saklanan son {activityLog.length} işlem</span><button onClick={() => void window.kodAtolyesi.exportAudit().then((file) => file && setToast(`Kayıt dışa aktarıldı: ${file}`)).catch((error) => setToast((error as Error).message))}><FileText size={12} /> Dışa aktar</button></div>
          {activityLog.length ? <div className="activity-list">{activityLog.map((item) => <div className="activity-row" key={item.id}><div className={`activity-icon ${item.kind}`}>{item.kind === 'success' ? <Check size={12} /> : item.kind === 'error' ? <AlertCircle size={12} /> : item.kind === 'command' ? <SquareTerminal size={12} /> : item.kind === 'tool' ? <Zap size={12} /> : <Clock3 size={12} />}</div><div className="activity-copy"><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}{(item.tool || item.operation || item.approvalOutcome || item.result || item.target || item.exitCode !== undefined) && <div className="activity-meta">{item.tool && <span>{item.tool}</span>}{item.operation && <span>{item.operation}</span>}{item.approvalOutcome && <span>Onay: {({ pending: 'bekliyor', approved: 'verildi', rejected: 'reddedildi', cancelled: 'iptal', automatic: 'otomatik', not_required: 'gerekmiyor' })[item.approvalOutcome]}</span>}{item.result && <span>Sonuç: {({ success: 'başarılı', failed: 'başarısız', cancelled: 'iptal', denied: 'reddedildi' })[item.result]}</span>}{item.exitCode !== undefined && <span>Çıkış: {item.exitCode}</span>}{item.target && <code>{item.target}</code>}{item.error && <code className="activity-error">{item.error}</code>}{item.changedPaths?.length ? <code>Dosyalar: {item.changedPaths.join(', ')}</code> : null}</div>}</div><time>{item.time}</time></div>)}</div> : <div className="panel-blank small"><div className="blank-icon"><Activity size={17} /></div><strong>İşlem akışı burada görünür</strong><p>Dosya okumaları, araç çağrıları ve test sonuçları görev ilerledikçe listelenir.</p></div>}
        </div> : rightTab === 'android' ? <AndroidWorkspacePanel environment={androidEnvironment} devices={androidDevices} analysis={androidProject} build={workspace?.lastBuild ?? null} projectOpen={Boolean(project)} loading={androidLoading} error={androidError} onRefresh={() => void refreshAndroid(Boolean(project))} onAnalyze={() => void refreshAndroid(true)} /> : rightTab === 'web' ? <WebWorkspacePanel analysis={webAnalysis} projectOpen={Boolean(project)} loading={webLoading} error={webError} onAnalyze={() => void refreshWeb()} /> : rightTab === 'windows' ? <WindowsWorkspacePanel environment={windowsEnvironment} analysis={windowsAnalysis} build={workspace?.lastBuild ?? null} projectOpen={Boolean(project)} loading={windowsLoading} error={windowsError} onRefresh={() => void refreshWindows(Boolean(project))} onAnalyze={() => void refreshWindows(true)} /> : rightTab === 'localai' ? <LocalAIPanel status={localAi} voice={voice} loading={localAiLoading} error={localAiError} action={localAiAction} progress={pullProgress} pullName={pullModelName} onPullName={setPullModelName} onRefresh={() => void refreshLocalAI()} onPull={(model) => void runLocalAiAction('pull', async () => { const result = await window.kodAtolyesi.pullLocalModel(model); setLocalAi(result); setPullProgress(null); setToast(`${model} indirildi.`) })} onDelete={(model) => { if (!window.confirm(`${model} modeli diskten silinsin mi? Bu işlem geri alınamaz.`)) return; void runLocalAiAction('delete', async () => { setLocalAi(await window.kodAtolyesi.deleteLocalModel(model)); setToast(`${model} silindi.`) }) }} onToggleLoad={(model, loaded) => void runLocalAiAction(loaded ? 'load' : 'unload', async () => { const result = loaded ? await window.kodAtolyesi.loadLocalModel(model) : await window.kodAtolyesi.unloadLocalModel(model); setToast(result.message); setLocalAi(await window.kodAtolyesi.getLocalAIStatus()) })} onTest={(model) => void runLocalAiAction('test', async () => { const result = await window.kodAtolyesi.testLocalModel(model); setToast(result.message); setLocalAi(await window.kodAtolyesi.getLocalAIStatus()) })} onSelectModel={(model) => void runLocalAiAction('select', async () => { const localBaseUrl = settings.provider === 'ollama' ? settings.baseUrl : 'http://127.0.0.1:11434/v1'; const result = await window.kodAtolyesi.saveSettings({ provider: 'ollama', baseUrl: localBaseUrl, model, profile: { name: settings.profileName, instructions: settings.profileInstructions, autoLearn: settings.autoLearn } }); setSettings({ ...settings, provider: 'ollama', baseUrl: localBaseUrl, model }); setStatus(result); setToast(`Seçili model: ${model}`); setLocalAi(await window.kodAtolyesi.getLocalAIStatus()) })} /> : <MemoryPanel memory={userMemory} loading={memoryLoading} error={memoryError} projectPath={project?.path ?? null} onRefresh={() => void refreshMemory()} />}
        {rightTab === 'research' ? <ResearchPanel /> : rightTab === 'files' ? <FilesWorkspacePanel setToast={setToast} /> : rightTab === 'software' ? <SoftwarePanel setToast={setToast} /> : rightTab === 'plugins' ? <PluginsPanel setToast={setToast} /> : rightTab === 'desktop' ? <DesktopPanel projectPath={project?.path ?? null} paused={desktopPaused} onTogglePause={() => void toggleDesktopPaused()} setToast={setToast} /> : rightTab === 'tools' ? <DeveloperToolsPanel projectPath={project?.path ?? null} setToast={setToast} /> : null}
        <div className="right-footer"><div className="connection-detail"><span className={`connection-dot ${status?.connected ? 'online' : ''}`} /><span>{status?.connected ? 'Yerel Ollama bağlı' : 'Yerel model çevrimdışı'}</span></div><button onClick={() => void refreshStatus()} title="Bağlantıyı yenile"><RefreshCw size={13} /></button></div>
        </>}
      </aside>}
    </div>

    {terminalOpen && <section className="terminal-drawer"><div className="terminal-header"><div><SquareTerminal size={15} /><strong>Terminal</strong><span className="terminal-root">{project?.path ?? 'Proje seçilmedi'}</span></div><div className="terminal-head-actions">{runningCommandId && <button className="stop-command" onClick={() => void window.kodAtolyesi.cancelCommand(runningCommandId).then((result) => setToast(result.message))}>Çalışanı durdur</button>}<button className="icon-button tiny" title="Çıktıyı temizle" onClick={() => setTerminalContent('')}><Trash2 size={14} /></button><button className="icon-button tiny" title="Terminali kapat" onClick={() => setTerminalOpen(false)}><X size={15} /></button></div></div><div className="terminal-output">{terminalContent || <span className="terminal-muted">Çalıştırılan komutlar ve çıktıları burada görünür. Her komut önce onay ister.</span>}</div><form className="terminal-input" onSubmit={(event) => void submitCommand(event)}><span className="terminal-prompt">›</span><input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} placeholder="Onay için komut yaz…" disabled={!project} /><button disabled={!terminalCommand.trim()} title="Komutu gönder"><ArrowRight size={14} /></button><span className="terminal-approval-label"><ShieldCheck size={12} /> Onay gerekli</span></form></section>}

    {fileView && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setFileView(null) }}><section className="file-modal"><header><div><IconForFile name={fileView.path.split('/').pop() ?? ''} /><strong>{fileView.path}</strong></div><button className="icon-button" onClick={() => setFileView(null)}><X size={17} /></button></header><div className="file-code"><div className="line-numbers">{fileView.content.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div><pre><code>{fileView.content}</code></pre></div><footer><span>{fileView.content.split('\n').length} satır · {formatBytes(fileView.content)}</span><button onClick={() => { void navigator.clipboard.writeText(fileView.content); setToast('Dosya içeriği panoya kopyalandı.') }}><Copy size={13} /> Kopyala</button></footer></section></div>}

    {settingsOpen && <SettingsModal settings={settings} status={status} onClose={() => setSettingsOpen(false)} onSaved={(next, result) => { setSettings({ ...next, apiKey: '', apiKeyConfigured: Boolean(next.apiKey.trim()) || (next.apiKeyConfigured && !next.clearApiKey), clearApiKey: false }); setStatus(result); setSettingsOpen(false); setToast(result.connected ? 'Sağlayıcı ayarları kaydedildi ve bağlantı doğrulandı.' : 'Ayarlar kaydedildi; sağlayıcı bağlantısı doğrulanamadı.') }} />}
    {workspaceOpen && project && workspace && <WorkspaceModal workspace={workspace} projectPath={project.path} onClose={() => setWorkspaceOpen(false)} onSaved={(saved) => { setWorkspace(saved); setWorkspaceOpen(false); setToast('Proje hafızası ve yetkileri kaydedildi.') }} />}
    {toast && <div className="toast"><CheckCheck size={14} />{toast}</div>}
  </div>
}

function TaskStatusPanel({ task, build, executionTask }: { task: TaskPlan | null; build: BuildRecord | null; executionTask?: TaskRecord }) {
  if (!task && !build) return null
  const done = task?.steps.filter((step) => step.status === 'done').length ?? 0
  const verificationIssues = executionTask?.verificationFailures ?? []
  const staleChecks = verificationIssues.filter((issue) => issue.status === 'stale').length
  const failedChecks = verificationIssues.length - staleChecks
  const needsReview = executionTask?.status === 'needs_review' || executionTask?.status === 'completed' && executionTask.pendingSteps.length > 0
  const statusLabel = executionTask?.status === 'failed' ? 'Başarısız · sürdürülebilir'
    : verificationIssues.length ? failedChecks ? 'Başarısız doğrulamalar açık' : 'Kod değişti · yeniden doğrulama gerekiyor'
      : needsReview ? 'Doğrulama bekliyor'
        : task?.status === 'blocked' || executionTask?.status === 'blocked' ? 'Engellendi · görev sürdürülebilir'
          : executionTask?.status === 'waiting_approval' ? 'Kullanıcı onayı bekleniyor'
            : executionTask?.status === 'paused' ? 'Duraklatıldı · devam ettirilebilir'
              : executionTask?.status === 'interrupted' ? 'Yarım kaldı · devam ettirilebilir'
                : executionTask?.status === 'cancelled' ? 'İptal edildi'
                  : executionTask?.status === 'completed' ? 'Görev tamamlandı'
                    : task?.status === 'complete' ? 'Plan adımları tamamlandı olarak işaretlendi' : 'Devam ediyor'
  const hasStatusIssue = verificationIssues.length > 0 || needsReview || executionTask?.status === 'failed' || executionTask?.status === 'blocked' || task?.status === 'blocked'
  const statusBadge = hasStatusIssue ? 'blocked' : executionTask?.status === 'completed' ? 'complete' : 'active'
  const errorLines = build?.output.split(/\r?\n/).filter((line) => /\b(error|exception|failed|failure|BUILD FAILED)\b/i.test(line)).slice(-4) ?? []
  return <div className="task-status-card">
    {task && <><div className="task-status-heading"><div><strong>{task.title}</strong><span>{statusLabel}{task.steps.length ? ` · ${done}/${task.steps.length} adım` : ' · Ayrıntılı plan gerekmiyor'}</span></div><span className={`task-status-badge ${statusBadge}`}>{statusBadge === 'blocked' ? '!' : statusBadge === 'complete' ? '✓' : '●'}</span></div>
      {verificationIssues.length > 0 && <div className="task-verification-issues">{verificationIssues.map((issue) => <div className={`task-verification-issue ${issue.status === 'stale' ? 'stale' : 'failed'}`} key={issue.key}><strong>{issue.status === 'stale' ? 'Yeniden doğrulama gerekli' : 'Doğrulama başarısız'} · {issue.tool}</strong><span>{issue.status === 'stale' ? 'Kod değiştiği için bu kontrol tekrar çalıştırılmalı. ' : ''}{issue.analysis.message}</span></div>)}</div>}
      {executionTask && <div className="task-progress-detail"><span>Aşama: {agentStageLabel(executionTask.stage)}{executionTask.currentTool ? ` · ${executionTask.currentTool}` : ''}</span><span>{executionTask.toolCalls} araç · {executionTask.correctionAttempts} düzeltme{failedChecks > 0 ? ` · ${failedChecks} doğrulama hatası açık` : ''}{staleChecks > 0 ? ` · ${staleChecks} kontrol tekrarlanmalı` : ''}</span></div>}
      {executionTask?.errorAnalysis && <div className="task-history-error">{agentErrorLabel(executionTask.errorAnalysis.category)}: {executionTask.errorAnalysis.message} · {executionTask.errorAnalysis.nextAction}</div>}
      <p className="task-objective">{task.objective}</p><div className="task-steps">{task.steps.map((step, index) => <div className={`task-step ${step.status}`} key={`${index}-${step.title}`}><span>{step.status === 'done' ? '✓' : step.status === 'blocked' ? '!' : index + 1}</span><span>{step.title}</span></div>)}</div>
      {task.tests.length > 0 && <div className="task-tests"><b>Kabul / test komutları</b>{task.tests.map((test, index) => <span key={index}>{test}</span>)}</div>}</>}
    {build && <div className="last-build"><div><strong>{build.exitCode === 0 ? 'Son komut başarılı' : 'Son komut başarısız'}</strong><span>{build.command} · {new Date(build.completedAt).toLocaleString('tr-TR')}</span></div><b className={build.exitCode === 0 ? 'build-ok' : 'build-failed'}>{build.exitCode === 0 ? '0' : build.exitCode ?? '?'}</b>
      {build.artifacts.map((artifact) => <div className="build-artifact" key={artifact.path}><FileCode2 size={12} /><code>{artifact.path}</code><span>{formatFileSize(artifact.size)}</span></div>)}
      {errorLines.map((line, index) => <div className="build-error-line" key={index}>{line}</div>)}
    </div>}
  </div>
}

function TaskHistoryPanel({ tasks, busy, onResume }: { tasks: TaskRecord[]; currentTaskId?: string; busy: boolean; onResume: (task: TaskRecord) => void }) {
  const unfinished = tasks.filter((task) => task.status !== 'completed' || task.pendingSteps.length > 0).slice(0, 8)
  if (!unfinished.length) return null
  const statusLabel = (task: TaskRecord) => task.status === 'completed' && task.pendingSteps.length ? 'Doğrulama adımı açık' : ({ running: 'Çalışıyor', waiting_approval: 'Onay bekliyor', interrupted: 'Yarım kaldı', paused: 'Duraklatıldı', blocked: 'Engellendi', needs_review: 'Doğrulama bekliyor', failed: 'Başarısız', cancelled: 'İptal edildi', completed: 'Tamamlandı' })[task.status]
  return <section className="task-history"><div className="task-history-heading"><strong>Devam edilebilecek görevler</strong><span>{unfinished.length}</span></div>
    {unfinished.map((task) => {
      const resumable = ['interrupted', 'paused', 'blocked', 'needs_review', 'failed', 'cancelled'].includes(task.status) || task.status === 'completed' && task.pendingSteps.length > 0
      return <article className="task-history-row" key={task.id}>
        <div className="task-history-meta"><strong>{task.title}</strong><span>{statusLabel(task)} · {new Date(task.updatedAt).toLocaleString('tr-TR')}</span></div>
        <p>{task.pendingSteps.length ? `Bekleyen: ${task.pendingSteps.slice(0, 2).join(' · ')}` : task.request}</p>
        {task.errors[0] && <small className="task-history-error">{task.errors[0]}</small>}
        {resumable && <button disabled={busy} onClick={() => onResume(task)}><Zap size={11} /> Güncel durumu kontrol et ve sürdür</button>}
      </article>
    })}
  </section>
}

function ApprovalCard({ request, taskTitle, selectedScope, onScopeChange, onApprove, onReject, onCancel }: {
  request: ApprovalRequest
  taskTitle?: string
  selectedScope: ApprovalGrantScope
  onScopeChange: (scope: ApprovalGrantScope) => void
  onApprove: (scope: ApprovalGrantScope) => void
  onReject: () => void
  onCancel: () => void
}) {
  return <div className={`approval-card ${request.kind}`}>
    <div className="approval-head"><div className="approval-icon"><ShieldCheck size={15} /></div><div><strong>{request.kind === 'delete' ? 'Dosya taşıma onayı gerekli' : request.kind === 'system' ? 'Sistem komutu onayı gerekli' : 'Komut onayı gerekli'}</strong><span>Risk: {request.risk === 'low' ? 'düşük' : request.risk === 'medium' ? 'orta' : 'yüksek'} · Kategori: {permissionCategoryLabel(request.category)}</span></div></div>
    <div className="approval-command"><code>{request.command}</code></div>
    <p>{request.reason}<br />Yetki: {request.authority}{request.workingDirectory && <><br />Çalışma klasörü: <code>{request.workingDirectory}</code></>}{request.affectedPaths?.length ? <><br />Etkilenen yollar: {request.affectedPaths.join(', ')}</> : null}<br />Geri alma: {request.rollback}<br />Doğrulama: {request.verification}{request.kind !== 'delete' && <><br />Kimlik bilgisi olabilecek ortam değişkenleri alt süreçten ayıklanır; komutlar yine Windows hesabının yetkileriyle çalışır ve proje betikleri başka dosyalara veya ağa erişebilir.</>}</p>
    {request.allowRemember && <label className="approval-scope">İzin kapsamı<select value={selectedScope} onChange={(event) => onScopeChange(event.target.value as ApprovalGrantScope)}><option value="operation">Yalnızca bu işlem</option><option value="task" disabled={!request.taskId}>Bu görev boyunca{taskTitle ? ` · ${taskTitle}` : ''}</option><option value="project">Bu kategoride bu proje için izin</option><option value="category">Bu kategoriyi tüm projelerde kalıcı olarak izinli yap</option></select><small>{permissionCategoryLabel(request.category)} izni görev boyunca, yalnızca bu projede veya tüm projelerde saklanabilir. Yıkıcı işlemler hiçbir kapsamda otomatik çalışmaz.</small></label>}
    {!request.allowRemember && <div className="approval-scope-note">{request.category === 'destructive' ? 'Bu yıkıcı işlem yalnızca bir kez onaylanabilir; kalıcı izin verilemez.' : request.category === 'network-scan' ? 'Ağ hedefi her taramada ayrı ayrı onaylanır; ağ taraması için kalıcı izin yoktur.' : 'Bu PowerShell betiği salt okunur sorgu izin listesinin dışında; yalnızca bu çalıştırma onaylanabilir.'}</div>}
    <div className="approval-actions"><button className="reject-button" onClick={onReject}>Reddet</button><button className="reject-button" onClick={onCancel}>İptal et</button><button className="apply-button" onClick={() => onApprove(request.allowRemember ? selectedScope : 'operation')}><Check size={13} /> {selectedScope === 'operation' || !request.allowRemember ? request.kind === 'delete' ? 'Yedekle ve taşı' : 'İzin ver ve çalıştır' : 'İzin ver ve kaydet'}</button></div>
  </div>
}

function WorkspaceModal({ workspace, projectPath, onClose, onSaved }: { workspace: WorkspaceState; projectPath: string; onClose: () => void; onSaved: (workspace: WorkspaceState) => void }) {
  const [permissions, setPermissions] = useState(workspace.permissions)
  const [permissionGrants, setPermissionGrants] = useState(workspace.permissionGrants ?? [])
  const [resourceRoots, setResourceRoots] = useState(workspace.resourceRoots ?? [])
  const [newResourceAccess, setNewResourceAccess] = useState<'read' | 'read-write'>('read')
  const [newResourceRecursive, setNewResourceRecursive] = useState(true)
  const [memory, setMemory] = useState<ProjectMemory>(workspace.memory)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function selectProfile(mode: PermissionProfile['mode']) {
    if (mode === 'controlled') setPermissions({ mode, editMode: 'review', commandMode: 'confirm', allowPackageInstalls: false, allowSystemChanges: false, allowDesktopControl: permissions.allowDesktopControl, allowBroadAccess: false, broadAccessConfirmedAt: null })
    else if (mode === 'advanced') setPermissions({ mode, editMode: 'automatic', commandMode: 'automatic', allowPackageInstalls: false, allowSystemChanges: false, allowDesktopControl: permissions.allowDesktopControl, allowBroadAccess: false, broadAccessConfirmedAt: null })
    else setPermissions({ mode, editMode: 'automatic', commandMode: 'automatic', allowPackageInstalls: true, allowSystemChanges: true, allowDesktopControl: permissions.allowDesktopControl, allowBroadAccess: false, broadAccessConfirmedAt: null })
  }
  async function toggleUnrestrictedAccess(enabled: boolean) {
    const previousPermissions = permissions
    let nextPermissions: PermissionProfile
    if (enabled) {
      if (!window.confirm('Açık erişim modu proje dışı kapsamları değerlendirmeye izin verir. Tehlikeli işlemler yine onay ister. Etkinleştirilsin mi?')) return
      // İzin profilini ana süreçteki kalıcı workspace kaydına yaz.
      nextPermissions = { ...broadAccessPermissions, broadAccessConfirmedAt: new Date().toISOString() }
    } else {
      nextPermissions = { ...permissions, allowBroadAccess: false, broadAccessConfirmedAt: null }
    }

    setPermissions(nextPermissions)
    setSaving(true)
    setError('')
    try {
      const saved = await window.kodAtolyesi.saveWorkspace({ permissions: nextPermissions })
      setPermissions(saved.permissions)
    } catch (exception) {
      setPermissions(previousPermissions)
      setError((exception as Error).message || 'İzin profili kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }
  function changeGrantScope(id: string, scope: PermissionGrant['scope']) {
    setPermissionGrants((items) => items.map((grant) => grant.id !== id ? grant : {
      ...grant,
      scope,
      projectPath: scope === 'category' ? '*' : projectPath,
      ...(scope === 'task' ? { taskId: workspace.task?.id ?? grant.taskId ?? '' } : { taskId: undefined }),
    }))
  }
  function changeResource(id: string, patch: Partial<Pick<ResourceRoot, 'recursive' | 'access'>>) {
    setResourceRoots((items) => items.map((root) => root.id === id ? { ...root, ...patch } : root))
  }
  async function addResource() {
    setError('')
    try {
      const root = await window.kodAtolyesi.addResourceRoot({ recursive: newResourceRecursive, access: newResourceAccess })
      if (!root) return
      if (resourceRoots.some((item) => item.path.toLowerCase() === root.path.toLowerCase())) { setError('Bu klasör kapsam listesinde zaten var.'); return }
      setResourceRoots((items) => [...items, root])
    } catch (exception) { setError((exception as Error).message) }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('')
    try { onSaved(await window.kodAtolyesi.saveWorkspace({ permissions, permissionGrants, resourceRoots, memory: { ...memory, updatedAt: new Date().toISOString() } })) }
    catch (exception) { setError((exception as Error).message) }
    finally { setSaving(false) }
  }
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="workspace-modal" onSubmit={(event) => void save(event)}>
    <header><div className="settings-heading-icon"><Brain size={17} /></div><div><h2>Proje hafızası ve yetkiler</h2><p>Bu proje için saklanır; diğer projelerin ayarlarını değiştirmez.</p></div><button className="icon-button" type="button" onClick={onClose}><X size={17} /></button></header>
    <div className="workspace-modal-body">
      <section className="workspace-section"><h3><Code2 size={14} /> Düzenleme ve komut izinleri</h3>
        <label className="field-label" htmlFor="permission-profile">İZİN PROFİLİ</label><select id="permission-profile" className="settings-input" value={permissions.mode} onChange={(event) => selectProfile(event.target.value as PermissionProfile['mode'])}><option value="controlled">Kontrollü — her dosya ve komut için inceleme</option><option value="advanced">Gelişmiş — güvenli geliştirme komutları otomatik</option><option value="personal">Tam erişim — bütün komutlar otomatik</option></select>
        <p className="profile-description">{permissions.mode === 'controlled' ? 'Dosya değişiklikleri taslak olarak gösterilir; terminal komutları tek tek onaylanır.' : permissions.mode === 'advanced' ? 'Dosyalar yedeklenerek uygulanır ve güvenli test/geliştirme komutları çalışır. Paket kurulumları ve sistem işlemleri onay ister.' : 'Dosya değişiklikleri, paket kurulumları, sistem ve PowerShell komutları onay kartı olmadan çalışır. Uygulama yönetici yetkisi yükseltmez; Windows hesabının mevcut erişimleri kullanılır.'}</p>
        <label className="field-label" htmlFor="edit-mode">DOSYA DÜZENLEME</label><select id="edit-mode" className="settings-input" value={permissions.editMode} onChange={(event) => setPermissions({ ...permissions, editMode: event.target.value as typeof permissions.editMode })}><option value="review">Diff göster, uygulamayı ben onaylayayım</option><option value="automatic">Yedek alıp otomatik uygula</option></select>
        <label className="field-label" htmlFor="command-mode">GELİŞTİRME KOMUTLARI</label><select id="command-mode" className="settings-input" value={permissions.commandMode} onChange={(event) => setPermissions({ ...permissions, commandMode: event.target.value as typeof permissions.commandMode })}><option value="confirm">Her komutta onay iste</option><option value="automatic">Uygun geliştirme/test komutlarını otomatik çalıştır</option></select>
        <label className="permission-check"><input type="checkbox" checked={permissions.allowPackageInstalls} onChange={(event) => setPermissions({ ...permissions, allowPackageInstalls: event.target.checked })} /><span><b>Paket kurulumlarını otomatik çalıştır</b><small>npm/pip/Gradle bağımlılık indirmeleri</small></span></label>
        <label className="permission-check"><input type="checkbox" checked={permissions.allowSystemChanges} onChange={(event) => setPermissions({ ...permissions, allowSystemChanges: event.target.checked })} /><span><b>Sistem araçlarını otomatik çalıştır</b><small>Yönetici yetkisi kendiliğinden yükseltilmez</small></span></label>
        <label className="permission-check"><input type="checkbox" checked={permissions.allowDesktopControl} onChange={(event) => setPermissions({ ...permissions, allowDesktopControl: event.target.checked })} /><span><b>Masaüstü kontrolünü etkinleştir</b><small>Ajanın fare, klavye ve ekranı kullanmasına izin ver (kapalıyken bu araçlar ajana hiç gösterilmez)</small></span></label>
        <label className="permission-check"><input type="checkbox" checked={permissions.allowBroadAccess} disabled={saving} onChange={(event) => void toggleUnrestrictedAccess(event.target.checked)} /><span><b>Geniş erişim modunu etkinleştir</b><small>İnternet, uygulama, masaüstü ve dosya kapsamı genişletilebilir; riskli işlemler yine onay ister.</small>{permissions.allowBroadAccess && <em className="permission-active-label">Geniş erişim etkin · onay: {permissions.broadAccessConfirmedAt ? new Date(permissions.broadAccessConfirmedAt).toLocaleString('tr-TR') : 'mevcut profil'}</em>}</span></label>
        <p className="workspace-security-note"><ShieldCheck size={13} /> Tam erişim profilinde işlemler onay kartı olmadan Windows hesabının mevcut erişimleriyle çalışır. Dosya geri alma yedekleri ve işlem günlüğü kullanılmaya devam eder.</p>
      </section>
      <section className="workspace-section"><h3><ShieldCheck size={14} /> Kaydedilmiş izinler</h3><p className="profile-description">Görev ve proje izinleri bu projede, kategori izinleri tüm projelerde saklanır. Tam erişim profilinde bu izin kayıtlarına gerek kalmadan işlemler otomatik çalışır.</p>
        {permissionGrants.length ? <div className="permission-grant-list">{permissionGrants.map((grant) => <div className="permission-grant-row" key={grant.id}><div><strong>{permissionScopeLabel(grant)} · {permissionCategoryLabel(grant.category)}</strong><small>{grant.label}{grant.scope === 'task' ? ` · görev ${grant.taskId?.slice(0, 8)}` : grant.scope === 'category' ? ' · tüm projeler' : ''}</small></div><select aria-label="İzin kapsamını düzenle" value={grant.scope} onChange={(event) => changeGrantScope(grant.id, event.target.value as PermissionGrant['scope'])}><option value="task" disabled={!workspace.task?.id && grant.scope !== 'task'}>Görev</option><option value="project">Proje</option><option value="category">Tüm projeler</option></select><select aria-label="İzin kategorisini düzenle" value={grant.category} onChange={(event) => setPermissionGrants((items) => items.map((item) => item.id === grant.id ? { ...item, category: event.target.value as PermissionCategory } : item))}>{grantableCategories.map((category) => <option key={category} value={category}>{permissionCategoryLabel(category)}</option>)}</select><button type="button" className="reject-button" onClick={() => setPermissionGrants((items) => items.filter((item) => item.id !== grant.id))}><X size={12} /> İptal</button></div>)}</div> : <div className="permission-empty">Bu proje veya kullanıcı için kaydedilmiş izin yok.</div>}
      </section>
      <section className="workspace-section"><h3><FolderOpen size={14} /> Ek kaynak klasörleri</h3><p className="profile-description">Ajan bu seçili klasörleri dosya araçlarıyla kullanabilir. Okuma-yazma ve alt klasör kapsamı klasör başına ayarlanır; kapsam dışındaki mutlak yollar reddedilir.</p>
        {resourceRoots.length ? <div className="permission-grant-list">{resourceRoots.map((root) => <div className="resource-root-row" key={root.id}><div><strong>{root.path}</strong><small>{root.recursive ? 'Alt klasörler dahil' : 'Yalnızca doğrudan içerik'} · {root.access === 'read-write' ? 'Okuma ve yazma' : 'Salt okunur'}</small></div><select aria-label="Klasör erişim türü" value={root.access} onChange={(event) => changeResource(root.id, { access: event.target.value as ResourceRoot['access'] })}><option value="read">Salt okunur</option><option value="read-write">Okuma ve yazma</option></select><label><input type="checkbox" checked={root.recursive} onChange={(event) => changeResource(root.id, { recursive: event.target.checked })} />Alt klasörler</label><button type="button" className="reject-button" onClick={() => setResourceRoots((items) => items.filter((item) => item.id !== root.id))}><X size={12} /> Kaldır</button></div>)}</div> : <div className="permission-empty">Ek kaynak seçilmedi. Proje kökü zaten erişilebilir.</div>}
        <div className="resource-add-row"><select value={newResourceAccess} onChange={(event) => setNewResourceAccess(event.target.value as typeof newResourceAccess)}><option value="read">Yeni klasör: salt okunur</option><option value="read-write">Yeni klasör: okuma ve yazma</option></select><label><input type="checkbox" checked={newResourceRecursive} onChange={(event) => setNewResourceRecursive(event.target.checked)} />Alt klasörler dahil</label><button type="button" className="toolbar-button" onClick={() => void addResource()}><Plus size={12} /> Klasör seç</button></div>
      </section>
      <section className="workspace-section"><h3><Brain size={14} /> Kalıcı proje hafızası</h3>
        <label className="field-label" htmlFor="memory-summary">PROJE ÖZETİ</label><textarea id="memory-summary" className="settings-input workspace-textarea" value={memory.summary} onChange={(event) => setMemory({ ...memory, summary: event.target.value })} placeholder="Projenin amacı ve önemli noktaları" />
        <label className="field-label" htmlFor="memory-architecture">MİMARİ VE ÖNEMLİ DOSYALAR</label><textarea id="memory-architecture" className="settings-input workspace-textarea" value={memory.architecture} onChange={(event) => setMemory({ ...memory, architecture: event.target.value })} placeholder="Modüller, giriş noktaları ve bağımlılıklar" />
        <MemoryLines label="TEKNOLOJİLER" value={memory.technologies} onChange={(technologies) => setMemory({ ...memory, technologies })} />
        <MemoryLines label="ÇALIŞTIRMA / DERLEME KOMUTLARI" value={memory.commands} onChange={(commands) => setMemory({ ...memory, commands })} />
        <MemoryLines label="KULLANICI TERCİHLERİ" value={memory.preferences} onChange={(preferences) => setMemory({ ...memory, preferences })} />
        <MemoryLines label="BİLİNEN SORUNLAR / DENENEN ÇÖZÜMLER" value={memory.knownIssues} onChange={(knownIssues) => setMemory({ ...memory, knownIssues })} />
        <div className="memory-updated">{memory.updatedAt ? `Son güncelleme: ${new Date(memory.updatedAt).toLocaleString('tr-TR')}` : 'Henüz proje hafızası kaydedilmedi'} · {workspace.messages.length} önceki sohbet iletisi kayıtlı</div>
      </section>
      {error && <div className="settings-error"><AlertCircle size={14} />{error}</div>}
    </div>
    <footer><span><ShieldCheck size={13} /> Ayarlar bu proje klasöründe saklanır</span><button className="apply-button" type="submit" disabled={saving}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Kaydet</button></footer>
  </form></div>
}

function MemoryLines({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  return <><label className="field-label">{label}</label><textarea className="settings-input workspace-list-input" value={value.join('\n')} onChange={(event) => onChange(event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))} placeholder="Her satıra bir kayıt" /></>
}

function SettingsModal({ settings, status, onClose, onSaved }: { settings: SettingsForm; status: ModelStatus | null; onClose: () => void; onSaved: (settings: SettingsForm, status: ModelStatus) => void }) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkedStatus, setCheckedStatus] = useState(status)
  const [error, setError] = useState('')
  const visibleStatus = checkedStatus?.baseUrl === form.baseUrl && checkedStatus?.provider === form.provider ? checkedStatus : null
  const isCloud = form.provider === 'openai-compatible'
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const payload: AppConfig & { apiKey?: string; clearApiKey?: boolean } = { provider: form.provider, baseUrl: form.baseUrl, model: form.model, profile: { name: form.profileName, instructions: form.profileInstructions, autoLearn: form.autoLearn } }
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim()
      if (form.clearApiKey) payload.clearApiKey = true
      const result = await window.kodAtolyesi.saveSettings(payload)
      onSaved({ ...form, apiKey: '', apiKeyConfigured: Boolean(form.apiKey.trim()) || (form.apiKeyConfigured && !form.clearApiKey), clearApiKey: false }, result)
    } catch (exception) { setError((exception as Error).message) }
    finally { setSaving(false) }
  }
  return <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><form className="settings-modal" onSubmit={(event) => void save(event)}><header><div className="settings-heading-icon"><Settings2 size={17} /></div><div><h2>Model sağlayıcı ayarları</h2><p>Varsayılan Ollama yerel çalışır; OpenAI uyumlu sağlayıcı yalnızca sen yapılandırırsan etkinleşir.</p></div><button className="icon-button" type="button" onClick={onClose}><X size={17} /></button></header>
    <div className="settings-body"><label className="field-label">SAĞLAYICI</label><div className="provider-switch"><button type="button" className={!isCloud ? 'selected' : ''} onClick={() => setForm({ ...form, provider: 'ollama', baseUrl: /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])/i.test(form.baseUrl) ? form.baseUrl : 'http://127.0.0.1:11434/v1' })}><div className="provider-logo ollama-logo">O</div><span><b>Ollama · yerel</b><small>Tamamen bu bilgisayarda çalışır</small></span>{!isCloud && <Check size={14} />}</button><button type="button" className={isCloud ? 'selected' : ''} onClick={() => setForm({ ...form, provider: 'openai-compatible', baseUrl: /11434|\/api\/tags/i.test(form.baseUrl) ? 'https://api.example.com/v1' : form.baseUrl })}><div className="provider-logo cloud-logo">☁</div><span><b>OpenAI uyumlu</b><small>Bulut veya uzak sunucu · API anahtarı gerekir</small></span>{isCloud && <Check size={14} />}</button></div>
    <label className="field-label" htmlFor="base-url">{isCloud ? 'SAĞLAYICI ADRESİ (TABAN URL)' : 'YEREL OLLAMA ADRESİ'}</label><input id="base-url" className="settings-input" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder={isCloud ? 'https://api.example.com/v1' : 'http://127.0.0.1:11434/v1'} />
    <p className="settings-hint">{isCloud ? 'HTTPS zorunludur; HTTP yalnızca 127.0.0.1, localhost veya ::1 için kabul edilir. /chat/completions veya /models ekini yazman gerekmez.' : 'Yalnızca 127.0.0.1, localhost veya ::1 kabul edilir; uzak ve bulut adresleri reddedilir.'}</p>
    {isCloud && <><label className="field-label" htmlFor="api-key">API ANAHTARI</label><input id="api-key" className="settings-input" type="password" autoComplete="off" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value, clearApiKey: false })} placeholder={form.apiKeyConfigured ? 'Kayıtlı anahtar var · değiştirmek için yeni anahtar gir' : 'sk-...'} /><p className="settings-hint">Anahtar ayarlar dosyasına, görev kaydına veya sohbete yazılmaz; yalnızca kullanıcı veri klasöründeki provider-secrets.json dosyasında ya da ULTRON_OPENAI_API_KEY ortam değişkeninde tutulur. Boş bırakırsan kayıtlı anahtar korunur.</p>{form.apiKeyConfigured && <label className="settings-checkbox" htmlFor="clear-api-key"><input id="clear-api-key" type="checkbox" checked={form.clearApiKey} onChange={(event) => setForm({ ...form, clearApiKey: event.target.checked, apiKey: '' })} /><span><b>Kayıtlı API anahtarını sil</b><small>Anahtar yalnızca bu bilgisayardan silinir; sağlayıcı hesabında ayrıca iptal etmen gerekebilir.</small></span></label>}</>}
    <label className="field-label" htmlFor="model-name">MODEL</label><input id="model-name" className="settings-input" value={form.model} list="model-options" onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder={isCloud ? 'gpt-4o-mini vb.' : 'qwen3:8b'} /><datalist id="model-options">{visibleStatus?.models.map((model) => <option key={model} value={model} />)}</datalist>{visibleStatus?.models.length ? <div className="model-options">{visibleStatus.models.slice(0, 8).map((model) => <button type="button" key={model} className={model === form.model ? 'active' : ''} onClick={() => setForm({ ...form, model })}>{model}</button>)}</div> : null}
    <label className="field-label" htmlFor="profile-name">KİŞİSEL AD <span>isteğe bağlı</span></label><input id="profile-name" className="settings-input" maxLength={60} value={form.profileName} onChange={(event) => setForm({ ...form, profileName: event.target.value })} placeholder="Adın" />
    <label className="field-label" htmlFor="profile-instructions">KALICI KİŞİSEL TALİMATLAR <span>isteğe bağlı</span></label><textarea id="profile-instructions" className="settings-input settings-textarea" maxLength={2000} rows={3} value={form.profileInstructions} onChange={(event) => setForm({ ...form, profileInstructions: event.target.value })} placeholder="Örn. Kısa ve doğrudan yanıt ver; her kod değişikliğinden sonra testleri çalıştır." />
    <p className="settings-hint">Bu profil yalnızca bu bilgisayardaki yerel ayarlarda saklanır ve ajanın sistem bağlamına eklenir; hiçbir sunucuya gönderilmez.</p>
    <label className="settings-checkbox" htmlFor="profile-autolearn"><input id="profile-autolearn" type="checkbox" checked={form.autoLearn} onChange={(event) => setForm({ ...form, autoLearn: event.target.checked })} /><span><b>Otomatik öğrenme</b><small>Kapalıyken yalnızca "şunu hatırla: …" gibi açık istekler kaydedilir. Açıkken düzeltmeler ve tamamlanan görev özetleri de yerel hafızaya eklenir; bu bilgileri Hafıza panelinden düzenleyip silebilirsin.</small></span></label>
    <div className={`connection-status ${visibleStatus?.connected ? 'connected' : 'disconnected'}`}><span className={`connection-dot ${visibleStatus?.connected ? 'online' : ''}`} /><div><b>{visibleStatus?.connected ? (isCloud ? 'Sağlayıcı bağlantısı doğrulandı' : 'Yerel Ollama hazır') : (isCloud ? 'Sağlayıcı bağlantısı bekleniyor' : 'Ollama bağlantısı bekleniyor')}</b><span>{visibleStatus?.connected ? `${visibleStatus.models.length} model listelendi` : visibleStatus?.note ?? 'Bağlantıyı denetle.'}</span></div><button type="button" title="Bağlantıyı denetle" disabled={checking} onClick={() => { setChecking(true); void window.kodAtolyesi.getStatus().then(setCheckedStatus).finally(() => setChecking(false)) }}><RefreshCw size={13} className={checking ? 'spin' : ''} /></button></div>
    <div className="workspace-security-note"><ShieldCheck size={13} /><span>{isCloud ? <><b>Bulut/uzak sağlayıcı:</b> İstemler ve modele gönderilen dosya içerikleri yapılandırdığın adrese gider. API anahtarı yerel olarak saklanır ve loglara yazılmaz; gizli kod göndermeden önce sağlayıcı politikasını doğrula.</> : <><b>Tamamen yerel ve özel:</b> Sohbet, proje kodu ve model yanıtları yalnızca bu bilgisayarda kalır. Hiçbir dış sunucuya, API anahtarına veya üçüncü taraf yapay zekâya veri gönderilmez.</>}</span></div>
    {error && <div className="settings-error"><AlertCircle size={14} />{error}</div>}</div><footer><span><ShieldCheck size={13} /> {isCloud ? 'Anahtar yerelde saklanır · bulut kotası kullanıcıya aittir' : 'Yerel model · internet gerekmez'}</span><button className="apply-button" type="submit" disabled={saving}>{saving ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />} Ayarları kaydet</button></footer></form></div>
}

// ---- Dosyalar / Yazılımlar / Eklentiler yan panelleri ----
type AppFileSearchHit = { name: string; path: string; relativePath: string; extension: string; sizeBytes: number; modifiedAt: string; kind: string; matchType: string; snippets: string[]; extractNotice: string | null }
type AppFileSearchOutcome = { scope: { root: string; label: string; scopeId: string }; hits: AppFileSearchHit[]; summary: string; truncated: boolean; visitedFiles: number; permissionDenied: number; errors: string[]; durationMs: number; notices: string[] }
type AppPreviewCard = { path: string; name: string; sizeBytes: number; modifiedAt: string; method: string; isBinary: boolean; notice: string | null; text: string }
type AppSoftwareEntry = { name: string; version: string | null; publisher: string | null; installLocation: string | null; executablePath: string | null; source: 'registry' | 'path' | 'start-menu'; categories: string[]; capabilities: string[] }
type AppAdapterSummary = { id: string; name: string; executable: string; actions: Array<{ id: string; description: string; risk: string; needsProject: boolean }> }
type AppCapabilityReport =
  | { handled: false; message: string }
  | { handled: true; need: { id: string; label: string; extensions: string[] }; builtIn?: boolean; installed: Array<{ name: string; version: string | null; source: string }>; missing: Array<{ name: string; downloadUrl: string }>; note: string }
type AppPluginItem = {
  id: string
  version: string
  enabled: boolean
  permissions: string[]
  installedAt: string
  updatedAt: string
  lastRunAt?: string
  lastRunCallCount?: number
  lastError?: string
  checksum?: string
  name?: string
  manifestValid: boolean
  tools: Array<{ name: string; description: string }>
  description?: string
}

function DesktopPanel({ projectPath, paused, onTogglePause, setToast }: { projectPath: string | null; paused: boolean; onTogglePause: () => void; setToast: (message: string) => void }) {
  const [state, setState] = useState<{ screen?: { width: number; height: number }; focusedWindow?: { title?: string; process?: string } | null; windows?: Array<{ title: string; process: string }>; processes?: Array<{ Id?: number; ProcessName?: string; MainWindowTitle?: string; Responding?: boolean }>; windowCount?: number; cursor?: { x: number; y: number } } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [screenshot, setScreenshot] = useState('')
  const [preflight, setPreflight] = useState<{ notes?: string[]; hasInteractiveDesktop?: boolean } | null>(null)

  const refresh = useCallback(async () => {
    const result = await window.kodAtolyesi.getDesktopState()
    if (!result.ok) { setError(result.error ?? 'Masaüstü durumu okunamadı.'); return }
    setState((result.state ?? null) as typeof state)
    setError('')
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Teşhis: ortam masaüstü kontrolüne izin veriyor mu?
  const runPreflight = useCallback(async () => {
    const result = await window.kodAtolyesi.invokeDesktop('preflight', {})
    if (!result.ok) { setError(result.error ?? 'Teşhis yapılamadı.'); return }
    const payload = result.result as { preflight?: { notes?: string[]; hasInteractiveDesktop?: boolean } }
    setPreflight(payload?.preflight ?? null)
    setError('')
  }, [])

  const run = async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      const result = await window.kodAtolyesi.invokeDesktop(action, payload)
      if (!result.ok) { setError(result.error ?? 'Eylem tamamlanamadı.'); return }
      setError('')
      const parsed = result.result as { focusedWindow?: { title?: string }; windows?: Array<{ title: string }>; processes?: Array<{ Id?: number; ProcessName?: string; MainWindowTitle?: string; Responding?: boolean }>; screenshotPath?: string } | undefined
      if (parsed?.screenshotPath) setScreenshot(parsed.screenshotPath)
      setState((prev) => ({ ...(prev ?? {}), ...(parsed ?? {}) }) as typeof state)
      setToast(`${action} tamamlandı.`)
    } catch (event) { setError((event as Error).message) } finally { setBusy(false) }
  }

  return <div className="android-panel desktop-panel">
    <div className="panel-intro android-panel-intro"><div><strong>Masaüstü kontrolü</strong><span>Fare, klavye, pencere ve ekran</span></div>
      <button className="icon-button tiny" onClick={() => void refresh()} disabled={busy} title="Masaüstü durumunu yenile"><RefreshCw size={14} className={busy ? 'spin' : ''} /></button>
    </div>
    {paused && <div className="panel-error"><AlertCircle size={12} />Masaüstü otomasyonu durduruldu.</div>}
    {error && <div className="panel-error"><AlertCircle size={12} />{error}</div>}
    {preflight?.notes && <div className="desktop-preflight">{preflight.notes.map((note) => <div key={note}>{note}</div>)}</div>}
    <div className="android-env-summary">
      <div><small>Odaklı pencere</small><strong>{state?.focusedWindow?.title || '—'}</strong></div>
      <div><small>Ekran</small><strong>{state?.screen ? `${state.screen.width}×${state.screen.height}` : '—'}</strong></div>
      <div><small>Açık pencere</small><strong>{state?.windowCount ?? state?.windows?.length ?? 0}</strong></div>
      <div><small>Fare</small><strong>{state?.cursor ? `${state.cursor.x}, ${state.cursor.y}` : '—'}</strong></div>
    </div>
    <div className="android-section-head"><strong>Hızlı eylemler</strong>
      <button className="android-text-action" onClick={() => void runPreflight()}>Ortamı teşhis et</button>
    </div>
    <div className="desktop-action-row">
      <button className="android-text-action" disabled={busy} onClick={() => void run('screenshot')}>Ekran görüntüsü</button>
      <button className="android-text-action" disabled={busy} onClick={() => void run('launch_app', { path: 'not defteri' })}>Not Defteri</button>
      <button className="android-text-action" disabled={busy} onClick={() => void run('launch_app', { path: 'hesap makinesi' })}>Hesap Makinesi</button>
      <button className="android-text-action" disabled={busy || !projectPath} onClick={() => void run('open_explorer', { path: projectPath })}>Dosya Gezgini</button>
      <button className="android-text-action" disabled={busy} onClick={() => void run('window_list')}>Pencereler</button>
      <button className="android-text-action" disabled={busy} onClick={() => void run('process_list')}>Süreçler</button>
    </div>
    {state?.processes?.length ? <div className="desktop-process-list">{state.processes.slice(0, 12).map((proc) => <div className="desktop-process-row" key={`${proc.Id}-${proc.ProcessName}`}><code>{proc.ProcessName ?? '—'}</code><span>PID {proc.Id ?? '—'}</span><small>{proc.MainWindowTitle || (proc.Responding === false ? 'yanıt vermiyor' : 'arka plan')}</small></div>)}</div> : null}
    <DesktopAutomationPanel windows={(state?.windows ?? []).map((item) => ({ title: item.title, process: item.process }))} processes={state?.processes ?? []} status={busy ? 'Masaüstü durumu güncelleniyor…' : error ? '' : 'Hazır'} error="" onRefresh={() => void refresh()} busy={busy} />
    <div className="android-section-head"><strong>Metin yaz</strong></div>
    <input className="settings-input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Yazılacak metin" disabled={busy} />
    <div className="desktop-action-row">
      <button className="android-text-action" disabled={busy || !note.trim()} onClick={() => void run('keyboard_type', { text: note })}>Yaz</button>
      <button className="android-text-action" disabled={busy} onClick={() => void run('keyboard_keys', { keys: 'ctrl+s' })}>Ctrl+S</button>
      <button className="android-text-action" disabled={busy} onClick={() => void run('keyboard_keys', { keys: 'enter' })}>Enter</button>
    </div>
    {screenshot && <div className="desktop-screenshot-note"><FileText size={12} />Ekran görüntüsü: {screenshot}</div>}
    <div className="desktop-action-row">
      <button className="android-text-action" onClick={onTogglePause}>{paused ? 'Otomasyonu sürdür' : 'Otomasyonu durdur'}</button>
    </div>
  </div>
}

function FilesWorkspacePanel({ setToast }: { setToast: (message: string) => void }) {
  const [scope, setScope] = useState('')
  const [scopes, setScopes] = useState<{ project: { value: string; label: string } | null; resources: Array<{ value: string; label: string; access: string }> }>({ project: null, resources: [] })
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<AppFileSearchOutcome | null>(null)
  const [preview, setPreview] = useState<AppPreviewCard | null>(null)
  const [history, setHistory] = useState<Array<{ text: string; scope: string; at: string; resultCount: number }>>([])
  const [indexScopes, setIndexScopes] = useState<Array<{ root: string; builtAt: string; entries: number }>>([])

  useEffect(() => {
    void window.kodAtolyesi.listFileScopes().then((data) => { setScopes(data); if (!data.project) setScope(data.resources[0]?.value ?? '') }).catch((event) => setError((event as Error).message))
    void window.kodAtolyesi.getFileSearchHistory().then((data) => setHistory(data.queries.slice(0, 10))).catch(() => undefined)
    void window.kodAtolyesi.getFileIndexStatus().then((data) => setIndexScopes(data.scopes)).catch(() => undefined)
  }, [])

  const runSearch = async (text: string, targetScope = scope) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError('')
    try {
      const result = (await window.kodAtolyesi.runFileSearch(trimmed, targetScope)) as AppFileSearchOutcome
      setOutcome(result)
      setPreview(null)
      const historyData = await window.kodAtolyesi.getFileSearchHistory()
      setHistory(historyData.queries.slice(0, 10))
    } catch (event) { setError((event as Error).message) }
    finally { setBusy(false) }
  }

  const refreshIndex = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await window.kodAtolyesi.refreshFileIndex(scope) as { scope: { label: string }; delta: { added: number; changed: number; removed: number }; builtAt: string }
      setToast(`${result.scope.label} indeksi yenilendi: +${result.delta.added} yeni / ~${result.delta.changed} değişen / −${result.delta.removed} silinen`)
      const status = await window.kodAtolyesi.getFileIndexStatus()
      setIndexScopes(status.scopes)
    } catch (event) { setError((event as Error).message) }
    finally { setBusy(false) }
  }

  const previewFile = async (target: string) => {
    try { setPreview(await window.kodAtolyesi.previewProjectFile(target)) }
    catch (event) { setToast((event as Error).message) }
  }

  return <div className="right-panel-content">
    <div className="panel-intro"><div><strong>Dosya arama motoru</strong><span>Yetkili kapsamlarda gerçek tarama: ad, içerik, kopya, boyut ve tarih</span></div><button className="icon-button tiny" title="İndeksi yenile" onClick={() => void refreshIndex()}><RefreshCw size={15} /></button></div>
    <div className="files-body">
      <div className="files-scope-row">
        <select className="files-scope" value={scope} onChange={(event) => setScope(event.target.value)}>
          {scopes.project && <option value="">{scopes.project.label}</option>}
          {scopes.resources.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <button className="panel-action" disabled={busy || !query.trim()} onClick={() => void runSearch(query)}>{busy ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />} Ara</button>
      </div>
      <textarea className="files-query" rows={2} placeholder='Örn: "adı rapor geçen pdf bul", "içinde hata geçen docx", "son değiştirdiğim excel", "kopya dosyalar"' value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void runSearch(query) } }} />
      {error && <div className="panel-error"><AlertCircle size={13} />{error}</div>}
      {!error && !outcome && !busy && <div className="panel-blank small"><div className="blank-icon"><Search size={17} /></div><strong>Örnek aramalar</strong><p>"masaüstünde resim dosyalarını bul"<br />"içinde MYSQL_PASS geçen dosyalar"<br />"100 MB'den büyük dosyalar"</p></div>}
      {outcome && <div className="files-outcome">
        <pre className="files-summary">{outcome.summary}</pre>
        {outcome.notices.map((notice, index) => <p className="files-notice" key={index}>{notice}</p>)}
        {outcome.errors.slice(0, 3).map((item, index) => <p className="files-notice error" key={`e-${index}`}>{item}</p>)}
        <div className="files-hit-list">
          {outcome.hits.map((hit) => <div className="files-hit" key={hit.path}>
            <div className="files-hit-top"><strong>{hit.name}</strong><span>{formatFileSize(hit.sizeBytes)} · {new Date(hit.modifiedAt).toLocaleDateString('tr-TR')}</span></div>
            <code>{hit.relativePath}</code>
            {hit.snippets.slice(0, 1).map((snippet, index) => <pre className="files-snippet" key={index}>{snippet}</pre>)}
            {hit.extractNotice && <small className="files-extract-note">{hit.extractNotice}</small>}
            {scope === '' && <div className="files-hit-actions"><button onClick={() => void previewFile(hit.path)}><FileText size={11} /> Ön izle</button><button onClick={() => void window.kodAtolyesi.openFileLocation(hit.path).then(() => setToast('Konumu yolda gösterildi.')).catch((event) => setToast((event as Error).message))}><FolderOpen size={11} /> Konumda göster</button></div>}
          </div>)}
        </div>
        {!outcome.hits.length && <div className="panel-blank small"><strong>Sonuç bulunamadı</strong><p>Terimi sadeleştirip yeniden deneyin.</p></div>}
      </div>}
      {preview && <div className="files-preview-card">
        <div className="files-hit-top"><strong>{preview.name}</strong><span>{formatFileSize(preview.sizeBytes)} · {preview.method}</span></div>
        <button className="panel-action ghost" onClick={() => setPreview(null)}><X size={11} /> Kapat</button>
        {preview.notice && <p className="files-notice">{preview.notice}</p>}
        <pre className="files-snippet tall">{preview.text.slice(0, 1600) || '(bozuk/ikili içerik ön izlenemedi)'}</pre>
      </div>}
      <div className="files-history-head"><span>Geçmiş aramalar</span><button className="icon-button tiny" title="Geçmişi temizle" onClick={() => void window.kodAtolyesi.clearFileSearchHistory().then(() => { setHistory([]); setToast('Arama geçmişi temizlendi.') }).catch((event) => setToast((event as Error).message))}><Trash2 size={12} /></button></div>
      {history.map((item) => <button className="files-history-item" key={`${item.at}-${item.text}`} onClick={() => void runSearch(item.text, item.scope)}><span>{item.text}</span><em>{item.resultCount}</em></button>)}
      <p className="files-index-note">{indexScopes.length ? `İndeks: ${indexScopes.length} kapsam, ${indexScopes.reduce((sum, item) => sum + item.entries, 0)} dosya kayıtlı.` : 'İndeks henüz kurulmadı; sağ üstteki yenile düğmesinden kurabilirsiniz.'}</p>
    </div>
  </div>
}

function SoftwarePanel({ setToast }: { setToast: (message: string) => void }) {
  const [entries, setEntries] = useState<Array<AppSoftwareEntry>>([])
  const [builtAt, setBuiltAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [testing, setTesting] = useState('')
  const [testResult, setTestResult] = useState<{ name: string; ok: boolean; output: string } | null>(null)
  const [adapters, setAdapters] = useState<Array<AppAdapterSummary>>([])
  const [adapterResult, setAdapterResult] = useState<{ id: string; ok: boolean; output: string } | null>(null)
  const [need, setNeed] = useState('')
  const [report, setReport] = useState<AppCapabilityReport | null>(null)

  useEffect(() => {
    void window.kodAtolyesi.getSoftwareCatalog().then((data) => { setEntries(data.catalog.entries); setBuiltAt(data.catalog.builtAt) }).catch((event) => setToast((event as Error).message))
    void window.kodAtolyesi.listAppAdapters().then((data) => setAdapters(data.adapters)).catch(() => undefined)
  }, [])

  const refresh = async () => {
    setLoading(true)
    setToast('Yazılım taraması sürüyor; kayıt defteri, PATH ve Başlat menüsü taranıyor…')
    try {
      const data = await window.kodAtolyesi.refreshSoftwareCatalog()
      setEntries(data.catalog.entries)
      setBuiltAt(data.catalog.builtAt)
      setToast(`Katalog yenilendi: ${data.catalog.entries.length} kayıt.`)
    } catch (event) { setToast((event as Error).message) }
    finally { setLoading(false) }
  }

  const testEntry = async (name: string) => {
    setTesting(name)
    setTestResult(null)
    try {
      const result = await window.kodAtolyesi.testSoftwareEntry(name)
      setTestResult({ name, ok: result.ok, output: result.output })
    } catch (event) { setToast((event as Error).message) }
    finally { setTesting('') }
  }

  const checkThis = async () => {
    if (!need.trim()) return
    setReport(null)
    try { setReport(await window.kodAtolyesi.checkCapability(need.trim())) }
    catch (event) { setToast((event as Error).message) }
  }

  const filtered = entries.filter((entry) => !filter.trim() || entry.name.toLocaleLowerCase('tr-TR').includes(filter.trim().toLocaleLowerCase('tr-TR')))

  return <div className="right-panel-content">
    <div className="panel-intro"><div><strong>Yüklü yazılımlar</strong><span>Gerçek envanter: kayıt defteri + PATH + Başlat menüsü{builtAt ? ` · ${new Date(builtAt).toLocaleString('tr-TR')}` : ''}</span></div><button className="icon-button tiny" title="Kataloğu yenile" onClick={() => void refresh()}><RefreshCw size={15} /></button></div>
    <div className="files-body">
      <div className="files-scope-row">
        <input className="files-query inline" placeholder="Adına göre filtrele (örn. git)" value={filter} onChange={(event) => setFilter(event.target.value)} />
      </div>
      {loading && <p className="files-index-note"><LoaderCircle size={11} className="spin" /> Katalog yükleniyor/yenileniyor…</p>}
      <div className="software-list">
        {filtered.slice(0, 90).map((entry) => <div className="software-row" key={`${entry.name}-${entry.source}`}>
          <div className="software-info"><strong>{entry.name}</strong><small>{entry.version ? `v${entry.version}` : 'sürüm bilinmiyor'} · {({ registry: 'Kayıt defteri', path: 'PATH aracı', 'start-menu': 'Başlat menüsü' })[entry.source]}{entry.publisher ? ` · ${entry.publisher}` : ''}</small>
            <span className="software-caps">{[...entry.categories, ...entry.capabilities].slice(0, 5).map((tag) => <em key={tag}>{tag}</em>)}</span>
          </div>
          <div className="software-actions">
            {entry.executablePath && <button title="Sürüm testi çalıştır" onClick={() => void testEntry(entry.name)}>{testing === entry.name ? <LoaderCircle size={11} className="spin" /> : <Zap size={11} />}</button>}
            <button title="Programı başlat" onClick={() => void window.kodAtolyesi.launchSoftwareEntry(entry.name).then((result) => setToast(result.message)).catch((event) => setToast((event as Error).message))}><Check size={11} /></button>
          </div>
        </div>)}
        {!loading && !filtered.length && <p className="files-index-note">{entries.length ? 'Filtreye uyan kayıt yok.' : 'Katalog boş; yenile düğmesiyle tara.'}</p>}
        {filtered.length > 90 && <p className="files-index-note">İlk 90 kayıt gösteriliyor (toplam {filtered.length}). Filtreyi daraltın.</p>}
      </div>
      {testResult && <div className={`software-testout ${testResult.ok ? 'ok' : 'fail'}`}><strong>{testResult.name} · sürüm testi</strong><pre>{testResult.output}</pre></div>}
      <div className="capability-row">
        <input className="files-query inline" placeholder="Yetenek sorgusu: pdf, video kesme, görsel düzenleme…" value={need} onChange={(event) => setNeed(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void checkThis() } }} />
        <button className="panel-action" onClick={() => void checkThis()}><Search size={12} /> Analiz</button>
      </div>
      {report && (!report.handled ? <div className="capability-report"><strong>Desteklenmeyen gereksinim</strong><p>{report.message}</p></div> : <div className="capability-report">
        <strong>{report.need.label}{report.builtIn ? ' · yerleşik çözüm mevcut' : ''}</strong>
        {report.installed.length > 0 && <p>{report.installed.map((item) => `${item.name}${item.version ? ` ${item.version}` : ''}`).join(' · ')} kurulu.</p>}
        {report.missing.map((item) => <p key={item.name}>Öneri: <a href={item.downloadUrl} onClick={(event) => { event.preventDefault(); setToast('Bağlantı panoya kopyalandı.'); void navigator.clipboard.writeText(item.downloadUrl) }}>{item.name} ({item.downloadUrl})</a></p>)}
        <small>{report.note}</small>
      </div>)}
      <div className="adapter-head"><span>Uygulama adaptörleri ({adapters.length})</span><small>komutlar yalnızca katalogdan üretilir</small></div>
      <div className="adapter-list">
        {adapters.map((adapter) => <div className="adapter-row" key={adapter.id}>
          <strong>{adapter.name}</strong>
          <code>{adapter.executable}</code>
          <small>{adapter.actions.length} eylem ({adapter.actions.filter((action) => action.risk === 'read-only').length} salt okunur, {adapter.actions.filter((action) => action.risk === 'write').length} onaylı, {adapter.actions.filter((action) => action.risk === 'install').length} kurulum)</small>
          <button title="Adaptör sürüm testi" onClick={() => void window.kodAtolyesi.testAppAdapter(adapter.id).then((result) => setAdapterResult({ id: adapter.id, ok: result.ok, output: result.output })).catch((event) => setToast((event as Error).message))}><Zap size={11} /></button>
        </div>)}
      </div>
      {adapterResult && <div className={`software-testout ${adapterResult.ok ? 'ok' : 'fail'}`}><strong>{adapterResult.id} · adaptör testi</strong><pre>{adapterResult.output}</pre></div>}
    </div>
  </div>
}

function PluginsPanel({ setToast }: { setToast: (message: string) => void }) {
  const [plugins, setPlugins] = useState<Array<AppPluginItem>>([])
  const [rootDir, setRootDir] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [runResult, setRunResult] = useState<{ plugin: string; tool: string; ok: boolean; text: string } | null>(null)

  const load = useCallback(() => {
    void window.kodAtolyesi.listPlugins().then((data) => { setPlugins(data.plugins); setRootDir(data.rootDir) }).catch((event) => setMessage((event as Error).message))
  }, [])

  useEffect(() => { load() }, [load])

  const perform = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true)
    setMessage('')
    try {
      await action()
      setMessage(`${label} tamam.`)
      load()
    } catch (event) { setMessage((event as Error).message) }
    finally { setBusy(false) }
  }

  const runTool = (pluginId: string, toolName: string) => {
    void perform(`${pluginId}/${toolName} çalıştırılıyor`, async () => {
      const result = await window.kodAtolyesi.invokePluginTool(pluginId, toolName, {})
      if (!result.ok) throw new Error(`Eklenti aracı hata döndürdü: ${JSON.stringify(result.result ?? {}).slice(0, 200)}`)
      setRunResult({ plugin: pluginId, tool: toolName, ok: true, text: JSON.stringify(result.result ?? {}, null, 1).slice(0, 1200) })
    })
  }

  return <div className="right-panel-content">
    <div className="panel-intro"><div><strong>Eklentiler</strong><span>Yerel klasörten veya .zip'ten kurulur; her eklenti ayrı süreçte izole çalışır</span></div><button className="icon-button tiny" title="Eklenti klasörünü aç" onClick={() => void window.kodAtolyesi.openPluginFolder().then((result) => !result.ok && setToast(result.message)).catch((event) => setToast((event as Error).message))}><FolderOpen size={15} /></button></div>
    <div className="files-body">
      <div className="plugins-toolbar">
        <button className="panel-action" disabled={busy} onClick={() => void perform('Klasörden kurulum', async () => { const result = await window.kodAtolyesi.installPluginDirectory(); if (!result.canceled) setToast(`${result.id} v${result.version} kuruldu; Etkinleştir ile aracını kullan.`) })}><Plus size={12} /> Klasörden kur</button>
        <button className="panel-action" disabled={busy} onClick={() => void perform('ZIP kurulum', async () => { const result = await window.kodAtolyesi.installPluginZip(); if (!result.canceled) setToast(`${result.id} v${result.version} kuruldu; Etkinleştir ile aracını kullan.`) })}><Download size={12} /> ZIP kur</button>
        <button className="panel-action" disabled={busy} onClick={() => void perform('Kaynaktan güncelleme', async () => { const result = await window.kodAtolyesi.updatePluginDirectory(); if (!result.canceled) setToast(`${result.id} v${result.version} olarak güncellendi.`) })}><RefreshCw size={12} /> Güncelle (klasörden)</button>
      </div>
      <p className="plugin-note">Eklenti kataloğu v1: yalnızca yerel klasör/zip kaynağı, <code>manifest.json</code> zorunlu, süreç izolasyonu ile çalışır; ağ izni isteyen paketler bu sürümde etkinleştirilmez. {rootDir && <>Kurulum dizini: <code>{rootDir}</code></>}</p>
      {message && <div className="panel-error"><AlertCircle size={12} />{message}</div>}
      {!!plugins.length && <div className="plugin-list">
        {plugins.map((plugin) => <div className="plugin-card" key={plugin.id}>
          <div className="plugin-head"><strong>{plugin.name ?? plugin.id}</strong><span className={`plugin-state ${plugin.enabled ? 'on' : 'off'}`}><Circle size={7} fill="currentColor" /> {plugin.enabled ? 'etkin' : 'kapalı'}</span><em>v{plugin.version}</em></div>
          {plugin.description && <small className="plugin-description">{plugin.description}</small>}
          <div className="plugin-badges">{plugin.permissions.map((item) => <em key={item}>{item}</em>)}{!plugin.manifestValid && <em className="bad">manifest bozuk</em>}{plugin.lastRunCallCount ? <em>çağrı: {plugin.lastRunCallCount}</em> : null}</div>
          {plugin.lastError && <small className="plugin-lasterror">Son hata: {plugin.lastError}</small>}
          {plugin.tools.length > 0 && <div className="plugin-tools">{plugin.tools.map((tool) => <div className="plugin-tool-row" key={tool.name}><code>{tool.name}</code><small>{tool.description}</small>{plugin.enabled && <button title="Boş argümanla test çalıştır" disabled={busy} onClick={() => runTool(plugin.id, tool.name)}><Zap size={11} /></button>}</div>)}</div>}
          <div className="plugin-actions">
            {plugin.enabled
              ? <button disabled={busy} onClick={() => void perform(`${plugin.id} devre dışı`, () => window.kodAtolyesi.disablePlugin(plugin.id))}><X size={12} /> Devre dışı</button>
              : <button disabled={busy || !plugin.manifestValid} onClick={() => void perform(`${plugin.id} etkinleştirildi`, () => window.kodAtolyesi.enablePlugin(plugin.id))}><Check size={12} /> Etkinleştir</button>}
            <button disabled={busy} title="Kurulu sürümü önceki sürüme döndürür (yedek varsa)" onClick={() => void perform(`${plugin.id} önceki sürüme döndürüldü`, () => window.kodAtolyesi.rollbackPlugin(plugin.id))}><Undo2 size={12} /> Geri al</button>
            <button disabled={busy} onClick={() => { if (window.confirm(`${plugin.id} eklentisi ve araçları tamamen kaldırılsın mı?`)) void perform(`${plugin.id} kaldırıldı`, () => window.kodAtolyesi.uninstallPlugin(plugin.id)) }}><Trash2 size={12} /> Kaldır</button>
          </div>
        </div>)}
      </div>}
      {!plugins.length && !busy && <div className="panel-blank small"><div className="blank-icon"><Puzzle size={17} /></div><strong>Kurulu eklenti yok</strong><p>"Klasörden kur" ile manifest.json içeren bir eklenti dizini; "ZIP kur" ile paket ekleyin.</p></div>}
      {runResult && <div className={`software-testout ${runResult.ok ? 'ok' : 'fail'}`}><strong>{runResult.plugin} · {runResult.tool}</strong><pre>{runResult.text}</pre></div>}
    </div>
  </div>
}

export default App
