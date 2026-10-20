/// <reference types="vite/client" />
import type { AppEvent, AppConfig, AppSettings, ApprovalDecision, LocalAIStatus, LocalModelActionResult, ProjectInfo, ResourceRoot, TreeNode, ModelStatus, WorkspaceState, ActivityItem, TaskRecord, WebProjectAnalysis, WindowsEnvironment } from '../electron/shared'
import type { AndroidDevice, AndroidEnvironment } from '../electron/shared'
import type { MemoryEntry, MemoryKind, UserMemory, VoiceStatus } from '../electron/shared'
import type { AndroidProjectAnalysis } from '../electron/android-build-tool'
import type { WindowsProjectAnalysis } from '../electron/windows-build-tool'
import type { ValidationFailureAnalysis, ValidationPlan, ValidationResult } from '../electron/validation-engine'

declare global { interface Window { __smokeEvents?: AppEvent[] } }
declare global {
  interface Window {
    kodAtolyesi: {
      getProject(): Promise<ProjectInfo | null>
      openProject(): Promise<ProjectInfo | null>
      getTree(): Promise<TreeNode[]>
      readFile(path: string): Promise<string>
      getAndroidEnvironment(): Promise<AndroidEnvironment>
      getAndroidDevices(): Promise<AndroidDevice[]>
      analyzeAndroidProject(): Promise<AndroidProjectAnalysis>
      analyzeWebProject(): Promise<WebProjectAnalysis>
      researchSearch(query: string, limit?: number, language?: string): Promise<{ hits: Array<{ title: string; url: string; snippet: string; provider: string; publishedAt: string | null; rank: number }>; note: string | null }>
      researchFetch(url: string): Promise<{ title: string; text: string; url: string }>
      researchPermissionCheck(url: string): Promise<{ allowed: boolean; reason?: string; grantId?: string }>
      requestDesktopApproval(category: string, projectPath: string, taskId?: string): Promise<{ approved: boolean; reason?: string }>
      getWindowsEnvironment(): Promise<WindowsEnvironment>
      analyzeWindowsProject(projectPath?: string): Promise<{ projectPath: string; analysis: WindowsProjectAnalysis }>
      getStatus(): Promise<ModelStatus>
      getLocalAIStatus(): Promise<LocalAIStatus>
      pullLocalModel(model: string): Promise<LocalAIStatus>
      deleteLocalModel(model: string): Promise<LocalAIStatus>
      loadLocalModel(model: string): Promise<LocalModelActionResult>
      unloadLocalModel(model: string): Promise<LocalModelActionResult>
      testLocalModel(model: string): Promise<LocalModelActionResult>
      getVoiceStatus(): Promise<VoiceStatus>
      getUserMemory(): Promise<UserMemory>
      addUserMemory(payload: { kind: MemoryKind; text: string; tags?: string[] }): Promise<{ action: 'added' | 'merged' | 'conflict'; entry: MemoryEntry }>
      updateUserMemory(id: string, patch: { text?: string; tags?: string[]; kind?: MemoryKind }): Promise<MemoryEntry>
      deleteUserMemory(id: string): Promise<{ ok: boolean }>
      clearUserMemory(kind?: MemoryKind): Promise<UserMemory>
      getSettings(): Promise<AppSettings>
      saveSettings(config: AppConfig & { apiKey?: string; clearApiKey?: boolean }): Promise<ModelStatus>
      getWorkspace(): Promise<WorkspaceState>
      getTasks(): Promise<TaskRecord[]>
      saveWorkspace(workspace: Partial<WorkspaceState>): Promise<WorkspaceState>
      clearChatHistory(): Promise<WorkspaceState>
      addResourceRoot(options: { recursive: boolean; access: 'read' | 'read-write' }): Promise<ResourceRoot | null>
      getAudit(): Promise<ActivityItem[]>
      exportAudit(): Promise<string | null>
      sendMessage(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<void>
      resumeTask(taskId: string, messages: { role: 'user' | 'assistant'; content: string }[]): Promise<void>
      cancelAgent(): Promise<{ ok: boolean; message: string }>
      pauseAgent(): Promise<{ ok: boolean; message: string }>
      runValidation(plan: ValidationPlan): Promise<ValidationResult[]>
      analyzeValidationFailure(output: string): Promise<ValidationFailureAnalysis>
      getDesktopPaused(): Promise<boolean>
      setDesktopPaused(paused: boolean): Promise<boolean>
      getDesktopState(): Promise<{ ok: boolean; paused: boolean; state?: unknown; error?: string }>
      invokeDesktop(action: string, payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }>
      applyProposal(id: string): Promise<{ ok: boolean; message: string }>
      discardProposal(id: string): Promise<void>
      undoLast(): Promise<{ ok: boolean; message: string }>
      runCommand(command: string): Promise<{ requestId: string }>
      resolveApproval(requestId: string, decision: ApprovalDecision): Promise<void>
      cancelCommand(requestId: string): Promise<{ ok: boolean; message: string }>
      // ---- Dosya keşif motoru ----
      listFileScopes(): Promise<{ project: { value: string; label: string } | null; resources: Array<{ value: string; label: string; access: string }> }>
      requestScope(options: { path?: string; access?: string; reason?: string }): Promise<{ ok: boolean; scope?: string; path?: string; access?: string; error?: string; message?: string }>
      runFileSearch(requestText: string, scope: string): Promise<FileSearchOutcome>
      previewProjectFile(targetPath: string): Promise<FilePreviewResult>
      openFileLocation(targetPath: string): Promise<{ ok: boolean }>
      refreshFileIndex(scope: string): Promise<FileIndexRefreshResult>
      getFileIndexStatus(): Promise<{ scopes: Array<{ root: string; builtAt: string; entries: number }> }>
      getFileSearchHistory(): Promise<{ queries: Array<{ text: string; scope: string; at: string; resultCount: number }> }>
      clearFileSearchHistory(): Promise<{ ok: boolean }>
      // ---- Yazılım envanteri ve adaptörler ----
      getSoftwareCatalog(): Promise<{ catalog: { builtAt: string; entries: SoftwareEntry[] } }>
      refreshSoftwareCatalog(): Promise<{ catalog: { builtAt: string; entries: SoftwareEntry[] } }>
      testSoftwareEntry(name: string): Promise<{ ok: boolean; output: string; executable: string | null }>
      launchSoftwareEntry(name: string): Promise<{ ok: boolean; message: string }>
      listAppAdapters(): Promise<{ adapters: AdapterSummary[] }>
      testAppAdapter(id: string): Promise<{ adapter: string; name: string; ok: boolean; output: string }>
      checkCapability(need: string): Promise<CapabilityReportPayload>
      // ---- Eklenti sistemi ----
      listPlugins(): Promise<{ plugins: PluginItem[]; rootDir: string }>
      installPluginDirectory(): Promise<PluginActionResult>
      installPluginZip(): Promise<PluginActionResult>
      updatePluginDirectory(): Promise<PluginActionResult>
      enablePlugin(id: string): Promise<PluginStateEntry>
      disablePlugin(id: string): Promise<PluginStateEntry>
      rollbackPlugin(id: string): Promise<PluginStateEntry>
      uninstallPlugin(id: string): Promise<{ removed: boolean }>
      invokePluginTool(id: string, tool: string, args?: Record<string, unknown>): Promise<{ ok: boolean; plugin: string; tool: string; result: unknown }>
      openPluginFolder(): Promise<{ ok: boolean; message: string }>
      onEvent(callback: (event: AppEvent) => void): () => void
    }
  }
}

type SoftwareEntry = {
  name: string
  version: string | null
  publisher: string | null
  installLocation: string | null
  executablePath: string | null
  source: 'registry' | 'path' | 'start-menu'
  categories: string[]
  capabilities: string[]
}
type AdapterSummary = {
  id: string
  name: string
  executable: string
  actions: Array<{ id: string; description: string; risk: string; needsProject: boolean }>
}
type PluginStateEntryLike = {
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
}
type PluginItem = PluginStateEntryLike & {
  manifestValid: boolean
  tools: Array<{ name: string; description: string }>
  description?: string
}
type PluginActionResult =
  | { canceled: true }
  | { canceled: false; id: string; version: string; entry: PluginStateEntryLike }
type FileSearchOutcome = {
  scope: { root: string; label: string; scopeId: string }
  query: { raw: string; nameTerms: string[]; contentTerms: string[]; extensions: string[]; kinds: string[]; modifiedWithin: string | null; sizeFilter: string | null; limit: number }
  hits: Array<{ name: string; path: string; relativePath: string; extension: string; sizeBytes: number; modifiedAt: string; kind: string; matchType: string; snippets: string[]; extractNotice: string | null }>
  summary: string
  truncated: boolean
  visitedFiles: number
  visitedDirs: number
  permissionDenied: number
  errors: string[]
  durationMs: number
  notices: string[]
}
type FilePreviewResult = {
  path: string
  name: string
  sizeBytes: number
  modifiedAt: string
  method: string
  isBinary: boolean
  notice: string | null
  text: string
}
type FileIndexRefreshResult = {
  scope: { root: string; label: string }
  entries: number
  delta: { added: number; changed: number; removed: number }
  builtAt: string
}
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
export {}
