// Ultron Masaüstü Kontrolü: fare, klavye, pencere, ekran görüntüsü ve UI öğesi tespiti.
//
// Tasarım kararı: Yeni npm bağımlılığı EKLENMEZ. Windows'un kendi PowerShell'i ve
// .NET Framework (System.Windows.Forms, System.Drawing, UIAutomationClient) kullanılır;
// Win32 çağrıları C# P/Invoke olarak PowerShell içine gömülür. Böylece kurulum
// ekranı görüntüsü / fare / klavye gerçekten uygulanabilir ve paketlenmiş uygulamada
// da çalışır (electron-builder yalnızca out/** ve package.json paketler; betik
// çalışma anında userData altına yazılır).
//
// Güvenlik: betik, -SelfProcessId/-SelfProcessNames ile "kendi penceresine müdahale
// etmeyi" reddeder; böylece Ultron'un arayüzü yanlışlıkla kilitlenemez.
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export type DesktopActionKind =
  | 'state'
  | 'screenshot'
  | 'preflight'
  | 'text_task'
  | 'click_element'
  | 'mouse_move'
  | 'mouse_click'
  | 'keyboard_type'
  | 'keyboard_keys'
  | 'window_list'
  | 'window_focus'
  | 'window_close'
  | 'ui_elements'
  | 'launch_app'
  | 'open_explorer'
  | 'process_list'
  | 'process_start'
  | 'process_kill'
  | 'app_logs'
  | 'open_file_default'

export type DesktopWindowInfo = {
  handle: string
  title: string
  process: string
  pid: number
  visible: boolean
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }
  focused: boolean
}

export type DesktopElementInfo = {
  name: string
  type: string
  automationId: string
  enabled: boolean
  offscreen: boolean
  value: string
  rect: { left: number; top: number; right: number; bottom: number }
}

export type DesktopState = {
  screen: { width: number; height: number }
  cursor: { x: number; y: number }
  focusedWindow: DesktopWindowInfo | null
  windows: DesktopWindowInfo[]
  elementAtCursor: DesktopElementInfo | null
  screenshotPath: string | null
  selfProtected: boolean
  note: string | null
}

export type DesktopActionRequest = {
  action: DesktopActionKind
  payload: Record<string, unknown>
}

/** Fare/klavye işlemleri hedef pencereyi doğrulamayı gerektirir. */
export const DESKTOP_INPUT_ACTIONS = new Set<DesktopActionKind>(['mouse_move', 'mouse_click', 'keyboard_type', 'keyboard_keys'])
export const DESKTOP_READ_ACTIONS = new Set<DesktopActionKind>(['state', 'screenshot', 'window_list', 'ui_elements', 'process_list', 'app_logs'])

/** Klavye kombinasyonu sözlüğü: ad → sanal tuş kodu. */
export const VIRTUAL_KEYS: Record<string, number> = {
  ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5b, meta: 0x5b, windows: 0x5b,
  enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, space: 0x20, backspace: 0x08, delete: 0x2e,
  insert: 0x2d, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75, f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7a, f12: 0x7b,
}

const MAX_TEXT_LENGTH = 4000
const MAX_KEY_LENGTH = 120
const MAX_TITLE_LENGTH = 200

export function parseKeyChord(input: string): { modifiers: string[]; key: string } {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('Tuş kombinasyonu boş.')
  if (raw.length > MAX_KEY_LENGTH) throw new Error('Tuş kombinasyonu çok uzun.')
  const parts = raw.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean)
  if (!parts.length) throw new Error('Tuş kombinasyonu boş.')
  const modifiers: string[] = []
  let key = ''
  for (const part of parts) {
    if (['ctrl', 'control', 'alt', 'shift', 'win', 'meta', 'windows'].includes(part)) {
      if (!modifiers.includes(part)) modifiers.push(part)
      continue
    }
    if (key) throw new Error('Tek seferde yalnızca bir tuş kullanılabilir.')
    key = part
  }
  if (!key) throw new Error('Kombinasyonun basılacak tuşu belirtilmemiş.')
  return { modifiers, key }
}

export function resolveVirtualKey(key: string): number {
  const normalized = key.trim().toLowerCase()
  const known = VIRTUAL_KEYS[normalized]
  if (known !== undefined) return known
  if (normalized.length === 1) {
    const code = normalized.charCodeAt(0)
    if (code >= 0x30 && code <= 0x5a) return code // 0-9, A-Z
    if (code >= 0x61 && code <= 0x7a) return code - 32 // a-z -> A-Z
  }
  throw new Error(`Desteklenmeyen tuş: ${key}`)
}

/** Metin yazma aracının gönderdiği metni sınırlar ve boşluğu engeller. */
export function normalizeTypedText(input: unknown): string {
  const text = typeof input === 'string' ? input : ''
  if (!text) throw new Error('Yazılacak metin boş.')
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`Yazılacak metin ${MAX_TEXT_LENGTH} karakterden uzun.`)
  // Kontrol karakterleri (satır sonu hariç) tuş taklidiyle gönderilemez.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('Metin desteklenmeyen kontrol karakteri içeriyor.')
  return text
}

export function normalizeWindowTitle(input: unknown): string {
  const title = String(input ?? '').trim()
  if (!title) throw new Error('Pencere başlığı boş.')
  if (title.length > MAX_TITLE_LENGTH) throw new Error('Pencere başlığı çok uzun.')
  return title
}

/** Ekran koordinatı doğrulaması (çoklu ekran ve negatif değerler desteklenir). */
export function normalizeCoordinates(x: unknown, y: unknown): { x: number; y: number } {
  const px = Number(x)
  const py = Number(y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('Fare koordinatları sayı olmalı.')
  const roundedX = Math.round(px)
  const roundedY = Math.round(py)
  if (Math.abs(roundedX) > 20000 || Math.abs(roundedY) > 20000) throw new Error('Fare koordinatları ekran dışında.')
  return { x: roundedX, y: roundedY }
}

/** Kullanıcının/Ultron'un çalıştığı yeri koruyan süreç adları. */
export const PROTECTED_PROCESS_NAMES = ['ultron', 'electron']

export function isProtectedProcessName(name: string | null | undefined): boolean {
  if (!name) return false
  const normalized = String(name).trim().toLowerCase().replace(/\.exe$/, '')
  return PROTECTED_PROCESS_NAMES.includes(normalized)
}

/** Kullanıcının gerçek işaretleriyle yazdığı uygulama adları → çalıştırılabilir dosya. */
export const APP_NAME_ALIASES: Record<string, string> = {
  'not defteri': 'notepad.exe', notepad: 'notepad.exe',
  'hesap makinesi': 'calc.exe', calculator: 'calc.exe', calc: 'calc.exe',
  'dosya gezgini': 'explorer.exe', 'file explorer': 'explorer.exe', explorer: 'explorer.exe',
  paint: 'mspaint.exe', mspaint: 'mspaint.exe',
  'komut istemi': 'cmd.exe', cmd: 'cmd.exe', 'command prompt': 'cmd.exe',
  powershell: 'powershell.exe', 'power shell': 'powershell.exe',
  'denetim paneli': 'control.exe', 'control panel': 'control.exe',
  'görev yöneticisi': 'taskmgr.exe', 'task manager': 'taskmgr.exe',
  'ekran görüntüsü aracı': 'snippingtool.exe', snippingtool: 'snippingtool.exe',
  kate: 'notepad.exe', 'metin editörü': 'notepad.exe',
}

/** Tam masaüstü otomasyonu kapalıyken de açık kullanıcı isteğiyle başlatılabilen uygulamalar.
 *  Sabit bir 7 uygulamalık liste, kullanıcının bilgisayarındaki gerçek uygulamaları
 *  açamıyordu; liste artık sistemdeki tüm uygulamalara çözülür. */
const TRUSTED_APPLICATION_TARGETS = new Set([
  'calc.exe', 'notepad.exe', 'explorer.exe', 'mspaint.exe',
  'control.exe', 'taskmgr.exe', 'snippingtool.exe',
  'cmd.exe', 'powershell.exe', 'pwsh.exe', 'msedge.exe', 'chrome.exe',
  'firefox.exe', 'brave.exe', 'word.exe', 'excel.exe', 'powerpnt.exe',
  'outlook.exe', 'code.exe', 'devenv.exe', 'spotify.exe', 'discord.exe',
  'slack.exe', 'teams.exe', 'zoom.exe', 'whatsapp.exe', 'telegram.exe',
  'vlc.exe', 'photos.exe', 'stickynotes.exe', 'winstore.exe', 'calcapp.exe',
  'wordpad.exe', 'write.exe', 'msteams.exe', 'onedrive.exe', 'dropbox.exe',
])

/** Bir uygulama adı güvenli başlatma listesinde mi? (Sistemde kurulu her uygulama kabul edilir.) */
export function isTrustedApplicationTarget(target: string): boolean {
  const name = String(target ?? '').trim().toLocaleLowerCase('en-US')
  if (!name) return false
  if (TRUSTED_APPLICATION_TARGETS.has(name)) return true
  // Kurulu uygulama adları: PATH'te ya da sistem klasöründe bulunan çalıştırılabilir dosyalar.
  if (!/\.(?:exe|lnk|msi|bat|cmd)$/i.test(name)) return false
  const systemRoots = [
    process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32') : 'C:/Windows/System32',
    process.env.SystemRoot ? path.join(process.env.SystemRoot, 'SysWOW64') : 'C:/Windows/SysWOW64',
  ]
  for (const root of systemRoots) {
    if (name === path.join(root, name).toLocaleLowerCase('en-US')) return true
  }
  return name.includes('\\') || name.includes('/')
}

/** Uygulama hedefini çalıştırılabilir dosya adına çevirir (yol yoksa PATH'e bakılır). */
export function resolveAppTarget(input: unknown): string {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('Uygulama adı veya yolu belirtilmedi.')
  if (raw.length > 600) throw new Error('Uygulama hedefi çok uzun.')
  if (/[&|<>^%`"'\r\n]/.test(raw)) throw new Error('Hedefte güvenilmeyen karakter var.')
  const alias = APP_NAME_ALIASES[raw.toLocaleLowerCase('tr-TR')]
  if (alias) return alias
  if (/[\\/]/.test(raw)) return raw
  if (!/\.[a-z0-9]{1,5}$/i.test(raw)) return `${raw}.exe`
  return raw
}

/** Güvenli modda yalnız uygulama ADI kabul edilir. Keyfi dosya yolu, masaüstü
 *  açıkken kullanılabilen desktop_launch_app aracına bırakılmıştır.
 *  Kabuk yürütücüleri (cmd/powershell vb.) keyfi komut çalıştırabildiği için
 *  bu yolla başlatılamaz. */
const SHELL_INTERPRETERS = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe', 'rundll32.exe', 'regsvr32.exe', 'bash.exe', 'sh.exe', 'wsl.exe'])

export function resolveTrustedApplicationTarget(input: unknown): string {
  const raw = String(input ?? '').trim()
  if (!raw) throw new Error('Uygulama adı belirtilmedi.')
  if (raw.length > 600) throw new Error('Uygulama adı çok uzun.')
  if (/[&|<>^%`"'\r\n]/.test(raw)) throw new Error('Uygulama adında güvenilmeyen karakter var.')
  if (/[\\/]/.test(raw) || raw.includes(':')) {
    throw new Error(`"${raw}" güvenli uygulama başlatma listesinde değil: bu modda yalnız uygulama adı verilebilir.`)
  }
  const target = resolveAppTarget(raw)
  if (SHELL_INTERPRETERS.has(target.toLocaleLowerCase('en-US'))) {
    throw new Error(`"${raw}" güvenli uygulama başlatma listesinde değil: kabuk yürütücüleri bu yolla başlatılamaz.`)
  }
  return target
}

export function buildDesktopPayload(request: DesktopActionRequest): Record<string, unknown> {
  const payload = request.payload ?? {}
  const expectTitle = payload.expect_title === undefined || payload.expect_title === null || payload.expect_title === ''
    ? ''
    : normalizeWindowTitle(payload.expect_title)
  switch (request.action) {
    case 'mouse_move':
    case 'mouse_click': {
      const { x, y } = normalizeCoordinates(payload.x, payload.y)
      const button = payload.button === 'right' ? 'right' : payload.button === 'middle' ? 'middle' : 'left'
      return { x, y, button, double: payload.double === true, expect_title: expectTitle }
    }
    case 'keyboard_type':
      return { text: normalizeTypedText(payload.text), expect_title: expectTitle }
    case 'keyboard_keys': {
      const chord = parseKeyChord(String(payload.keys ?? ''))
      return { keys: chord.modifiers.concat(chord.key).join('+'), key: chord.key, modifiers: chord.modifiers, expect_title: expectTitle }
    }
    case 'window_focus':
    case 'window_close':
    case 'ui_elements':
      return { title: payload.title === undefined || payload.title === null || payload.title === '' ? '' : normalizeWindowTitle(payload.title), limit: clampLimit(payload.limit) }
    case 'launch_app':
    case 'open_explorer': {
      const target = String(payload.path ?? payload.target ?? '').trim()
      if (!target) throw new Error('Uygulama yolu veya klasör yolu belirtilmedi.')
      if (target.length > 600) throw new Error('Hedef yol çok uzun.')
      if (/[&|<>^%`"'\r\n]/.test(target)) throw new Error('Hedef yolda güvenilmeyen karakter var.')
      if (request.action === 'launch_app') return { target: resolveAppTarget(target) }
      return { target }
    }
    case 'process_list':
    case 'process_start':
    case 'process_kill': {
      const name = String(payload.name ?? payload.process ?? payload.target ?? '').trim()
      const pid = payload.pid === undefined || payload.pid === null || payload.pid === '' ? null : Number(payload.pid)
      if (name.length > 260) throw new Error('Süreç adı çok uzun.')
      if (pid !== null && (!Number.isInteger(pid) || pid <= 0)) throw new Error('Süreç kimliği geçersiz.')
      if (request.action === 'process_list' && !name && pid === null) return { name: '', pid: null }
      if (request.action !== 'process_list' && !name && pid === null) throw new Error('Süreç adı veya PID belirtilmedi.')
      if (/[\r\n;&|<>`]/.test(name)) throw new Error('Süreç adında güvenilmeyen karakter var.')
      return { name, pid }
    }
    case 'app_logs': {
      const file = String(payload.path ?? '').trim()
      if (!file || file.length > 600) throw new Error('Log dosyası yolu geçersiz.')
      if (/[\r\n;&|<>`]/.test(file)) throw new Error('Log yolunda güvenilmeyen karakter var.')
      const tail = Math.min(Math.max(Number(payload.tail ?? 120) || 120, 1), 500)
      return { path: file, tail }
    }
    case 'open_file_default': {
      const file = String(payload.path ?? '').trim()
      if (!file || file.length > 600) throw new Error('Açılacak dosya yolu geçersiz.')
      if (/[\r\n;&|<>`]/.test(file)) throw new Error('Dosya yolunda güvenilmeyen karakter var.')
      return { path: file }
    }
    case 'text_task': {
      // Deterministik akış: uygulamayı aç → odaklan → metni yaz → isteğe bağlı kaydet.
      const app = payload.app === undefined || payload.app === null || payload.app === '' ? '' : String(payload.app)
      const text = payload.text === undefined || payload.text === null ? '' : String(payload.text)
      if (!text.trim()) throw new Error('Yazılacak metin boş.')
      const normalizedText = normalizeTypedText(text)
      const savePath = payload.save_path === undefined || payload.save_path === null || payload.save_path === '' ? '' : String(payload.save_path)
      if (savePath && /[&|<>^%`"'\r\n]/.test(savePath)) throw new Error('Kayıt yolunda güvenilmeyen karakter var.')
      if (savePath.length > 600) throw new Error('Kayıt yolu çok uzun.')
      const expectTitle = payload.expect_title === undefined || payload.expect_title === null || payload.expect_title === '' ? '' : normalizeWindowTitle(payload.expect_title)
      return {
        app: app ? resolveAppTarget(app) : '',
        text: normalizedText,
        save_path: savePath,
        expect_title: expectTitle,
      }
    }
    case 'click_element': {
      // Deterministik tıklama: UI Automation ile öğe bulunur, merkezine tıklanır.
      const name = String(payload.name ?? payload.text ?? '').trim()
      if (!name) throw new Error('Tıklanacak öğe adı belirtilmedi.')
      if (name.length > 200) throw new Error('Öğe adı çok uzun.')
      const window = payload.window === undefined || payload.window === null || payload.window === '' ? '' : normalizeWindowTitle(payload.window)
      return { name, window }
    }
    case 'preflight':
      return {}
    default:
      return {}
  }
}

function clampLimit(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 60
  return Math.min(Math.max(Math.round(parsed), 1), 200)
}

/** PowerShell betiğinin stdout'undan sonuç nesnesini ayrıştırır. */
export function parseDesktopResult(stdout: string): Partial<DesktopState> & { error?: string } {
  const text = String(stdout ?? '')
  const marker = 'ULTRON_RESULT '
  const index = text.lastIndexOf(marker)
  if (index < 0) {
    const trimmed = text.trim()
    if (!trimmed) return { error: 'Masaüstü komutu çıktı üretmedi.' }
    return { error: `Masaüstü komutu çıktısı çözümlenemedi: ${trimmed.slice(0, 400)}` }
  }
  const payload = text.slice(index + marker.length).trim()
  const line = payload.split(/\r?\n/).find((candidate) => candidate.trim().startsWith('{')) ?? payload
  try {
    const parsed = JSON.parse(line) as Partial<DesktopState> & { error?: string }
    return parsed
  } catch {
    return { error: `Masaüstü komutu çıktısı geçersiz JSON: ${line.slice(0, 300)}` }
  }
}

export function desktopResultFileName(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${prefix}-${stamp}-${randomUUID().slice(0, 8)}.png`
}

// ---------------------------------------------------------------------------
// PowerShell host betiği. Tek dosya, tek giriş noktası; -Action ve -Payload ile
// sürülür. Kullanıcı verisi ASLA betiğe gömülmez: her değer -Payload JSON'u
// içinde taşınır ve betik içinde ConvertFrom-Json ile okunur.
// ---------------------------------------------------------------------------
export const DESKTOP_HOST_SCRIPT = String.raw`
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$PayloadB64 = '',
  [string]$OutputPath = '',
  [int]$SelfProcessId = 0,
  [string]$SelfProcessNames = 'ultron,electron'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# PowerShell 5.1 stdout'u sistem kod sayfasıyla yazar; JSON çıktısı bozulmasın.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Result($value) {
  $json = $value | ConvertTo-Json -Depth 6 -Compress
  Write-Output ("ULTRON_RESULT " + $json)
}

function Fail($message) {
  Write-Result @{ ok = $false; error = [string]$message }
  exit 0
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  if (-not ('UltronDesktopNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class UltronDesktopNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public INPUTUNION u; }

  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  public const uint INPUT_KEYBOARD = 1;
  public const uint INPUT_MOUSE = 0;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public const uint WM_CLOSE = 0x0010;

  public static List<IntPtr> TopLevelWindows() {
    List<IntPtr> list = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) { list.Add(hWnd); return true; }, IntPtr.Zero);
    return list;
  }

  public static void ForceForeground(IntPtr hWnd) {
    ShowWindow(hWnd, 9);
    uint ignoredPid = 0;
    uint targetThread = GetWindowThreadProcessId(hWnd, out ignoredPid);
    uint currentThread = GetCurrentThreadId();
    // Windows ön plan kilidi: ALT tuşuna basıp bırakmak kilidi açar.
    SendKey(0x12, false);
    SendKey(0x12, true);
    AttachThreadInput(currentThread, targetThread, true);
    SetForegroundWindow(hWnd);
    AttachThreadInput(currentThread, targetThread, false);
    System.Threading.Thread.Sleep(60);
  }

  public static void TypeUnicode(string text) {
    foreach (char ch in text) {
      ushort code = (ushort)ch;
      INPUT[] inputs = new INPUT[2];
      inputs[0].type = INPUT_KEYBOARD; inputs[0].u.ki = new KEYBDINPUT { wVk = 0, wScan = code, dwFlags = KEYEVENTF_UNICODE, time = 0, dwExtraInfo = IntPtr.Zero };
      inputs[1].type = INPUT_KEYBOARD; inputs[1].u.ki = new KEYBDINPUT { wVk = 0, wScan = code, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
      SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
      // Hedef uygulama (Not Defteri gibi) tuşları çok hızlı gelen karelerde
      // kaybedebiliyor; karakterler arası bekleme yazımı güvenilir kılar.
      System.Threading.Thread.Sleep(28);
    }
  }

  public static void PressVirtualKey(ushort vk, bool ctrl, bool alt, bool shift, bool win) {
    List<ushort> downs = new List<ushort>();
    if (ctrl) downs.Add(0x11);
    if (alt) downs.Add(0x12);
    if (shift) downs.Add(0x10);
    if (win) downs.Add(0x5B);
    downs.Add(vk);
    foreach (ushort key in downs) SendKey(key, false);
    for (int i = downs.Count - 1; i >= 0; i--) SendKey(downs[i], true);
  }

  static void SendKey(ushort vk, bool up) {
    INPUT[] inputs = new INPUT[1];
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].u.ki = new KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = up ? KEYEVENTF_KEYUP : 0, time = 0, dwExtraInfo = IntPtr.Zero };
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(8);
  }

  public static void Click(int x, int y, string button, bool doubleClick) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(40);
    uint down = MOUSEEVENTF_LEFTDOWN, up = MOUSEEVENTF_LEFTUP;
    if (button == "right") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
    else if (button == "middle") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
    int rounds = doubleClick ? 2 : 1;
    for (int i = 0; i < rounds; i++) {
      INPUT[] inputs = new INPUT[2];
      inputs[0].type = INPUT_MOUSE; inputs[0].u.mi = new MOUSEINPUT { dx = 0, dy = 0, mouseData = 0, dwFlags = down, time = 0, dwExtraInfo = IntPtr.Zero };
      inputs[1].type = INPUT_MOUSE; inputs[1].u.mi = new MOUSEINPUT { dx = 0, dy = 0, mouseData = 0, dwFlags = up, time = 0, dwExtraInfo = IntPtr.Zero };
      SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
      if (doubleClick) System.Threading.Thread.Sleep(60);
    }
  }
}
'@
  }

  $data = if ([string]::IsNullOrWhiteSpace($PayloadB64)) { '{}' } else { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadB64)) }
  $data = $data | ConvertFrom-Json
  # DPI duyarlı olmadan fare koordinatları sanallaştırılır ve tıklama yanlış piksele düşer.
  try { [void][UltronDesktopNative]::SetProcessDPIAware() } catch { }
  $selfNames = @($SelfProcessNames -split ',' | ForEach-Object { $_.Trim().ToLower() })

  function Get-WindowInfo($handle) {
    $builder = New-Object System.Text.StringBuilder 512
    [void][UltronDesktopNative]::GetWindowText($handle, $builder, 512)
    $title = $builder.ToString()
    $pidValue = 0
    [void][UltronDesktopNative]::GetWindowThreadProcessId($handle, [ref]$pidValue)
    $processName = ''
    try { $processName = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName } catch { $processName = '' }
    $rect = New-Object UltronDesktopNative+RECT
    [void][UltronDesktopNative]::GetWindowRect($handle, [ref]$rect)
    $visible = [UltronDesktopNative]::IsWindowVisible($handle)
    $foreground = [UltronDesktopNative]::GetForegroundWindow()
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    return @{
      handle = $handle.ToInt64().ToString()
      title = $title
      process = $processName
      pid = [int]$pidValue
      visible = [bool]$visible
      focused = ($foreground -eq $handle)
      rect = @{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom; width = $width; height = $height }
    }
  }

  function Resolve-AppTarget($name, $allowRawPath) {
    # Uygulama adını gerçek bir çalıştırılabilir dosyaya çözer:
    # 1) PATH  2) System32  3) Program Files  4) Başlat Menüsü (UWP/MSI)
    if ($allowRawPath -and (Test-Path -LiteralPath $name)) { return @{ path = (Resolve-Path -LiteralPath $name).Path; method = "yol" } }
    $leaf = [System.IO.Path]::GetFileNameWithoutExtension($name)
    $file = if ($name -match "\.[A-Za-z0-9]{1,5}$") { $name } else { $name + ".exe" }
    try {
      $command = Get-Command $file -ErrorAction Stop | Select-Object -First 1
      if ($command -and $command.Source) { return @{ path = $command.Source; method = "PATH" } }
    } catch { }
    $roots = @()
    if ($env:SystemRoot) { $roots += (Join-Path $env:SystemRoot "System32"); $roots += (Join-Path $env:SystemRoot "SysWOW64") }
    $roots += $env:ProgramFiles
    $roots += ([Environment]::GetFolderPath('ProgramFilesX86'))
    $roots += (Join-Path $env:LOCALAPPDATA "Programs")
    foreach ($root in $roots) {
      if ([string]::IsNullOrWhiteSpace($root)) { continue }
      $candidate = Join-Path $root $file
      if (Test-Path -LiteralPath $candidate) { return @{ path = (Resolve-Path -LiteralPath $candidate).Path; method = "kurulum" } }
    }
    # Program Files altında derin arama (yalnız ad eşleşmesi).
    foreach ($root in @($env:ProgramFiles, ([Environment]::GetFolderPath('ProgramFilesX86')))) {
      if ([string]::IsNullOrWhiteSpace($root)) { continue }
      try {
        $found = Get-ChildItem -LiteralPath $root -Filter $file -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $found) { return @{ path = $found.FullName; method = "kurulum" } }
      } catch { }
    }
    # Başlat menüsü uygulamaları (MS Store / yeni kurulumlar).
    try {
      $apps = Get-StartApps -ErrorAction Stop | Where-Object { $_.Name -and ($_.Name -like ("*" + $leaf + "*")) }
      foreach ($app in $apps) {
        if ($app.AppID -like "shell:AppsFolder*") { return @{ path = $app.AppID; method = "baslat menusu" } }
        if (Test-Path -LiteralPath $app.AppID) { return @{ path = $app.AppID; method = "baslat menusu" } }
      }
    } catch { }
    return $null
  }
  function Get-WindowList {
    $list = @()
    foreach ($handle in [UltronDesktopNative]::TopLevelWindows()) {
      $info = Get-WindowInfo $handle
      if ([string]::IsNullOrWhiteSpace($info.title)) { continue }
      $list += $info
    }
    return $list
  }

  function Get-VisibleWindows {
    return @(Get-WindowList | Where-Object { $_.visible -and -not [string]::IsNullOrWhiteSpace($_.title) })
  }

  function Get-FocusedWindow {
    $handle = [UltronDesktopNative]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) { return $null }
    $info = Get-WindowInfo $handle
    if ([string]::IsNullOrWhiteSpace($info.title)) {
      # Görev çubuğu gibi başlıksız bir ön plan varsa, odaklı görünen pencereyi tercih et.
      $titled = @(Get-VisibleWindows | Where-Object { $_.focused })
      if ($titled.Count -gt 0) { return $titled[0] }
    }
    return $info
  }

  function Test-SelfProtected($window) {
    if ($null -eq $window) { return $false }
    if ($SelfProcessId -gt 0 -and $window.pid -eq $SelfProcessId) { return $true }
    $name = ([string]$window.process).ToLower()
    return ($selfNames -contains $name)
  }

  function Convert-Rect($rect) {
    # Render edilmemiş öğeler için dikdörtgen Infinity/NaN olabilir; güvenli sayıya çevrilir.
    $left = 0; $top = 0; $right = 0; $bottom = 0
    try { if ($null -ne $rect) { $left = [int]$rect.Left; $top = [int]$rect.Top; $right = [int]$rect.Right; $bottom = [int]$rect.Bottom } } catch { }
    if ($left -gt 100000 -or $left -lt -100000) { $left = 0 }
    if ($top -gt 100000 -or $top -lt -100000) { $top = 0 }
    if ($right -gt 100000 -or $right -lt -100000) { $right = 0 }
    if ($bottom -gt 100000 -or $bottom -lt -100000) { $bottom = 0 }
    return @{ left = $left; top = $top; right = $right; bottom = $bottom }
  }

  function Invoke-SaveDialog($path, $dialogHandle) {
    # Kaydetme penceresindeki "Dosya adı" alanına yolu UI Automation ile yazar.
    # Modern Windows diyaloğunda alan bir Edit değil, "FileNameControlHost" kimlikli
    # bir Pane'dir; bu yüzden önce kimliğe, sonra ada göre aranır.
    try { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop } catch { return $false }
    $window = $null
    try { if ($dialogHandle -ne [IntPtr]::Zero) { $window = [System.Windows.Automation.AutomationElement]::FromHandle($dialogHandle) } } catch { $window = $null }
    if ($null -eq $window) { return $false }
    $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $candidates = @()
    foreach ($element in $all) {
      $name = ''; $aid = ''
      try { $name = [string]$element.Current.Name } catch { }
      try { $aid = [string]$element.Current.AutomationId } catch { }
      if ($aid -match 'FileNameControlHost|1148' -or $name -match '^Dosya ad[ıi]|^File name') { $candidates += $element }
    }
    foreach ($element in $candidates) {
      try {
        $pattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
          $pattern.SetValue($path)
          return $true
        }
      } catch { }
      # Panelin içindeki gerçek Edit öğesini dene.
      try {
        $child = $element.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        if ($null -ne $child) {
          $childPattern = $null
          if ($child.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$childPattern)) {
            $childPattern.SetValue($path)
            return $true
          }
        }
      } catch { }
    }
    return $false
  }

  function Invoke-SaveConfirm($dialogHandle) {
    # Kaydetme panelindeki "Kaydet" düğmesine tıklar; yoksa Enter gönderir.
    try { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop } catch { }
    $window = $null
    try { if ($dialogHandle -ne [IntPtr]::Zero) { $window = [System.Windows.Automation.AutomationElement]::FromHandle($dialogHandle) } } catch { $window = $null }
    if ($null -ne $window) {
      try {
        $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($element in $all) {
          $name = ''
          try { $name = ([string]$element.Current.Name).Trim() } catch { }
          if ($name -notmatch '^(Kaydet|Save)$') { continue }
          $rect = $element.Current.BoundingRectangle
          $x = [int](($rect.Left + $rect.Right) / 2)
          $y = [int](($rect.Top + $rect.Bottom) / 2)
          [UltronDesktopNative]::Click($x, $y, 'left', $false)
          return $true
        }
      } catch { }
    }
    return $false
  }

  function Get-ElementInfo($element) {
    if ($null -eq $element) { return $null }
    $rect = Convert-Rect $element.Current.BoundingRectangle
    $value = ''
    try {
      # Metin kutularının içeriği okunabilir: ajan yazdığını bağımsız doğrulayabilir.
      if ($element.Current.ControlType.ProgrammaticName -match 'Edit|Document') {
        $pattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
          $value = [string]$pattern.Current.Value
        } else {
          $textPattern = $null
          if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
            $value = [string]$textPattern.DocumentRange.GetText(600)
          }
        }
        if ($value.Length -gt 600) { $value = $value.Substring(0, 600) + '…' }
      }
    } catch { $value = '' }
    return @{
      name = [string]$element.Current.Name
      type = [string]$element.Current.ControlType.ProgrammaticName
      automationId = [string]$element.Current.AutomationId
      enabled = [bool]$element.Current.IsEnabled
      offscreen = [bool]$element.Current.IsOffscreen
      value = $value
      rect = $rect
    }
  }

  function Get-UiElementsByHandle($handle, $limit) {
    try {
      Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
    } catch {
      return @()
    }
    if ($handle -eq [IntPtr]::Zero) { return @() }
    try {
      $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    } catch {
      return @()
    }
    if ($null -eq $window) { return @() }
    $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $items = @()
    foreach ($element in $all) {
      if ($items.Count -ge $limit) { break }
      $name = [string]$element.Current.Name
      $type = [string]$element.Current.ControlType.ProgrammaticName
      if ([string]::IsNullOrWhiteSpace($name) -and $type -notmatch 'Button|Edit|CheckBox|Text|Hyperlink|ComboBox|ListItem|MenuItem|TabItem|Document') { continue }
      $info = Get-ElementInfo $element
      if ($null -ne $info) { $items += $info }
    }
    return $items
  }

  function Get-UiElements($windowTitle, $limit) {
    $handle = [IntPtr]::Zero
    if (-not [string]::IsNullOrWhiteSpace($windowTitle)) {
      foreach ($window in (Get-VisibleWindows)) {
        if ($window.title -like ('*' + $windowTitle + '*')) { $handle = [IntPtr]::new([int64]$window.handle); break }
      }
    }
    if ($handle -eq [IntPtr]::Zero) {
      $focused = Get-FocusedWindow
      if ($null -ne $focused) { $handle = [IntPtr]::new([int64]$focused.handle) }
    }
    return @(Get-UiElementsByHandle $handle $limit)
  }

  function Get-ElementAtPoint($x, $y) {
    try {
      Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
      $point = New-Object System.Windows.Point($x, $y)
      $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
      return Get-ElementInfo $element
    } catch {
      return $null
    }
  }

  function Get-ScreenBounds {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    return @{ width = $bounds.Width; height = $bounds.Height }
  }

  function Get-Cursor {
    $point = New-Object UltronDesktopNative+POINT
    [void][UltronDesktopNative]::GetCursorPos([ref]$point)
    return @{ x = $point.X; y = $point.Y }
  }

  function Save-Screenshot($path) {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $directory = [System.IO.Path]::GetDirectoryName($path)
      if (-not [string]::IsNullOrWhiteSpace($directory)) { [void][System.IO.Directory]::CreateDirectory($directory) }
      $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
    return $path
  }

  $focusedBefore = Get-FocusedWindow
  $protectedBefore = Test-SelfProtected $focusedBefore

  # Eylem öncesi pencere doğrulaması: odak beklenen pencerede değilse işlem yapılmaz.
  # Bu kontrol yalnız granüler girdi eylemleri için geçerlidir; text_task/click_element
  # kendi hedef penceresine odaklanır (bileşik akış).
  $granularInput = @('mouse_move', 'mouse_click', 'keyboard_type', 'keyboard_keys')
  $expectedTitle = ''
  if ($null -ne $data -and $null -ne $data.expect_title) { $expectedTitle = [string]$data.expect_title }
  if (-not [string]::IsNullOrWhiteSpace($expectedTitle) -and ($granularInput -contains $Action)) {
    $currentTitle = ''
    if ($null -ne $focusedBefore) { $currentTitle = [string]$focusedBefore.title }
    if ($currentTitle -notlike ('*' + $expectedTitle + '*')) {
      Fail ('Odak beklenen pencerede değil (beklenen: ' + $expectedTitle + '; odaktaki: ' + $currentTitle + '). Önce pencereye odaklan.')
    }
  }
  $result = @{ ok = $true; action = $Action; selfProtected = $protectedBefore; note = $null; error = $null; screenshotPath = $null }
  $result.screen = Get-ScreenBounds
  $result.cursor = Get-Cursor

  switch ($Action) {
    'state' {
      $result.focusedWindow = $focusedBefore
      # Durum okuması kısa tutulur: tam pencere listesi desktop_list_windows aracındadır.
      $result.windows = @(Get-VisibleWindows | Select-Object -First 10)
      $result.windowCount = (Get-VisibleWindows).Count
      $result.elementAtCursor = Get-ElementAtPoint $result.cursor.x $result.cursor.y
    }
    'screenshot' {
      if ([string]::IsNullOrWhiteSpace($OutputPath)) { Fail 'Ekran görüntüsü yolu belirtilmedi.' }
      $saved = Save-Screenshot $OutputPath
      $result.screenshotPath = $saved
      $result.focusedWindow = $focusedBefore
      $result.windows = @(Get-VisibleWindows)
    }
    'window_list' {
      $all = @(Get-VisibleWindows)
      $result.windows = @($all | Select-Object -First 60)
      $result.windowCount = $all.Count
      $result.focusedWindow = $focusedBefore
    }
    'ui_elements' {
      $title = ''
      if ($null -ne $data -and $null -ne $data.title) { $title = [string]$data.title }
      $limit = 60
      if ($null -ne $data -and $null -ne $data.limit) { $limit = [int]$data.limit }
      $result.focusedWindow = $focusedBefore
      $result.elements = @(Get-UiElements $title $limit)
      $result.note = 'Arayüz öğeleri UI Automation ile tespit edildi.'
    }
    'preflight' {
      # Neden çalışmadığını teşhis et: etkileşimli oturum, masaüstü erişimi,
      # ekran sınırları, UI Automation ve fare/klavye enjeksiyonu.
      $sessionId = 0
      try { $sessionId = (Get-Process -Id $SelfProcessId -ErrorAction Stop).SessionId } catch { $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId }
      $explorerSessions = @()
      try { $explorerSessions = @(Get-Process explorer -ErrorAction SilentlyContinue | ForEach-Object { $_.SessionId } | Sort-Object -Unique) } catch { }
      $hasDesktop = ($explorerSessions -contains $sessionId)
      $uiAutomation = $false
      try { Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop; $uiAutomation = $true } catch { }
      $cursorOk = $false
      try { $null = Get-Cursor; $cursorOk = $true } catch { }
      $screen = Get-ScreenBounds
      $notes = @()
      if (-not $hasDesktop) { $notes += 'Bu oturumda etkileşimli masaüstü yok (masaüstü kilitli, RDP oturumu kopuk veya servis oturumu). Fare/klavye komutları çalışmaz.' }
      if (-not $uiAutomation) { $notes += 'UI Automation bileşenleri erişilemiyor; arayüz öğesi tespiti çalışmaz.' }
      if (-not $cursorOk) { $notes += 'Fare imleci okunamadı; fare komutları çalışmayabilir.' }
      if ($notes.Count -eq 0) { $notes += 'Masaüstü kontrolü için ortam uygun görünüyor.' }
      $result.preflight = @{
        sessionId = $sessionId
        explorerSessions = $explorerSessions
        hasInteractiveDesktop = $hasDesktop
        userInteractive = [bool][Environment]::UserInteractive
        uiAutomation = $uiAutomation
        cursorReadable = $cursorOk
        screen = $screen
        protectedProcessNames = $selfNames
        notes = $notes
      }
      $result.windows = @(Get-VisibleWindows | Select-Object -First 10)
      $result.focusedWindow = $focusedBefore
    }
    'text_task' {
      # Deterministik akış: uygulamayı aç, odaklan, metni yaz, isteğe bağlı kaydet.
      $app = [string]$data.app
      $text = [string]$data.text
      $savePath = [string]$data.save_path
      $expectTitle = [string]$data.expect_title
      $steps = @()
      $target = $null
      if (-not [string]::IsNullOrWhiteSpace($app)) {
        $before = @(Get-VisibleWindows | ForEach-Object { $_.handle })
        $process = Start-Process -FilePath $app -PassThru -ErrorAction Stop
        $deadline = (Get-Date).AddSeconds(25)
        while ((Get-Date) -lt $deadline) {
          Start-Sleep -Milliseconds 400
          $candidates = @(Get-VisibleWindows | Where-Object { $_.pid -eq $process.Id -or $_.process -eq $process.ProcessName })
          if ($candidates.Count -eq 0) { $candidates = @(Get-VisibleWindows | Where-Object { $before -notcontains $_.handle }) }
          if ($candidates.Count -gt 0) { $target = $candidates[0]; break }
        }
        $launchDetail = 'pencere bulunamadı'
        if ($null -ne $target) { $launchDetail = $target.title }
        $steps += @{ step = 'launch'; ok = ($null -ne $target); detail = $launchDetail }
      }
      if ($null -ne $target) {
        [UltronDesktopNative]::ForceForeground([IntPtr]::new([int64]$target.handle))
        Start-Sleep -Milliseconds 300
        $steps += @{ step = 'focus'; ok = $true; detail = $target.title }
      } elseif (-not [string]::IsNullOrWhiteSpace($expectTitle)) {
        $steps += @{ step = 'focus'; ok = $false; detail = 'odaklanılacak pencere bulunamadı' }
      }
      # Yazmadan önce odak kaçırılmışsa hedef pencereye yeniden odaklan.
      if ($null -ne $target) {
        $current = Get-FocusedWindow
        $currentTitle = ''
        if ($null -ne $current) { $currentTitle = [string]$current.title }
        if ($currentTitle -notlike ('*' + $target.title + '*')) {
          [UltronDesktopNative]::ForceForeground([IntPtr]::new([int64]$target.handle))
          Start-Sleep -Milliseconds 400
          $steps += @{ step = 'refocus'; ok = $true; detail = ('odak yeniden ayarlandı: ' + $target.title) }
        }
      }
      [UltronDesktopNative]::TypeUnicode($text)
      Start-Sleep -Milliseconds 250
      $steps += @{ step = 'type'; ok = $true; detail = ('yazılan karakter sayısı: ' + $text.Length) }
      if (-not [string]::IsNullOrWhiteSpace($savePath)) {
        # Ctrl+S: sanal tuş 'S' (0x53) + Ctrl değiştirici.
        [UltronDesktopNative]::PressVirtualKey(0x53, $true, $false, $false, $false)
        # Kaydetme paneli geç açılabilir; açılmasını bekle.
        $dialogHandle = [IntPtr]::Zero
        $dialogDeadline = (Get-Date).AddSeconds(8)
        while ((Get-Date) -lt $dialogDeadline) {
          Start-Sleep -Milliseconds 300
          foreach ($window in (Get-VisibleWindows)) {
            if ($window.title -match 'Farkl[ıi] kaydet|Kaydet|Save As') { $dialogHandle = [IntPtr]::new([int64]$window.handle); break }
          }
          if ($dialogHandle -ne [IntPtr]::Zero) { break }
        }
        if ($dialogHandle -eq [IntPtr]::Zero) {
          $current = Get-FocusedWindow
          if ($null -ne $current) { $dialogHandle = [IntPtr]::new([int64]$current.handle) }
        }
        $fieldSet = Invoke-SaveDialog $savePath $dialogHandle
        if (-not $fieldSet) {
          # Alan bulunamadıysa yolu doğrudan yaz (diyalog odaktaysa işe yarar).
          [UltronDesktopNative]::TypeUnicode($savePath)
          Start-Sleep -Milliseconds 300
        }
        $steps += @{ step = 'path'; ok = $true; detail = ('kayıt yolu alana yazıldı (UI Automation: ' + $fieldSet + ')') }
        $confirmed = Invoke-SaveConfirm $dialogHandle
        if (-not $confirmed) { [UltronDesktopNative]::PressVirtualKey(0x0D, $false, $false, $false, $false) }
        Start-Sleep -Milliseconds 1600
        $steps += @{ step = 'save'; ok = (Test-Path -LiteralPath $savePath); detail = $savePath }
      }
      $result.windows = @(Get-VisibleWindows | Select-Object -First 10)
      $result.focusedWindow = Get-FocusedWindow
      $result.steps = $steps
      $result.note = 'Metin içeriği güvenlik nedeniyle kaydedilmedi.'
    }
    'click_element' {
      # Deterministik tıklama: UI Automation ile öğe bulunur ve merkezine tıklanır.
      $name = [string]$data.name
      $windowTitle = [string]$data.window
      $handle = [IntPtr]::Zero
      if (-not [string]::IsNullOrWhiteSpace($windowTitle)) {
        foreach ($window in (Get-VisibleWindows)) {
          if ($window.title -like ('*' + $windowTitle + '*')) { $handle = [IntPtr]::new([int64]$window.handle); break }
        }
      }
      if ($handle -eq [IntPtr]::Zero) {
        $focused = Get-FocusedWindow
        if ($null -ne $focused) { $handle = [IntPtr]::new([int64]$focused.handle) }
      }
      $elements = @(Get-UiElementsByHandle $handle 200)
      $match = $null
      foreach ($element in $elements) {
        if ($element.name -eq $name -or $element.name -like ('*' + $name + '*')) { $match = $element; break }
      }
      if ($null -eq $match) { Fail ('Öğe bulunamadı: ' + $name) }
      $x = [int](($match.rect.left + $match.rect.right) / 2)
      $y = [int](($match.rect.top + $match.rect.bottom) / 2)
      [UltronDesktopNative]::Click($x, $y, 'left', $false)
      Start-Sleep -Milliseconds 300
      $result.clicked = @{ name = $match.name; type = $match.type; x = $x; y = $y }
      $result.focusedWindow = Get-FocusedWindow
      $result.note = 'Öğe merkezine tıklandı.'
    }
    'mouse_move' {
      if ($protectedBefore) { Fail 'Ultron kendi penceresine fare gönderemez; önce başka bir pencereye geç.' }
      $x = [int]$data.x
      $y = [int]$data.y
      [void][UltronDesktopNative]::SetCursorPos($x, $y)
      Start-Sleep -Milliseconds 80
      $result.cursor = Get-Cursor
      $result.elementAtCursor = Get-ElementAtPoint $x $y
      $result.focusedWindow = $focusedBefore
    }
    'mouse_click' {
      if ($protectedBefore) { Fail 'Ultron kendi penceresine tıklayamaz; önce başka bir pencereye geç.' }
      $x = [int]$data.x
      $y = [int]$data.y
      $button = 'left'
      if ($null -ne $data -and $null -ne $data.button) { $button = [string]$data.button }
      $double = $false
      if ($null -ne $data -and $null -ne $data.double) { $double = [bool]$data.double }
      [UltronDesktopNative]::Click($x, $y, $button, $double)
      Start-Sleep -Milliseconds 200
      $result.cursor = Get-Cursor
      $result.elementAtCursor = Get-ElementAtPoint $x $y
      $result.focusedWindow = Get-FocusedWindow
      $result.windows = @(Get-VisibleWindows)
    }
    'keyboard_type' {
      if ($protectedBefore) { Fail 'Ultron kendi penceresine metin yazamaz; önce başka bir pencereye geç.' }
      $text = [string]$data.text
      [UltronDesktopNative]::TypeUnicode($text)
      Start-Sleep -Milliseconds 150
      $result.focusedWindow = Get-FocusedWindow
      $result.note = 'Metin gönderildi; içerik güvenlik nedeniyle kaydedilmedi.'
    }
    'keyboard_keys' {
      if ($protectedBefore) { Fail 'Ultron kendi penceresine tuş gönderemez; önce başka bir pencereye geç.' }
      $parts = @([string]$data.keys -split '\+')
      $keyName = $parts[$parts.Count - 1]
      $modifiers = @()
      if ($parts.Count -gt 1) { $modifiers = $parts[0..($parts.Count - 2)] }
      $vk = 0
      switch ($keyName.ToLower()) {
        'enter' { $vk = 0x0D } 'tab' { $vk = 0x09 } 'esc' { $vk = 0x1B } 'escape' { $vk = 0x1B }
        'space' { $vk = 0x20 } 'backspace' { $vk = 0x08 } 'delete' { $vk = 0x2E } 'insert' { $vk = 0x2D }
        'home' { $vk = 0x24 } 'end' { $vk = 0x23 } 'pageup' { $vk = 0x21 } 'pagedown' { $vk = 0x22 }
        'left' { $vk = 0x25 } 'up' { $vk = 0x26 } 'right' { $vk = 0x27 } 'down' { $vk = 0x28 }
        default {
          if ($keyName.ToLower() -match '^f([1-9]|1[0-2])$') { $vk = 0x6F + [int]$Matches[1] }
          elseif ($keyName.Length -eq 1) { $vk = [int][char]$keyName.ToUpper() }
          else { Fail ('Desteklenmeyen tuş: ' + $keyName) }
        }
      }
      $ctrl = ($modifiers -contains 'ctrl') -or ($modifiers -contains 'control')
      $alt = $modifiers -contains 'alt'
      $shift = $modifiers -contains 'shift'
      $win = ($modifiers -contains 'win') -or ($modifiers -contains 'meta') -or ($modifiers -contains 'windows')
      [UltronDesktopNative]::PressVirtualKey([uint16]$vk, $ctrl, $alt, $shift, $win)
      Start-Sleep -Milliseconds 150
      $result.focusedWindow = Get-FocusedWindow
    }
    'window_focus' {
      $title = [string]$data.title
      $target = $null
      foreach ($window in (Get-VisibleWindows)) {
        if ($window.title -like ('*' + $title + '*')) { $target = $window; break }
      }
      if ($null -eq $target) { Fail ('Pencere bulunamadı: ' + $title) }
      $handle = [IntPtr]::new([int64]$target.handle)
      [UltronDesktopNative]::ForceForeground($handle)
      Start-Sleep -Milliseconds 250
      $result.focusedWindow = Get-FocusedWindow
      $result.windows = @(Get-VisibleWindows)
    }
    'window_close' {
      $title = [string]$data.title
      $target = $null
      foreach ($window in (Get-VisibleWindows)) {
        if ($window.title -like ('*' + $title + '*')) { $target = $window; break }
      }
      if ($null -eq $target) { Fail ('Pencere bulunamadı: ' + $title) }
      if (Test-SelfProtected $target) { Fail 'Ultron kendi penceresini kapatamaz.' }
      $handle = [IntPtr]::new([int64]$target.handle)
      [void][UltronDesktopNative]::PostMessage($handle, [UltronDesktopNative]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 300
      $result.focusedWindow = Get-FocusedWindow
      $result.windows = @(Get-VisibleWindows)
      $result.note = 'Pencereye WM_CLOSE gönderildi (zarif kapanış).'
    }
    'launch_app' {
      $target = [string]$data.target
      $leaf = [System.IO.Path]::GetFileNameWithoutExtension($target).ToLower()
      if (($selfNames -contains $leaf) -or ($leaf -eq 'ultron')) { Fail 'Ultron kendi uygulamasını başlatmak/klonlamak için kullanılamaz.' }
      # Uygulama adını gerçek çalıştırılabilir dosyaya çöz (PATH, kurulum klasörleri, Başlat menüsü).
      $allowRawPath = $false
      if ($null -ne $data -and $null -ne $data.allow_raw_path) { $allowRawPath = [bool]$data.allow_raw_path }
      $resolvedApp = Resolve-AppTarget $target $allowRawPath
      if ($null -eq $resolvedApp) { Fail ('Uygulama bulunamadı: ' + $target) }
      $target = $resolvedApp.path
      $before = @(Get-VisibleWindows | ForEach-Object { $_.handle })
      $process = Start-Process -FilePath $target -PassThru -ErrorAction Stop
      $deadline = (Get-Date).AddSeconds(25)
      $found = $null
      while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 400
        # Mağaza uygulamaları (örn. Not Defteri) pencereyi ayrı bir süreçte açar;
        # bu yüzden önce süreç adı, sonra yeni pencere eşleşmesi denenir.
        $candidates = @(Get-VisibleWindows | Where-Object { $_.pid -eq $process.Id -or $_.process -eq $process.ProcessName })
        if ($candidates.Count -eq 0) {
          $candidates = @(Get-VisibleWindows | Where-Object { $before -notcontains $_.handle })
        }
        if ($candidates.Count -gt 0) { $found = $candidates[0]; break }
      }
      if ($null -ne $found) {
        try { [UltronDesktopNative]::ForceForeground([IntPtr]::new([int64]$found.handle)) } catch { }
      }
      $result.windows = @(Get-VisibleWindows)
      $result.focusedWindow = Get-FocusedWindow
      $result.launched = @{ pid = $process.Id; process = $process.ProcessName; window = $found; verified = ($null -ne $found) }
      if ($null -eq $found) { $result.note = 'Uygulama başlatıldı ancak 25 saniye içinde pencere doğrulanamadı.' }
    }
    'open_explorer' {
      $target = [string]$data.target
      if (-not (Test-Path -LiteralPath $target)) { Fail ('Klasör bulunamadı: ' + $target) }
      $before = @(Get-VisibleWindows | ForEach-Object { $_.handle })
      $process = Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $target + '"') -PassThru -ErrorAction Stop
      $deadline = (Get-Date).AddSeconds(20)
      $found = $null
      while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 400
        # Klasör adı yerelleştirilmiş olabileceğinden (örn. "Documents" -> "Belgeler")
        # başlık eşleşmesi yerine YENİ bir Gezgin penceresi aranır.
        $candidates = @(Get-VisibleWindows | Where-Object { $before -notcontains $_.handle -and $_.process -eq 'explorer' })
        if ($candidates.Count -gt 0) { $found = $candidates[0]; break }
      }
      $result.windows = @(Get-VisibleWindows)
      $result.focusedWindow = Get-FocusedWindow
      $result.launched = @{ pid = $process.Id; path = $target; window = $found; verified = ($null -ne $found) }
      if ($null -eq $found) { $result.note = 'Dosya Gezgini başlatıldı ancak yeni pencere doğrulanamadı.' }
    }
    'process_list' {
      $name = if ($null -ne $data.name) { [string]$data.name } else { '' }
      $pid = if ($null -ne $data.pid) { [int]$data.pid } else { 0 }
      $items = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        ($pid -le 0 -or $_.Id -eq $pid) -and ([string]::IsNullOrWhiteSpace($name) -or $_.ProcessName -like ('*' + $name.TrimEnd('.exe') + '*'))
      } | Select-Object -First 200 Id,ProcessName,MainWindowTitle,Responding,CPU,StartTime)
      $result.processes = @($items)
      $result.count = $items.Count
    }
    'process_start' {
      $target = [string]$data.name
      if ([string]::IsNullOrWhiteSpace($target)) { Fail 'Başlatılacak süreç adı belirtilmedi.' }
      $resolved = Resolve-AppTarget $target $false
      if ($null -eq $resolved) { Fail ('Süreç bulunamadı: ' + $target) }
      $process = Start-Process -FilePath $resolved.path -PassThru -ErrorAction Stop
      Start-Sleep -Milliseconds 250
      $result.started = @{ pid = $process.Id; process = $process.ProcessName; path = $resolved.path }
      $result.processes = @(Get-Process -Id $process.Id -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowTitle,Responding)
    }
    'process_kill' {
      $pid = if ($null -ne $data.pid) { [int]$data.pid } else { 0 }
      $name = if ($null -ne $data.name) { [string]$data.name } else { '' }
      $targets = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { ($pid -gt 0 -and $_.Id -eq $pid) -or ($pid -le 0 -and $name -and $_.ProcessName -like ('*' + $name.TrimEnd('.exe') + '*')) })
      if ($targets.Count -eq 0) { Fail 'Durdurulacak süreç bulunamadı.' }
      foreach ($proc in $targets) {
        if ($selfNames -contains $proc.ProcessName.ToLower()) { Fail 'Ultron veya Electron süreci durdurulamaz.' }
      }
      $stopped = @()
      foreach ($proc in $targets) { Stop-Process -Id $proc.Id -ErrorAction Stop; $stopped += @{ pid = $proc.Id; process = $proc.ProcessName } }
      $result.stopped = @($stopped)
    }
    'app_logs' {
      $logPath = [string]$data.path
      if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) { Fail ('Log dosyası bulunamadı: ' + $logPath) }
      $tail = [int]$data.tail
      $result.log = @(Get-Content -LiteralPath $logPath -Tail $tail -ErrorAction Stop)
      $result.path = $logPath
      $result.tail = $tail
    }
    'open_file_default' {
      $filePath = [string]$data.path
      if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { Fail ('Dosya bulunamadı: ' + $filePath) }
      $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
      if (@('.exe','.bat','.cmd','.ps1','.msi','.lnk','.com','.js','.vbs') -contains $extension) { Fail 'Çalıştırılabilir dosyalar varsayılan uygulamayla açılmaz.' }
      $opened = Start-Process -FilePath $filePath -PassThru -ErrorAction Stop
      $result.opened = @{ path = $filePath; pid = $opened.Id; process = $opened.ProcessName }
    }
    default { Fail ('Bilinmeyen masaüstü eylemi: ' + $Action) }
  }

  Write-Result $result
} catch {
  Fail $_.Exception.Message
}
`
