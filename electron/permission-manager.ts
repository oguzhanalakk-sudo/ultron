import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ApprovalDecision, ApprovalGrantScope, PermissionCategory, PermissionGrant, PermissionProfile, ResourceRoot } from './shared.ts'
import { canRunAutomatically, type CommandRisk } from './permissions.ts'
import { validateExternalUrl } from './web-research.ts'
import { toolRiskLevel, type ToolRisk } from './tool-catalog.ts'

export type PermissionContext = {
  profile: PermissionProfile
  grants: PermissionGrant[]
  projectPath: string
  taskId?: string
  category: PermissionCategory
  risk?: CommandRisk
  forceApproval?: boolean
}

const categories = new Set<PermissionCategory>(['development', 'package', 'system', 'system-script', 'network-scan', 'destructive', 'security-audit', 'file-rename', 'file-delete', 'screen-capture', 'input-control', 'app-launch', 'file-read', 'file-create', 'file-edit'])
const scopes = new Set<ApprovalGrantScope>(['operation', 'task', 'project', 'category'])
const pathKey = (value: string) => path.resolve(value).toLocaleLowerCase('en-US')
export function isBroadAccessEnabled(profile: PermissionProfile): boolean {
  return profile.allowBroadAccess === true && typeof profile.broadAccessConfirmedAt === 'string' && Number.isFinite(Date.parse(profile.broadAccessConfirmedAt))
}

export function sanitizeResourceRoots(value: unknown, projectPath: string): ResourceRoot[] {
  if (!Array.isArray(value)) return []
  const project = pathKey(projectPath)
  const seen = new Set([project])
  const seenIds = new Set<string>()
  const roots: ResourceRoot[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const root = item as Partial<ResourceRoot>
    if (typeof root.id !== 'string' || !root.id || typeof root.path !== 'string' || !path.isAbsolute(root.path)) continue
    if (root.access !== 'read' && root.access !== 'read-write') continue
    const resolved = path.resolve(root.path)
    const key = pathKey(resolved)
    const projectRelative = path.relative(path.resolve(projectPath), resolved)
    const insideProject = projectRelative === '' || (projectRelative !== '..' && !projectRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(projectRelative))
    if (seen.has(key) || seenIds.has(root.id) || insideProject || path.dirname(resolved) === resolved) continue
    seen.add(key)
    seenIds.add(root.id)
    roots.push({ id: root.id.slice(0, 100), path: resolved, recursive: root.recursive === true, access: root.access })
    if (roots.length >= 50) break
  }
  return roots
}

export function findResourceRoot(targetPath: string, projectPath: string, resourceRoots: ResourceRoot[]) {
  const target = path.resolve(targetPath)
  const roots: (ResourceRoot & { project: boolean })[] = [
    { id: 'project', path: path.resolve(projectPath), recursive: true, access: 'read-write', project: true },
    ...resourceRoots.map((root) => ({ ...root, project: false })),
  ]
  const matches = roots.flatMap((root) => {
    const relative = path.relative(root.path, target)
    const inside = relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    if (!inside) return []
    if (!root.recursive && relative && relative.split(path.sep).length > 1) return []
    return [{ root, relative }]
  }).sort((a, b) => b.root.path.length - a.root.path.length)
  return matches[0]
}

export function isApprovalScope(value: unknown): value is ApprovalGrantScope {
  return typeof value === 'string' && scopes.has(value as ApprovalGrantScope)
}

export function isValidApprovalDecision(value: unknown): value is ApprovalDecision {
  if (!value || typeof value !== 'object') return false
  const decision = value as Partial<ApprovalDecision>
  if (typeof decision.approved !== 'boolean' || typeof decision.remember !== 'boolean' || !isApprovalScope(decision.scope)) return false
  if (!decision.approved) return decision.scope === 'operation' && !decision.remember
  return decision.remember === (decision.scope !== 'operation')
}

export function canRememberCategory(category: PermissionCategory) {
  // Destructive terminal and disk operations do not map to a persistent grant.
  // App file deletion is moved to recoverable project trash and can be scoped.
  return category !== 'destructive' && category !== 'system-script' && category !== 'network-scan'
}

// Fare/klavye kontrolü yalnızca görev veya proje kapsamında hatırlanabilir;
// "tüm projeler" düzeyinde kalıcı fare/klavye izni verilmez.
const projectScopedOnlyCategories = new Set<PermissionCategory>(['input-control'])

export function isProjectScopedOnlyCategory(category: PermissionCategory): boolean {
  return projectScopedOnlyCategories.has(category)
}

export function sanitizePermissionGrants(value: unknown, projectPath: string): PermissionGrant[] {
  if (!Array.isArray(value)) return []
  const expectedProject = pathKey(projectPath)
  const result: PermissionGrant[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const grant = item as Partial<PermissionGrant>
    if (typeof grant.id !== 'string' || !grant.id || !['task', 'project', 'category'].includes(String(grant.scope))) continue
    if (typeof grant.category !== 'string' || !categories.has(grant.category as PermissionCategory)) continue
    if (!canRememberCategory(grant.category as PermissionCategory)) continue
    if (isProjectScopedOnlyCategory(grant.category as PermissionCategory) && grant.scope === 'category') continue
    const globalCategory = grant.scope === 'category' && grant.projectPath === '*'
    if (typeof grant.projectPath !== 'string' || (!globalCategory && pathKey(grant.projectPath) !== expectedProject)) continue
    if (grant.scope === 'task' && (typeof grant.taskId !== 'string' || !grant.taskId)) continue
    result.push({
      id: grant.id.slice(0, 100),
      scope: grant.scope as PermissionGrant['scope'],
      category: grant.category as PermissionGrant['category'],
      projectPath: globalCategory ? '*' : projectPath,
      ...(grant.scope === 'task' ? { taskId: String(grant.taskId).slice(0, 100) } : {}),
      createdAt: typeof grant.createdAt === 'string' ? grant.createdAt.slice(0, 40) : new Date(0).toISOString(),
      label: typeof grant.label === 'string' ? grant.label.slice(0, 160) : grant.category,
    })
    if (result.length >= 200) break
  }
  return result
}

export function findPermissionGrant(context: PermissionContext): PermissionGrant | undefined {
  if (!canRememberCategory(context.category)) return undefined
  const project = pathKey(context.projectPath)
  return context.grants.find((grant) => {
    if (grant.category !== context.category) return false
    if (grant.scope === 'category' && grant.projectPath === '*') return true
    if (pathKey(grant.projectPath) !== project) return false
    if (grant.scope === 'project' || grant.scope === 'category') return true
    return grant.scope === 'task' && Boolean(context.taskId) && grant.taskId === context.taskId
  })
}

export function canPerformAutomatically(context: PermissionContext): boolean {
  if (context.profile.mode === 'personal' && context.profile.commandMode === 'automatic') return true
  if (context.risk === 'destructive') return false
  if (findPermissionGrant(context)) return true
  if (context.forceApproval) return false
  if (!context.risk) return false
  return canRunAutomatically(context.profile, context.risk)
}

export type DeveloperToolPermission = {
  tool: string
  projectPath: string
  taskId?: string
  requiresApproval: boolean
  reason: string
  risk: ToolRisk
}

export function canExecuteDeveloperTool(profile: PermissionProfile, tool: string, projectPath: string, taskId?: string): { allowed: boolean; reason?: string } {
  void projectPath
  void taskId
  const risk = toolRiskLevel(tool)
  if (risk === 'critical') return { allowed: false, reason: 'Bu araç kritik riskli; kullanıcı onayı gerekir.' }
  if (profile.mode === 'controlled' && (risk === 'high' || risk === 'medium')) return { allowed: false, reason: `${risk === 'high' ? 'Yüksek' : 'Orta'} riskli araç için görev onayı gerekli.` }
  return { allowed: true, reason: profile.allowSystemChanges ? 'Sistem değişikliği profili etkin.' : 'Araç profili kapsamında izin verildi.' }
}

export function requiresApprovalForCommand(command: string): boolean {
  const unsafe = [
    /(^|\s)docker\s+run\b/i, /(^|\s)git\s+(?:push|commit)\b/i,
    /(^|\s)npm\s+install\b/i, /(^|\s)npm\s+run\s+build\b/i,
    /(^|\s)python\s+-m\s+pip\s+install\b/i, /(^|\s)chmod\b/i,
    /(^|\s)rm\b/i, /(^|\s)(?:curl|wget)\b.*\|\s*(?:bash|sh)\b/i,
  ]
  return unsafe.some((pattern) => pattern.test(String(command ?? '')))
}

export function describeRisk(command: string): string {
  const highRisk = ['git push', 'git commit', 'npm install', 'docker run', 'pip install', 'build', 'pytest', 'eslint', 'tsc']
  return highRisk.some((entry) => String(command ?? '').toLocaleLowerCase('en-US').includes(entry))
    ? 'Yüksek risk veya yan etkili işlem'
    : 'Düşük risk'
}

export function createPermissionGrant(args: {
  scope: Exclude<ApprovalGrantScope, 'operation'>
  category: PermissionCategory
  projectPath: string
  taskId?: string
  label: string
  id?: string
  createdAt?: string
}): PermissionGrant {
  if (!canRememberCategory(args.category)) throw new Error('Bu işlem sınıfı için kalıcı izin verilemez.')
  if (isProjectScopedOnlyCategory(args.category) && args.scope === 'category') throw new Error('Bu izin tüm projeler için verilemez; görev veya proje kapsamını kullan.')
  if (args.scope === 'task' && !args.taskId) throw new Error('Görev kapsamlı izin için etkin görev kimliği gerekli.')
  return {
    id: args.id ?? randomUUID(), scope: args.scope, category: args.category,
    projectPath: args.scope === 'category' ? '*' : path.resolve(args.projectPath), ...(args.scope === 'task' ? { taskId: args.taskId } : {}),
    createdAt: args.createdAt ?? new Date().toISOString(), label: args.label.slice(0, 160),
  }
}

export function grantScopeMatches(grant: PermissionGrant, context: Pick<PermissionContext, 'projectPath' | 'taskId' | 'category'>) {
  if (grant.category !== context.category) return false
  if (grant.scope === 'category' && grant.projectPath === '*') return true
  if (pathKey(grant.projectPath) !== pathKey(context.projectPath)) return false
  return grant.scope === 'project' || grant.scope === 'category' || (grant.scope === 'task' && Boolean(context.taskId) && grant.taskId === context.taskId)
}

/**
 * Dış URL erişimi için senkron politika kapısıdır. Gerçek kullanıcı onayı
 * `main.ts` içindeki merkezi askApproval akışıyla verilir; bu yardımcı kendi
 * kendine izin/grant üretmez.
 */
export function canAccessExternalUrl(
  url: string,
  profile: PermissionProfile,
  projectPath: string,
  taskId?: string,
): { allowed: boolean; reason?: string; grantId?: string } {
  if (isBroadAccessEnabled(profile)) {
    const safety = validateExternalUrl(url)
    return safety.allowed ? { allowed: true, reason: 'Açık erişim profili etkin; URL güvenlik filtresi yine uygulandı.' } : { allowed: false, reason: safety.reason }
  }
  void projectPath
  void taskId
  const safety = validateExternalUrl(url)
  if (!safety.allowed) return { allowed: false, reason: safety.reason }

  if (profile.mode === 'advanced' || profile.mode === 'personal') return { allowed: true }
  return { allowed: false, reason: 'Dış ağ erişimi için izin gerekiyor. Kullanıcıdan onay alınmalı.' }
}

/**
 * Uygulama başlatma politikası. `allowed: false` sonucu "mutlak red" değildir:
 * çağıran taraf merkezi onay akışını (askApproval) devreye alır.
 */
export function canLaunchApplication(profile: PermissionProfile, projectPath?: string, taskId?: string): { allowed: boolean; reason?: string } {
  void projectPath
  void taskId
  if (isBroadAccessEnabled(profile)) return { allowed: true, reason: 'Geniş erişim modu açık; uygulama başlatma etkin.' }
  if (profile.mode === 'controlled') return { allowed: false, reason: 'Uygulama başlatma için kullanıcı onayı gerekir.' }
  return { allowed: true }
}

/**
 * Proje dışı herhangi bir yola doğrudan erişim politikası.
 * `allowed: false` sonucu "mutlak red" değildir: çağıran taraf onay akışına yönlendirir.
 */
export function canReadOrWriteAnyPath(profile: PermissionProfile, projectPath?: string, taskId?: string): { allowed: boolean; reason?: string } {
  void projectPath
  void taskId
  if (isBroadAccessEnabled(profile)) return { allowed: true, reason: 'Geniş erişim modu açık; dosya erişimi etkin.' }
  return { allowed: false, reason: 'Dosya erişimi kısıtlı; izin gerekir.' }
}

/**
 * Approval UI göstermeyen katman dış ağ erişimini onaylayamaz. Çağıran taraf
 * bu sonucu merkezi askApproval akışına yönlendirmelidir.
 */
export function requestExternalUrlApproval(
  url: string,
  projectPath: string,
  taskId?: string,
): { approved: boolean; reason?: string } {
  void projectPath
  void taskId
  const safety = validateExternalUrl(url)
  if (!safety.allowed) return { approved: false, reason: safety.reason }
  return { approved: false, reason: 'Dış ağ erişimi için UI üzerinden kullanıcı onayı gerekiyor.' }
}

/** Masaüstü otomasyonu için profil kapısı; grant veya modal onayı üretmez. */
export function canUseDesktopAutomation(
  profile: PermissionProfile,
  category: PermissionCategory,
  projectPath?: string,
  taskId?: string,
): { allowed: boolean; reason?: string } {
  void projectPath
  void taskId
  if (isBroadAccessEnabled(profile)) return { allowed: true, reason: 'Geniş erişim modu açık; masaüstü otomasyonu etkin.' }
  if (profile.allowDesktopControl) return { allowed: true }
  if (category === 'system' || category === 'system-script' || category === 'screen-capture' || category === 'input-control' || category === 'app-launch') {
    return { allowed: false, reason: 'Masaüstü kontrolü ve ekran yakalama için açık onay gerekir.' }
  }
  return { allowed: false, reason: 'Masaüstü otomasyonu profil tarafından etkinleştirilmemiş.' }
}

/** Gerçek onay için merkezi UI akışını kullan; burada otomatik onay verme. */
export function requestDesktopAutomationApproval(
  category: PermissionCategory,
  projectPath: string,
  taskId?: string,
): { approved: boolean; reason?: string } {
  void category
  void projectPath
  void taskId
  return { approved: false, reason: 'Masaüstü otomasyonu için UI üzerinden kullanıcı onayı gerekiyor.' }
}
