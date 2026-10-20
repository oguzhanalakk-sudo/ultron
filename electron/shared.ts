export type TreeNode = { name: string; path: string; kind: 'file' | 'directory'; children?: TreeNode[] }
export type ProjectInfo = { name: string; path: string }
export type ModelProvider = 'ollama' | 'openai-compatible'
export type ModelStatus = { connected: boolean; models: string[]; selectedModel: string; provider: ModelProvider; baseUrl: string; note?: string }
export type LocalModelInfo = { name: string; sizeBytes: number; digest: string | null; modifiedAt: string | null; family: string | null; parameterSize: string | null; quantization: string | null }
export type LoadedLocalModel = { name: string; sizeBytes: number; sizeVramBytes: number; expiresAt: string | null }
export type LocalHardware = { os: string; architecture: string; cpu: string; cpuCores: number; memoryTotalBytes: number; memoryFreeBytes: number; gpu: string | null; gpuMemoryBytes: number | null; diskFreeBytes: number | null; diskTotalBytes: number | null; detectedAt: string }
export type LocalModelFit = { level: 'gpu' | 'partial' | 'cpu' | 'too-large' | 'unknown'; label: string; detail: string; requiredBytes: number }
export type LocalRecommendation = { name: string; reason: string; sizeHint: string }
export type LocalModelEntry = LocalModelInfo & { fit: LocalModelFit; loaded: boolean }
export type LocalAiStats = { requests: number; failedRequests: number; lastDurationMs: number | null; lastTokensPerSecond: number | null; lastEvaluatedTokens: number | null; lastPromptTokens: number | null; lastMeasuredAt: string | null; totalEvaluatedTokens: number }
export type LocalAIStatus = {
  connected: boolean
  provider: 'ollama'
  baseUrl: string
  version: string | null
  selectedModel: string
  models: LocalModelEntry[]
  loadedModels: LoadedLocalModel[]
  hardware: LocalHardware
  recommendations: LocalRecommendation[]
  stats: LocalAiStats
  diskUsageBytes: number
  note?: string
}
export type LocalPullProgress = { model: string; status: string; completedBytes: number | null; totalBytes: number | null; percent: number | null; done: boolean; error?: string }
export type LocalModelActionResult = { ok: boolean; message: string; durationMs?: number | null; response?: string }
export type Proposal = { id: string; path: string; description: string; oldContent: string; newContent: string; existed: boolean; createdAt: string; applied?: boolean }
export type PermissionProfile = {
  mode: 'controlled' | 'advanced' | 'personal'
  editMode: 'review' | 'automatic'
  commandMode: 'confirm' | 'automatic'
  allowPackageInstalls: boolean
  allowSystemChanges: boolean
  /** Masaüstü kontrolü (fare/klavye/ekran) varsayılan olarak kapalıdır; kullanıcı açıkça açar. */
  allowDesktopControl: boolean
}
export type PermissionCategory = 'development' | 'package' | 'system' | 'system-script' | 'network-scan' | 'destructive' | 'security-audit' | 'file-rename' | 'file-delete' | 'screen-capture' | 'input-control' | 'app-launch' | 'file-read' | 'file-create' | 'file-edit'
export type ApprovalGrantScope = 'operation' | 'task' | 'project' | 'category'
export type PermissionGrant = {
  id: string
  scope: Exclude<ApprovalGrantScope, 'operation'>
  category: PermissionCategory
  projectPath: string
  taskId?: string
  createdAt: string
  label: string
}
export type ResourceRoot = { id: string; path: string; recursive: boolean; access: 'read' | 'read-write' }
export type ApprovalDecision = { approved: boolean; scope: ApprovalGrantScope; remember: boolean }
export type ProjectMemory = {
  summary: string
  architecture: string
  technologies: string[]
  commands: string[]
  preferences: string[]
  knownIssues: string[]
  updatedAt: string | null
}
export type MemoryKind = 'preference' | 'knowledge' | 'feedback' | 'conversation'
export type MemoryEntry = {
  id: string
  kind: MemoryKind
  text: string
  tags: string[]
  projectPath: string | null
  source: 'user' | 'agent' | 'feedback'
  createdAt: string
  updatedAt: string
  conflictWith?: string | null
}
export type UserMemory = { version: 1; entries: MemoryEntry[] }
export type VoiceToolCheck = { id: string; label: string; state: 'available' | 'missing'; path: string | null; note: string }
export type VoiceStatus = { available: boolean; speechToText: VoiceToolCheck[]; textToSpeech: VoiceToolCheck[]; note: string }
export type TaskStep = { title: string; status: 'pending' | 'in_progress' | 'done' | 'blocked' }
export type TaskPlan = { id: string; title: string; objective: string; status: 'active' | 'blocked' | 'complete'; steps: TaskStep[]; tests: string[]; updatedAt: string }
export type AgentStage = 'analyzing' | 'planning' | 'awaiting_approval' | 'executing' | 'evaluating' | 'correcting' | 'testing' | 'finalizing' | 'paused' | 'interrupted' | 'blocked' | 'completed' | 'failed' | 'cancelled'
export type AgentErrorCategory = 'syntax' | 'build' | 'runtime' | 'dependency' | 'configuration' | 'permission' | 'filesystem' | 'network' | 'test' | 'resources' | 'unknown'
export type AgentErrorAnalysis = { category: AgentErrorCategory; message: string; stage: AgentStage; tool?: string; exitCode?: number; retryable: boolean; nextAction: string }
export type VerificationFailure = { key: string; tool: string; analysis: AgentErrorAnalysis; status?: 'failed' | 'stale' }
export type VerificationReceipt = { key: string; tool: string; checkedAt: string; fingerprint: string; commandKey?: string; kind?: 'test' | 'build' | 'runtime' | 'command' | 'configuration' }
export type TaskRecord = {
  id: string; projectPath: string; request: string; title: string; objective: string
  plan: string[]; completedSteps: string[]; pendingSteps: string[]; usedTools: string[]
  acceptanceTests?: string[]; completedStepIds?: string[]
  events: { at: string; type: 'tool' | 'approval' | 'result' | 'error'; name: string; status?: string; detail?: string }[]
  errors: string[]; status: 'running' | 'waiting_approval' | 'interrupted' | 'paused' | 'blocked' | 'needs_review' | 'completed' | 'failed' | 'cancelled'
  stage: AgentStage; currentTool?: string; toolCalls: number; correctionAttempts: number; errorAnalysis?: AgentErrorAnalysis
  verificationFailures?: VerificationFailure[]
  verificationResults?: VerificationReceipt[]
  verificationRequired?: boolean
  createdAt: string; updatedAt: string
}
export type WorkspaceState = {
  permissions: PermissionProfile
  permissionGrants: PermissionGrant[]
  resourceRoots: ResourceRoot[]
  memory: ProjectMemory
  task: TaskPlan | null
  messages: ChatMessage[]
  lastBuild: BuildRecord | null
}
export type AndroidCheckState = 'available' | 'missing' | 'not-configured' | 'error'
export type AndroidEnvironmentCheck = { id: string; label: string; state: AndroidCheckState; path: string | null; version: string | null; required: boolean; detail?: string }
export type AndroidEnvironment = { os: string; sdkPath: string; sdkAvailable: boolean; installedPlatforms: string[]; installedBuildTools: string[]; licensesPresent: boolean; checks: AndroidEnvironmentCheck[]; recommendations: string[] }
export type AndroidDevice = { serial: string; state: string; details: string }
export type AndroidBuildArtifact = { path: string; format: 'apk' | 'aab'; size: number; modifiedAt: string; validZip: boolean; packageName?: string }
export type AndroidBuildRecord = { task: string; buildType: 'debug' | 'release' | 'test' | 'bundle' | 'other'; startedAt: string; durationMs: number; projectName: string; artifacts: AndroidBuildArtifact[]; failure?: { category: string; summary: string; evidence: string[]; retryable: boolean; suggestedAction: string }; testStatus: 'not_run' | 'passed' | 'failed' | 'cancelled' }
export type WindowsToolCheck = { id: string; label: string; state: AndroidCheckState; path: string | null; version: string | null; detail?: string }
export type WindowsEnvironment = { os: string; architecture: string; cpu: string; cpuCores: number; memoryTotalBytes: number; memoryFreeBytes: number; checks: WindowsToolCheck[]; pythonEnvironments: string[]; visualStudioPath: string | null; recommendations: string[] }
export type WindowsDesktopArtifact = { path: string; kind: 'application' | 'installer'; size: number; modifiedAt: string; valid: boolean }
export type WindowsDesktopBuild = { action: string; technology: string; startedAt: string; durationMs: number; projectPath: string; commands: string[]; artifacts: WindowsDesktopArtifact[]; testStatus: 'not_run' | 'passed' | 'failed' | 'cancelled'; failure?: { category: string; summary: string; evidence: string[]; retryable: boolean; suggestedAction: string }; notes: string[] }
export type BuildRecord = { command: string; exitCode: number | null; output: string; completedAt: string; artifacts: { path: string; size: number }[]; android?: AndroidBuildRecord; windows?: WindowsDesktopBuild }
export type WebProjectAnalysis = { filesScanned: number; frontend: string[]; backend: string[]; databases: string[]; dataAccess: string[]; packageManagers: string[]; tests: string[]; apiFiles: string[]; migrationFiles: string[]; hasAuthSignals: boolean; hasEnvironmentExample: boolean; hasDockerConfig: boolean; packageScripts: Record<string, string>; recommendations: string[] }
export type ApprovalRequest = { requestId: string; kind: 'command' | 'delete' | 'system'; category: PermissionCategory; risk: 'low' | 'medium' | 'high'; command: string; reason: string; authority: string; allowRemember: boolean; taskId?: string; affectedPaths?: string[]; workingDirectory?: string; rollback: string; verification: string }
export type ActivityItem = { id: string; kind: 'tool' | 'command' | 'status' | 'error' | 'success'; title: string; detail?: string; time: string; taskId?: string; tool?: string; operation?: string; target?: string; approvalOutcome?: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'automatic' | 'not_required'; result?: 'success' | 'failed' | 'cancelled' | 'denied'; error?: string; changedPaths?: string[]; exitCode?: number | null }
export type AppEvent =
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'activity'; item: ActivityItem }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'approval-resolved'; requestId: string }
  | { type: 'command-output'; requestId: string; text: string }
  | { type: 'task'; task: TaskPlan | null }
  | { type: 'task-history'; tasks: TaskRecord[] }
  | { type: 'command-status'; requestId: string; status: 'running' | 'finished' | 'cancelled' | 'timed-out'; exitCode?: number | null }
  | { type: 'memory'; memory: ProjectMemory }
  | { type: 'user-memory'; memory: UserMemory }
  | { type: 'workspace'; workspace: WorkspaceState }
  | { type: 'build-result'; result: BuildRecord }
  | { type: 'files-changed'; paths: string[] }
  | { type: 'done'; message: string; status: 'completed' | 'needs_review' | 'failed' | 'cancelled' | 'paused' | 'blocked' }
  | { type: 'localai-pull'; progress: LocalPullProgress }
  | { type: 'localai-status'; status: LocalAIStatus }
  | { type: 'error'; message: string }
export type ChatMessage = { role: 'user' | 'assistant'; content: string }
export type UserProfile = { name: string; instructions: string; autoLearn: boolean }
export type AppConfig = { provider: ModelProvider; baseUrl: string; model: string; profile: UserProfile }
export type AppSettings = AppConfig & { apiKeyConfigured: boolean }

export const defaultPermissions: PermissionProfile = {
  mode: 'controlled',
  editMode: 'review',
  commandMode: 'confirm',
  allowPackageInstalls: false,
  allowSystemChanges: false,
  allowDesktopControl: false,
}
export const emptyMemory: ProjectMemory = {
  summary: '', architecture: '', technologies: [], commands: [], preferences: [], knownIssues: [], updatedAt: null,
}
export const emptyUserProfile: UserProfile = { name: '', instructions: '', autoLearn: false }
export const emptyUserMemory: UserMemory = { version: 1, entries: [] }
