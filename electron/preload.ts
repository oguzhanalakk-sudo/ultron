import { contextBridge, ipcRenderer } from 'electron'
import type { AndroidDevice, AndroidEnvironment, AppEvent, AppConfig, AppSettings, ApprovalDecision, LocalAIStatus, LocalModelActionResult, MemoryEntry, MemoryKind, ResourceRoot, TaskRecord, UserMemory, VoiceStatus, WorkspaceState, WebProjectAnalysis, WindowsEnvironment } from './shared'
import type { WindowsProjectAnalysis } from './windows-build-tool'
import type { SoftwareEntry } from './software-discovery'
import type { PluginStateEntry } from './plugin-manager'

type SoftwareCatalogEntry = SoftwareEntry
type AdapterSummary = {
  id: string
  name: string
  executable: string
  actions: Array<{ id: string; description: string; risk: string; needsProject: boolean }>
}
type PluginItem = PluginStateEntry & {
  manifestValid: boolean
  tools: Array<{ name: string; description: string }>
  description?: string
}
type PluginActionResult =
  | { canceled: true }
  | { canceled: false; id: string; version: string; entry: PluginStateEntry }

type CapabilityReportPayload =
  | { handled: false; message: string }
  | {
      handled: true
      need: { id: string; label: string; extensions: string[] }
      builtIn?: boolean
      installed: Array<{ name: string; version: string | null; source: string }>
      missing: Array<{ name: string; downloadUrl: string }>
      note: string
    }

const api = {
  getProject: () => ipcRenderer.invoke('project:get'),
  openProject: () => ipcRenderer.invoke('project:open'),
  getTree: () => ipcRenderer.invoke('project:tree'),
  readFile: (path: string) => ipcRenderer.invoke('project:read', path),
  getAndroidEnvironment: () => ipcRenderer.invoke('android:environment') as Promise<AndroidEnvironment>,
  getAndroidDevices: () => ipcRenderer.invoke('android:devices') as Promise<AndroidDevice[]>,
  analyzeAndroidProject: () => ipcRenderer.invoke('android:analyze'),
  analyzeWebProject: () => ipcRenderer.invoke('web:analyze') as Promise<WebProjectAnalysis>,
  getWindowsEnvironment: () => ipcRenderer.invoke('windows:environment') as Promise<WindowsEnvironment>,
  analyzeWindowsProject: (projectPath?: string) => ipcRenderer.invoke('windows:analyze', projectPath ?? '') as Promise<{ projectPath: string; analysis: WindowsProjectAnalysis }>,
  getStatus: () => ipcRenderer.invoke('model:status'),
  getLocalAIStatus: () => ipcRenderer.invoke('localai:status') as Promise<LocalAIStatus>,
  pullLocalModel: (model: string) => ipcRenderer.invoke('localai:pull', model) as Promise<LocalAIStatus>,
  deleteLocalModel: (model: string) => ipcRenderer.invoke('localai:delete', model) as Promise<LocalAIStatus>,
  loadLocalModel: (model: string) => ipcRenderer.invoke('localai:load', model) as Promise<LocalModelActionResult>,
  unloadLocalModel: (model: string) => ipcRenderer.invoke('localai:unload', model) as Promise<LocalModelActionResult>,
  testLocalModel: (model: string) => ipcRenderer.invoke('localai:test', model) as Promise<LocalModelActionResult>,
  getVoiceStatus: () => ipcRenderer.invoke('voice:status') as Promise<VoiceStatus>,
  getUserMemory: () => ipcRenderer.invoke('memory:list') as Promise<UserMemory>,
  addUserMemory: (payload: { kind: MemoryKind; text: string; tags?: string[] }) => ipcRenderer.invoke('memory:add', payload) as Promise<{ action: 'added' | 'merged' | 'conflict'; entry: MemoryEntry }>,
  updateUserMemory: (id: string, patch: { text?: string; tags?: string[]; kind?: MemoryKind }) => ipcRenderer.invoke('memory:update', id, patch) as Promise<MemoryEntry>,
  deleteUserMemory: (id: string) => ipcRenderer.invoke('memory:delete', id) as Promise<{ ok: boolean }>,
  clearUserMemory: (kind?: MemoryKind) => ipcRenderer.invoke('memory:clear', kind ?? null) as Promise<UserMemory>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
  saveSettings: (config: AppConfig & { apiKey?: string; clearApiKey?: boolean }) => ipcRenderer.invoke('settings:save', config),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  getTasks: () => ipcRenderer.invoke('tasks:list') as Promise<TaskRecord[]>,
  saveWorkspace: (workspace: Partial<WorkspaceState>) => ipcRenderer.invoke('workspace:save', workspace),
  clearChatHistory: () => ipcRenderer.invoke('chat:clear-history') as Promise<WorkspaceState>,
  addResourceRoot: (options: { recursive: boolean; access: 'read' | 'read-write' }) => ipcRenderer.invoke('scope:add-resource-root', options) as Promise<ResourceRoot | null>,
  getAudit: () => ipcRenderer.invoke('audit:get'),
  exportAudit: () => ipcRenderer.invoke('audit:export'),
  sendMessage: (messages: { role: 'user' | 'assistant'; content: string }[]) => ipcRenderer.invoke('agent:chat', messages),
  resumeTask: (taskId: string, messages: { role: 'user' | 'assistant'; content: string }[]) => ipcRenderer.invoke('agent:resume', taskId, messages),
  cancelAgent: () => ipcRenderer.invoke('agent:cancel'),
  pauseAgent: () => ipcRenderer.invoke('agent:pause'),
  getDesktopPaused: () => ipcRenderer.invoke('desktop:paused') as Promise<boolean>,
  setDesktopPaused: (paused: boolean) => ipcRenderer.invoke('desktop:set-paused', paused) as Promise<boolean>,
  getDesktopState: () => ipcRenderer.invoke('desktop:state') as Promise<{ ok: boolean; paused: boolean; state?: unknown; error?: string }>,
  invokeDesktop: (action: string, payload: Record<string, unknown>) => ipcRenderer.invoke('desktop:invoke', { action, payload }) as Promise<{ ok: boolean; result?: unknown; error?: string }>,
  applyProposal: (id: string) => ipcRenderer.invoke('proposal:apply', id),
  discardProposal: (id: string) => ipcRenderer.invoke('proposal:discard', id),
  undoLast: () => ipcRenderer.invoke('project:undo'),
  runCommand: (command: string) => ipcRenderer.invoke('terminal:manual', command),
  resolveApproval: (requestId: string, decision: ApprovalDecision) => ipcRenderer.invoke('terminal:approval', requestId, decision),
  cancelCommand: (requestId: string) => ipcRenderer.invoke('terminal:cancel', requestId),
  // ---- Dosya keşif motoru ----
  listFileScopes: () => ipcRenderer.invoke('files:scopes') as Promise<{ project: { value: string; label: string } | null; resources: Array<{ value: string; label: string; access: string }> }>,
  requestScope: (options: { path?: string; access?: string; reason?: string }) => ipcRenderer.invoke('scopes:request', options) as Promise<{ ok: boolean; scope?: string; path?: string; access?: string; error?: string; message?: string }>,
  runFileSearch: (requestText: string, scope: string) => ipcRenderer.invoke('files:search', requestText, scope),
  previewProjectFile: (targetPath: string) => ipcRenderer.invoke('files:preview', targetPath) as Promise<{ path: string; name: string; sizeBytes: number; modifiedAt: string; method: string; isBinary: boolean; notice: string | null; text: string }>,
  openFileLocation: (targetPath: string) => ipcRenderer.invoke('files:open-location', targetPath) as Promise<{ ok: boolean }>,
  refreshFileIndex: (scope: string) => ipcRenderer.invoke('files:index:refresh', scope),
  getFileIndexStatus: () => ipcRenderer.invoke('files:index:status') as Promise<{ scopes: Array<{ root: string; builtAt: string; entries: number }> }>,
  getFileSearchHistory: () => ipcRenderer.invoke('files:history:get') as Promise<{ queries: Array<{ text: string; scope: string; at: string; resultCount: number }> }>,
  clearFileSearchHistory: () => ipcRenderer.invoke('files:history:clear') as Promise<{ ok: boolean }>,
  // ---- Yazılım envanteri ve adaptörler ----
  getSoftwareCatalog: () => ipcRenderer.invoke('software:list') as Promise<{ catalog: { builtAt: string; entries: SoftwareCatalogEntry[] } }>,
  refreshSoftwareCatalog: () => ipcRenderer.invoke('software:refresh') as Promise<{ catalog: { builtAt: string; entries: SoftwareCatalogEntry[] } }>,
  testSoftwareEntry: (name: string) => ipcRenderer.invoke('software:test', name) as Promise<{ ok: boolean; output: string; executable: string | null }>,
  launchSoftwareEntry: (name: string) => ipcRenderer.invoke('software:launch', name) as Promise<{ ok: boolean; message: string }>,
  listAppAdapters: () => ipcRenderer.invoke('adapters:list') as Promise<{ adapters: AdapterSummary[] }>,
  testAppAdapter: (id: string) => ipcRenderer.invoke('adapters:test', id) as Promise<{ adapter: string; name: string; ok: boolean; output: string }>,
  checkCapability: (need: string) => ipcRenderer.invoke('capability:check', need) as Promise<CapabilityReportPayload>,
  // ---- Eklenti sistemi ----
  listPlugins: () => ipcRenderer.invoke('plugins:list') as Promise<{ plugins: PluginItem[]; rootDir: string }>,
  installPluginDirectory: () => ipcRenderer.invoke('plugins:install-dir') as Promise<PluginActionResult>,
  installPluginZip: () => ipcRenderer.invoke('plugins:install-zip') as Promise<PluginActionResult>,
  updatePluginDirectory: () => ipcRenderer.invoke('plugins:update-dir') as Promise<PluginActionResult>,
  enablePlugin: (id: string) => ipcRenderer.invoke('plugins:enable', id) as Promise<PluginStateEntry>,
  disablePlugin: (id: string) => ipcRenderer.invoke('plugins:disable', id) as Promise<PluginStateEntry>,
  rollbackPlugin: (id: string) => ipcRenderer.invoke('plugins:rollback', id) as Promise<PluginStateEntry>,
  uninstallPlugin: (id: string) => ipcRenderer.invoke('plugins:uninstall', id) as Promise<{ removed: boolean }>,
  invokePluginTool: (id: string, tool: string, args?: Record<string, unknown>) => ipcRenderer.invoke('plugins:invoke-tool', id, tool, args ?? {}),
  openPluginFolder: () => ipcRenderer.invoke('plugins:open-folder') as Promise<{ ok: boolean; message: string }>,
  onEvent: (callback: (event: AppEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppEvent) => callback(payload)
    ipcRenderer.on('app:event', listener)
    return () => ipcRenderer.removeListener('app:event', listener)
  },
}
contextBridge.exposeInMainWorld('kodAtolyesi', api)
