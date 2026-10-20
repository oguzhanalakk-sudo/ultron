/**
 * Built-in tool selection is intentionally kept separate from the Electron
 * process.  This makes the model-visible capability policy testable without
 * starting the desktop application.
 */
export type AgentToolLike = { function: { name: string } }

export const builtInToolExecutorNames = [
  'open_file', 'open_url', 'list_files', 'read_file', 'search_code', 'search_files', 'write_file', 'apply_patch', 'create_directory', 'rename_path', 'propose_file_edit', 'delete_file', 'run_command', 'run_powershell', 'run_tests', 'inspect_errors', 'analyze_logs', 'get_environment', 'windows_environment', 'analyze_windows_project', 'create_windows_desktop_project', 'windows_build', 'android_environment', 'create_android_project', 'analyze_android_project', 'android_devices', 'security_audit', 'network_inventory', 'build_android', 'get_build_result', 'find_files', 'search_file_contents', 'find_duplicate_files', 'file_index_refresh', 'software_inventory', 'run_app_action', 'check_capabilities', 'git_status', 'git_diff', 'git_log', 'git_branch', 'git_commit', 'git_revert_commit', 'git_push_branch', 'github_status', 'github_repos', 'github_repo', 'github_read_file', 'github_issues', 'github_pull_requests', 'github_create_issue', 'github_create_pull_request', 'undo_change', 'update_project_memory', 'set_task_plan', 'update_task_step', 'project_info', 'find_android_apks', 'find_android_artifacts', 'create_web_project', 'analyze_web_project', 'web_http_check', 'web_search', 'fetch_web_page', 'solution_memory', 'language_knowledge', 'project_scaffold', 'list_project_templates', 'web_start_service', 'web_stop_service', 'web_database', 'android_install', 'android_launch', 'desktop_state', 'desktop_screenshot', 'desktop_ui_elements', 'desktop_mouse_move', 'desktop_mouse_click', 'desktop_type_text', 'desktop_press_keys', 'desktop_list_windows', 'desktop_focus_window', 'desktop_close_window', 'desktop_launch_app', 'desktop_open_explorer', 'desktop_process_list', 'desktop_process_start', 'desktop_process_kill', 'desktop_app_logs', 'desktop_open_file_default', 'desktop_preflight', 'desktop_text_task', 'desktop_click_element', 'open_application', 'list_scopes', 'request_scope', 'web_research', 'web_follow_link', 'web_download',
] as const

// Dış araç kayıtlarının kullandığı adla geriye dönük uyumluluk.
// Gerçek yürütücü listesi tek kaynak olarak builtInToolExecutorNames'tir.
export const builtInToolExecutors = builtInToolExecutorNames

export type ToolCapability = 'android' | 'web' | 'windows' | 'research' | 'network' | 'rename' | 'delete' | 'powershell' | 'logs' | 'file-discovery' | 'duplicate-discovery' | 'file-index' | 'software-inventory' | 'app-adapter' | 'capability-check' | 'project-scaffold' | 'desktop'

export const toolsByCapability: Partial<Record<ToolCapability, readonly string[]>> = {
  android: ['create_android_project', 'android_environment', 'analyze_android_project', 'android_devices', 'build_android', 'android_install', 'android_launch', 'find_android_artifacts', 'find_android_apks'],
  web: ['create_web_project', 'analyze_web_project', 'web_http_check', 'web_start_service', 'web_stop_service', 'web_database'],
  windows: ['windows_environment', 'analyze_windows_project', 'create_windows_desktop_project', 'windows_build'],
  research: ['web_search', 'web_research', 'web_follow_link', 'web_download', 'fetch_web_page', 'solution_memory', 'language_knowledge'],
  network: ['network_inventory'], rename: ['rename_path'], delete: ['delete_file'], powershell: ['run_powershell'], logs: ['analyze_logs'],
  'file-discovery': ['find_files', 'search_file_contents'], 'duplicate-discovery': ['find_duplicate_files'], 'file-index': ['file_index_refresh'],
  'software-inventory': ['software_inventory'], 'app-adapter': ['run_app_action'], 'capability-check': ['check_capabilities'],
  'project-scaffold': ['project_scaffold', 'list_project_templates'],
  desktop: [
    'desktop_state', 'desktop_screenshot', 'desktop_ui_elements', 'desktop_mouse_move', 'desktop_mouse_click',
    'desktop_type_text', 'desktop_press_keys', 'desktop_list_windows', 'desktop_focus_window', 'desktop_close_window',
    'desktop_launch_app', 'desktop_open_explorer', 'desktop_process_list', 'desktop_process_start', 'desktop_process_kill', 'desktop_app_logs', 'desktop_open_file_default', 'desktop_preflight', 'desktop_text_task', 'desktop_click_element',
  ],
}

const matches = (pattern: RegExp, text: string) => pattern.test(text)

/** Maps a task's meaning to capabilities. Keywords remain compatibility hints,
 * while visibility itself is driven by this explicit capability registry. */
export function taskCapabilitiesForRequest(request: string): Set<ToolCapability> {
  const text = request.toLocaleLowerCase('tr-TR')
  const capabilities = new Set<ToolCapability>()
  if (matches(/android|\bapk\b|\baab\b|gradle|emülatör|emulator|adb|mobil|mobile|\bvpn\b/, text)) capabilities.add('android')
  if (matches(/\bweb\b|\bwebsite\b|\bsite\b|\bapi\b|rest|backend|back-end|frontend|front-end|veritabanı|database|sql|html|css|javascript|typescript|react|next\.js|vue|vite|express|fastapi|django|flask|asp\.net|web uygulaması/i, text)) capabilities.add('web')
  if (matches(/windows|masaüstü|desktop|winforms|winui|\bwpf\b|pyside|pyqt|tkinter|pyinstaller|electron|tauri|cmake|inno setup|\bexe\b|kurulum paketi/i, text)) capabilities.add('windows')
  if (matches(/ağ envanter|network inventory|cidr|tcp port|port tara/i, text)) capabilities.add('network')
  if (matches(/yeniden adlandır|dosya adını değiştir|rename|move file|taşı.*dosya/i, text)) capabilities.add('rename')
  if (matches(/sil|kaldır|delete|remove file/i, text)) capabilities.add('delete')
  if (matches(/powershell|registry|regedit|windows service|windows hizmet/i, text)) capabilities.add('powershell')
  if (matches(/log analizi|log dosya|logları|günlüğü|günlük.*(ara|analiz|incele)|analyze logs|log file/i, text)) capabilities.add('logs')
  if (matches(/dosya|dizin|klasör|pdf|excel|word|docx|xlsx|ppt|resim|fotoğraf|video|müzik|arşiv|zip|indeks|dupe|kopya|yinelen/i, text)) capabilities.add('file-discovery')
  if (matches(/kopya|yinelen|duplicate|ayn(?:ı|i)\s*içerik/i, text)) capabilities.add('duplicate-discovery')
  if (matches(/indeks/i, text)) capabilities.add('file-index')
  const software = matches(/y[üu]kl[üu]|kurulu|program(lar)?|yaz[ıi]l[ıi]m(lar)?|uygulama(lar)?(ında|da)?|adapt[öo]r|s[üu]r[üu]m|versiyon|hangi edit[öo]r|kod edit[öo]r|ba[şs]lat/i, text)
  if (software) capabilities.add('software-inventory')
  if (matches(/eksik|yetenek|gerekli program|capability|nas[ıi]l a[çc]ar[ıi]m|hangi program/i, text) || software) capabilities.add('capability-check')
  if (matches(/adapt[öo]r|git |npm |pip |pytest|ollama |docker |vs ?code|dotnet|gradle/i, text)) capabilities.add('app-adapter')
  if (matches(/ara[şs]t[ıi]r|internet(?:ten|te)|web aramas?|güncel|nas[ıi]l [çc][öo]z(?:[üu]l[üu]r|erim)?|neden(?:\s+\p{L}+){0,4}\s?çal[ıi][şs]m[ıi]?yor|hatan?[ıi]n?\s+nedeni|stackoverflow|microsoft (?:learn|docs)|github (?:issue|repo|depo|hatt[ıi])|s[üu]r[üu]m notu|uyumluluk|dok[üu]mantasyon|teknik makale|hata .*(?:ara|bul|ç[öo]z)|ç[öo]z[üu]m(?:[üu])?\s+(?:ara|bul)|daha önce (?:ç[öo]z|oldu|kar[şs][ıi]la)|ge[çc]mi[şs] (?:eski|ç[öo]z|kayıt)|hat[ıi]rl(?:[ıi]yor|a)/iu, text)) capabilities.add('research')
  if (matches(/şablon|template|iskelet|scaffold|proje.*(?:oluştur|başlat)|(?:oluştur|başlat).*proje/i, text)) capabilities.add('project-scaffold')
  // Masaüstü otomasyonu: fare, klavye, ekran, pencere, uygulama başlatma.
  if (matches(/masaüstü|masaustu|desktop|\bfare\b|mouse|tıkla|tikla|çift tık|klavye|keyboard|ekran|ekran görüntüsü|screenshot|pencere|window|not defteri|notepad|dosya gezgini|file explorer|görev çubuğu|başlat menüsü|start menüsü|süreç|process|uygulama log|varsayılan uygulama|default app/i, text)) capabilities.add('desktop')
  return capabilities
}

export function selectToolsForTask<T extends AgentToolLike>(tools: T[], request: string, options: { desktopEnabled?: boolean } = {}): T[] {
  const capabilities = taskCapabilitiesForRequest(request)
  // Web araştırma araçları (web_search, fetch_web_page, solution_memory, language_knowledge)
  // salt okunur ve SSRF korumalıdır; bu yüzden istek anahtar kelimesine bağlı olarak
  // GİZLENMEZLER. Anahtar kelimeyle eşleşmeyen bir istekte modele hiç görünmeleri,
  // ajanın "web erişimim yok" demesine yol açıyordu.
  capabilities.add('research')
  // Masaüstü kontrolü kullanıcı tarafından açılmadıysa o araçlar modele hiç gösterilmez.
  if (options.desktopEnabled === false) capabilities.delete('desktop')
  return tools.filter((tool) => {
    for (const [capability, names] of Object.entries(toolsByCapability) as Array<[ToolCapability, readonly string[]]>) {
      if (names.includes(tool.function.name) && !capabilities.has(capability)) return false
    }
    return true
  })
}
