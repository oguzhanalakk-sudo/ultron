// Ultron Mobile Remote Control - Frontend

const API_BASE = '/api'
const WS_BASE = `ws://${location.host}`

// State
let devices = []
let selectedDevice = null
let screenWs = null
let remoteWs = null
let screenAnimationId = null
const remoteSessions = new Map()
let activeView = 'welcome'

// DOM Elements
const els = {
  connectionState: document.getElementById('connection-state'),
  deviceList: document.getElementById('device-list'),
  remoteList: document.getElementById('remote-list'),
  refreshDevices: document.getElementById('refresh-devices'),
  addRemote: document.getElementById('add-remote'),
  mainContent: document.getElementById('main-content'),
  welcomeView: document.getElementById('welcome-view'),
  deviceDetailView: document.getElementById('device-detail-view'),
  remoteDesktopView: document.getElementById('remote-desktop-view'),
  deviceTitle: document.getElementById('device-title'),
  btnScreenStream: document.getElementById('btn-screen-stream'),
  btnStopStream: document.getElementById('btn-stop-stream'),
  screenCanvas: document.getElementById('screen-canvas'),
  screenOverlay: document.getElementById('screen-overlay'),
  screenPlaceholder: document.getElementById('screen-placeholder'),
  remoteCanvas: document.getElementById('remote-canvas'),
  remotePlaceholder: document.getElementById('remote-placeholder'),
  deviceTabs: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  controlGrid: document.querySelectorAll('.ctrl-btn'),
  appList: document.getElementById('app-list'),
  fileList: document.getElementById('file-list'),
  logOutput: document.getElementById('log-output'),
  shellOutput: document.getElementById('shell-output'),
  modalApk: document.getElementById('modal-apk'),
  modalRemote: document.getElementById('modal-remote'),
  toast: document.getElementById('toast'),
  // Form elements
  apkFileInput: document.getElementById('apk-file-input'),
  btnConfirmApk: document.getElementById('btn-confirm-apk'),
  btnCancelApk: document.getElementById('btn-cancel-apk'),
  remoteType: document.getElementById('remote-type'),
  remoteHost: document.getElementById('remote-host'),
  remotePort: document.getElementById('remote-port'),
  remotePassword: document.getElementById('remote-password'),
  btnConfirmRemote: document.getElementById('btn-confirm-remote'),
  btnCancelRemote: document.getElementById('btn-cancel-remote'),
  // Toolbar buttons
  btnRefreshApps: document.getElementById('btn-refresh-apps'),
  btnInstallApk: document.getElementById('btn-install-apk'),
  btnListFiles: document.getElementById('btn-list-files'),
  btnPullFile: document.getElementById('btn-pull-file'),
  btnPushFile: document.getElementById('btn-push-file'),
  btnRefreshLogs: document.getElementById('btn-refresh-logs'),
  btnClearLogs: document.getElementById('btn-clear-logs'),
  btnRunShell: document.getElementById('btn-run-shell'),
  btnDisconnectRemote: document.getElementById('btn-disconnect-remote'),
  // Inputs
  appSearch: document.getElementById('app-search'),
  filePath: document.getElementById('file-path'),
  logFilter: document.getElementById('log-filter'),
  shellCmd: document.getElementById('shell-cmd')
}

// Utility functions
function showToast(message, duration = 3000) {
  els.toast.textContent = message
  els.toast.classList.add('visible')
  setTimeout(() => els.toast.classList.remove('visible'), duration)
}

function showView(viewName) {
  activeView = viewName
  document.querySelectorAll('.view').forEach(v => v.hidden = true)
  document.getElementById(`${viewName}-view`)?.hidden = false
  
  if (viewName === 'welcome') {
    els.welcomeView.hidden = false
    els.deviceDetailView.hidden = true
    els.remoteDesktopView.hidden = true
  } else if (viewName === 'device') {
    els.welcomeView.hidden = true
    els.deviceDetailView.hidden = false
    els.remoteDesktopView.hidden = true
  } else if (viewName === 'remote') {
    els.welcomeView.hidden = true
    els.deviceDetailView.hidden = true
    els.remoteDesktopView.hidden = false
  }
}

function setConnectionStatus(online) {
  els.connectionState.classList.toggle('online', online)
  els.connectionState.innerHTML = `<span></span> ${online ? 'Bağlı' : 'Bağlantı kesildi'}`
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function toast(message) { showToast(message) }

// Device Management
async function loadDevices() {
  try {
    const { devices: devs } = await api('/devices')
    devices = devs
    renderDeviceList()
    if (selectedDevice && !devices.find(d => d.serial === selectedDevice.serial)) {
      selectDevice(null)
    }
  } catch (err) {
    console.error('Failed to load devices:', err)
    toast('Cihazlar yüklenemedi: ' + err.message)
  }
}

function renderDeviceList() {
  if (devices.length === 0) {
    els.deviceList.innerHTML = '<li class="empty-state">Cihaz bulunamadı. USB hata ayıklama açık mı?</li>'
    return
  }
  els.deviceList.innerHTML = devices.map(d => `
    <li class="device-item ${selectedDevice?.serial === d.serial ? 'active' : ''}" data-serial="${d.serial}">
      <div class="device-icon">📱</div>
      <div class="device-info">
        <div class="device-name">${d.model || 'Android Device'}</div>
        <div class="device-meta">${d.serial} • Android ${d.androidVersion || '?'}</div>
      </div>
      <div class="device-status ${d.state}"></div>
    </li>
  `).join('')
  
  els.deviceList.querySelectorAll('.device-item').forEach(item => {
    item.addEventListener('click', () => selectDevice(item.dataset.serial))
  })
}

function selectDevice(serial) {
  selectedDevice = serial ? devices.find(d => d.serial === serial) : null
  renderDeviceList()
  
  if (!selectedDevice) {
    showView('welcome')
    return
  }
  
  showView('device')
  els.deviceTitle.textContent = `${selectedDevice.model || 'Android'} (${selectedDevice.serial})`
  els.btnScreenStream.disabled = false
  loadApps()
  loadFiles()
  loadLogs()
}

// Screen Streaming
function startScreenStream() {
  if (!selectedDevice) return
  
  els.screenPlaceholder.hidden = true
  els.screenOverlay.hidden = false
  els.btnScreenStream.hidden = true
  els.btnStopStream.hidden = false
  
  const ctx = els.screenCanvas.getContext('2d')
  screenWs = new WebSocket(`${WS_BASE}/ws/screen/${selectedDevice.serial}`)
  
  screenWs.binaryType = 'arraybuffer'
  
  screenWs.onopen = () => {
    toast('Ekran yayını başlatıldı')
  }
  
  screenWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'screen' && msg.data) {
        renderFrame(msg.data, ctx)
      }
    } catch (e) {
      // Binary frame
      renderFrameFromBuffer(event.data, ctx)
    }
  }
  
  screenWs.onclose = () => {
    stopScreenStream()
  }
  
  screenWs.onerror = (err) => {
    console.error('Screen WS error:', err)
    toast('Ekran yayını hatası')
    stopScreenStream()
  }
}

function stopScreenStream() {
  if (screenWs) {
    screenWs.close()
    screenWs = null
  }
  if (screenAnimationId) {
    cancelAnimationFrame(screenAnimationId)
    screenAnimationId = null
  }
  els.screenOverlay.hidden = true
  els.btnScreenStream.hidden = false
  els.btnStopStream.hidden = true
  // Keep last frame or show placeholder
}

function renderFrame(base64, ctx) {
  const img = new Image()
  img.onload = () => {
    const canvas = els.screenCanvas
    canvas.width = img.width
    canvas.height = img.height
    ctx.drawImage(img, 0, 0)
  }
  img.src = `data:image/png;base64,${base64}`
}

function renderFrameFromBuffer(buffer, ctx) {
  const blob = new Blob([buffer], { type: 'image/png' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = () => {
    const canvas = els.screenCanvas
    canvas.width = img.width
    canvas.height = img.height
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
  }
  img.src = url
}

// Touch/Mouse handling for screen
let lastTouch = { x: 0, y: 0, time: 0 }
let isDragging = false

els.screenCanvas.addEventListener('mousedown', handlePointerStart)
els.screenCanvas.addEventListener('mousemove', handlePointerMove)
els.screenCanvas.addEventListener('mouseup', handlePointerEnd)
els.screenCanvas.addEventListener('mouseleave', handlePointerEnd)
els.screenCanvas.addEventListener('touchstart', handlePointerStart, { passive: false })
els.screenCanvas.addEventListener('touchmove', handlePointerMove, { passive: false })
els.screenCanvas.addEventListener('touchend', handlePointerEnd)

function getCanvasCoords(e) {
  const rect = els.screenCanvas.getBoundingClientRect()
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const clientY = e.touches ? e.touches[0].clientY : e.clientY
  return {
    x: Math.round((clientX - rect.left) * (els.screenCanvas.width / rect.width)),
    y: Math.round((clientY - rect.top) * (els.screenCanvas.height / rect.height))
  }
}

function handlePointerStart(e) {
  if (!selectedDevice || !screenWs) return
  e.preventDefault()
  const coords = getCanvasCoords(e)
  lastTouch = { x: coords.x, y: coords.y, time: Date.now() }
  isDragging = false
}

function handlePointerMove(e) {
  if (!selectedDevice || !screenWs) return
  const coords = getCanvasCoords(e)
  const dist = Math.hypot(coords.x - lastTouch.x, coords.y - lastTouch.y)
  if (dist > 10) isDragging = true
}

async function handlePointerEnd(e) {
  if (!selectedDevice || !screenWs) return
  e.preventDefault()
  const coords = getCanvasCoords(e)
  const duration = Date.now() - lastTouch.time
  
  if (isDragging && dist > 20) {
    // Swipe
    await api(`/devices/${selectedDevice.serial}/swipe`, {
      method: 'POST',
      body: JSON.stringify({ x1: lastTouch.x, y1: lastTouch.y, x2: coords.x, y2: coords.y, duration: Math.max(300, duration) })
    })
  } else if (duration < 300) {
    // Tap
    await api(`/devices/${selectedDevice.serial}/tap`, {
      method: 'POST',
      body: JSON.stringify({ x: coords.x, y: coords.y })
    })
  }
}

// Control Buttons
const controlActions = {
  home: { action: 'key', keycode: 3 },
  back: { action: 'key', keycode: 4 },
  recent: { action: 'key', keycode: 187 },
  power: { action: 'key', keycode: 26 },
  'volume-up': { action: 'key', keycode: 24 },
  'volume-down': { action: 'key', keycode: 25 },
  screenshot: { action: 'screencap' },
  record: { action: 'shell', command: 'screenrecord --time-limit 30 /sdcard/recording.mp4' }
}

els.controlGrid.forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!selectedDevice) return
    const action = btn.dataset.action
    const cmd = controlActions[action]
    if (!cmd) return
    
    try {
      if (cmd.action === 'key') {
        await api(`/devices/${selectedDevice.serial}/key`, { method: 'POST', body: JSON.stringify({ keycode: cmd.keycode }) })
        toast(`${action} gönderildi`)
      } else if (cmd.action === 'screencap') {
        const img = await api(`/devices/${selectedDevice.serial}/screencap`, { method: 'POST' })
        // Trigger download
        const a = document.createElement('a')
        a.href = `/api/devices/${selectedDevice.serial}/screencap`
        a.download = `screenshot-${Date.now()}.png`
        a.click()
        toast('Ekran görüntüsü indirildi')
      } else if (cmd.action === 'shell') {
        await api(`/devices/${selectedDevice.serial}/shell`, { method: 'POST', body: JSON.stringify({ command: cmd.command }) })
        toast('Kayıt başlatıldı')
      }
    } catch (err) {
      toast('Hata: ' + err.message)
    }
  })
})

// Tabs
els.deviceTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab
    els.deviceTabs.forEach(t => t.classList.toggle('active', t === tab))
    els.tabContents.forEach(c => c.hidden = c.id !== `tab-${target}`)
  })
})

// Apps
async function loadApps() {
  if (!selectedDevice) return
  try {
    const result = await api(`/devices/${selectedDevice.serial}/shell`, {
      method: 'POST',
      body: JSON.stringify({ command: 'pm list packages -f' })
    })
    const lines = result.stdout.trim().split('\n')
    const apps = lines.map(line => {
      const match = line.match(/package:(.+)=(.+)/)
      return match ? { path: match[1], package: match[2] } : null
    }).filter(Boolean)
    renderApps(apps)
  } catch (err) {
    console.error('Apps load error:', err)
    els.appList.innerHTML = '<li class="empty-state">Uygulamalar yüklenemedi</li>'
  }
}

function renderApps(apps) {
  if (!apps.length) {
    els.appList.innerHTML = '<li class="empty-state">Uygulama bulunamadı</li>'
    return
  }
  els.appList.innerHTML = apps.map(app => `
    <li class="app-item" data-package="${app.package}" data-path="${app.path}">
      <div class="app-icon">📦</div>
      <div class="app-info">
        <div class="app-name">${app.package}</div>
        <div class="app-package">${app.path}</div>
      </div>
      <div class="app-actions">
        <button class="btn btn-sm" data-action="launch" data-package="${app.package}">▶ Başlat</button>
        <button class="btn btn-sm" data-action="uninstall" data-package="${app.package}">🗑️ Kaldır</button>
      </div>
    </li>
  `).join('')
  
  els.appList.querySelectorAll('[data-action="launch"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      launchApp(btn.dataset.package)
    })
  })
  els.appList.querySelectorAll('[data-action="uninstall"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (confirm(`"${btn.dataset.package}" kaldırılsın mı?`)) {
        await uninstallApp(btn.dataset.package)
      }
    })
  })
}

async function launchApp(packageName) {
  try {
    await api(`/devices/${selectedDevice.serial}/shell`, {
      method: 'POST',
      body: JSON.stringify({ command: `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1` })
    })
    toast(`${packageName} başlatıldı`)
  } catch (err) {
    toast('Hata: ' + err.message)
  }
}

async function uninstallApp(packageName) {
  try {
    await api(`/devices/${selectedDevice.serial}/shell`, {
      method: 'POST',
      body: JSON.stringify({ command: `pm uninstall ${packageName}` })
    })
    toast('Kaldırıldı')
    loadApps()
  } catch (err) {
    toast('Hata: ' + err.message)
  }
}

// Files
async function loadFiles() {
  if (!selectedDevice) return
  const path = els.filePath.value || '/sdcard/'
  try {
    const result = await api(`/devices/${selectedDevice.serial}/shell`, {
      method: 'POST',
      body: JSON.stringify({ command: `ls -la "${path}"` })
    })
    renderFiles(result.stdout, path)
  } catch (err) {
    els.fileList.innerHTML = '<li class="empty-state">Dosyalar yüklenemedi</li>'
  }
}

function renderFiles(output, currentPath) {
  const lines = output.trim().split('\n').slice(1) // Skip total line
  const items = lines.map(line => {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) return null
    const perms = parts[0]
    const size = parts[4]
    const name = parts.slice(8).join(' ')
    const isDir = perms.startsWith('d')
    return { name, size, isDir, path: `${currentPath}${name}${isDir ? '/' : ''}` }
  }).filter(Boolean)
  
  if (!items.length) {
    els.fileList.innerHTML = '<li class="empty-state">Boş klasör</li>'
    return
  }
  
  els.fileList.innerHTML = items.map(item => `
    <li class="file-item" data-path="${item.path}" data-is-dir="${item.isDir}">
      <div class="file-icon">${item.isDir ? '📁' : '📄'}</div>
      <div class="file-info">
        <div class="file-name">${item.name}</div>
        <div class="file-meta">${item.isDir ? 'Klasör' : formatSize(item.size)}</div>
      </div>
      <div class="file-actions">
        ${!item.isDir ? `<button class="btn btn-sm" data-action="pull" data-path="${item.path}">⬇️</button>` : ''}
      </div>
    </li>
  `).join('')
  
  els.fileList.querySelectorAll('[data-action="pull"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const remotePath = btn.dataset.path
      const localName = remotePath.split('/').pop()
      try {
        await api(`/devices/${selectedDevice.serial}/pull`, {
          method: 'POST',
          body: JSON.stringify({ remotePath, localPath: localName })
        })
        toast(`İndirildi: ${localName}`)
      } catch (err) {
        toast('Hata: ' + err.message)
      }
    })
  })
  
  els.fileList.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('dblclick', () => {
      if (item.dataset.isDir === 'true') {
        els.filePath.value = item.dataset.path
        loadFiles()
      }
    })
  })
}

function formatSize(bytes) {
  const n = parseInt(bytes)
  if (n < 1024) return n + ' B'
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB'
  return (n/1024/1024).toFixed(1) + ' MB'
}

// Logs
async function loadLogs() {
  if (!selectedDevice) return
  try {
    const filter = els.logFilter.value || '*:E'
    const result = await api(`/devices/${selectedDevice.serial}/logcat`, {
      method: 'POST',
      body: JSON.stringify({ filter })
    })
    renderLogs(result.stdout)
  } catch (err) {
    els.logOutput.textContent = 'Loglar yüklenemedi: ' + err.message
  }
}

function renderLogs(text) {
  const lines = text.split('\n')
  els.logOutput.innerHTML = lines.map(line => {
    let cls = ''
    if (line.includes(' E ') || line.includes(' E/')) cls = 'error'
    else if (line.includes(' W ') || line.includes(' W/')) cls = 'warn'
    else if (line.includes(' I ') || line.includes(' I/')) cls = 'info'
    else if (line.includes(' D ') || line.includes(' D/')) cls = 'debug'
    return `<span class="${cls}">${escapeHtml(line)}</span>`
  }).join('\n')
  els.logOutput.scrollTop = els.logOutput.scrollHeight
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Shell
async function runShell() {
  if (!selectedDevice) return
  const cmd = els.shellCmd.value.trim()
  if (!cmd) return
  try {
    const result = await api(`/devices/${selectedDevice.serial}/shell`, {
      method: 'POST',
      body: JSON.stringify({ command: cmd })
    })
    els.shellOutput.textContent = result.stdout + (result.stderr ? '\nSTDERR:\n' + result.stderr : '')
    if (result.code !== 0) els.shellOutput.textContent += `\nExit code: ${result.code}`
  } catch (err) {
    els.shellOutput.textContent = 'Hata: ' + err.message
  }
}

// Remote Desktop
els.addRemote.addEventListener('click', () => {
  els.modalRemote.hidden = false
})

els.btnCancelRemote.addEventListener('click', () => {
  els.modalRemote.hidden = true
})

els.btnConfirmRemote.addEventListener('click', async () => {
  const type = els.remoteType.value
  const host = els.remoteHost.value.trim()
  const port = parseInt(els.remotePort.value)
  const password = els.remotePassword.value
  
  if (!host) { toast('Host gerekli'); return }
  
  try {
    const { sessionId, wsUrl } = await api('/remote-desktop/connect', {
      method: 'POST',
      body: JSON.stringify({ type, host, port, password })
    })
    
    els.modalRemote.hidden = true
    connectRemoteDesktop(sessionId, wsUrl, { type, host, port })
  } catch (err) {
    toast('Bağlantı hatası: ' + err.message)
  }
})

function connectRemoteDesktop(sessionId, wsUrl, info) {
  showView('remote')
  els.remoteTitle.textContent = `${info.type.toUpperCase()} - ${info.host}:${info.port}`
  els.remotePlaceholder.hidden = true
  
  remoteWs = new WebSocket(wsUrl)
  remoteWs.binaryType = 'arraybuffer'
  
  const ctx = els.remoteCanvas.getContext('2d')
  
  remoteWs.onopen = () => {
    toast('Uzak masaüstü bağlandı')
  }
  
  remoteWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'vnc-data' && msg.data) {
        // Render VNC frame
        renderVncFrame(msg.data, ctx)
      }
    } catch (e) {
      // Binary VNC data
      renderVncFrameFromBuffer(event.data, ctx)
    }
  }
  
  remoteWs.onclose = () => {
    toast('Uzak masaüstü bağlantısı kesildi')
    showView('welcome')
  }
  
  remoteWs.onerror = (err) => {
    console.error('Remote WS error:', err)
    toast('Bağlantı hatası')
  }
  
  // Store session
  remoteSessions.set(sessionId, { ws: remoteWs, info })
}

function renderVncFrame(base64, ctx) {
  const img = new Image()
  img.onload = () => {
    const canvas = els.remoteCanvas
    canvas.width = img.width
    canvas.height = img.height
    ctx.drawImage(img, 0, 0)
  }
  img.src = `data:image/png;base64,${base64}`
}

function renderVncFrameFromBuffer(buffer, ctx) {
  const blob = new Blob([buffer], { type: 'image/png' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = () => {
    const canvas = els.remoteCanvas
    canvas.width = img.width
    canvas.height = img.height
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
  }
  img.src = url
}

// Input forwarding for remote desktop
let remotePointerDown = false
let remoteLastPos = { x: 0, y: 0 }

els.remoteCanvas.addEventListener('mousedown', (e) => {
  if (!remoteWs) return
  remotePointerDown = true
  const rect = els.remoteCanvas.getBoundingClientRect()
  remoteLastPos = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  sendRemotePointer('down', remoteLastPos.x, remoteLastPos.y)
})

els.remoteCanvas.addEventListener('mousemove', (e) => {
  if (!remoteWs || !remotePointerDown) return
  const rect = els.remoteCanvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  remoteLastPos = { x, y }
  sendRemotePointer('move', x, y)
})

els.remoteCanvas.addEventListener('mouseup', () => {
  if (!remoteWs) return
  remotePointerDown = false
  sendRemotePointer('up', remoteLastPos.x, remoteLastPos.y)
})

els.remoteCanvas.addEventListener('mouseleave', () => {
  if (!remoteWs) return
  remotePointerDown = false
  sendRemotePointer('up', remoteLastPos.x, remoteLastPos.y)
})

function sendRemotePointer(type, x, y) {
  if (!remoteWs || remoteWs.readyState !== WebSocket.OPEN) return
  remoteWs.send(JSON.stringify({ type: 'vnc-input', data: btoa(JSON.stringify({ type, x, y })) }))
}

// Keyboard for remote
document.addEventListener('keydown', (e) => {
  if (activeView !== 'remote' || !remoteWs) return
  remoteWs.send(JSON.stringify({ type: 'vnc-input', data: btoa(JSON.stringify({ type: 'key', key: e.code, down: true })) }))
})

document.addEventListener('keyup', (e) => {
  if (activeView !== 'remote' || !remoteWs) return
  remoteWs.send(JSON.stringify({ type: 'vnc-input', data: btoa(JSON.stringify({ type: 'key', key: e.code, down: false })) }))
})

els.btnDisconnectRemote.addEventListener('click', () => {
  if (remoteWs) remoteWs.close()
  remoteWs = null
  showView('welcome')
})

// APK Install Modal
els.btnInstallApk.addEventListener('click', () => {
  els.apkFileInput.click()
})

els.apkFileInput.addEventListener('change', () => {
  els.btnConfirmApk.disabled = !els.apkFileInput.files.length
})

els.btnCancelApk.addEventListener('click', () => {
  els.modalApk.hidden = true
  els.apkFileInput.value = ''
  els.btnConfirmApk.disabled = true
})

els.btnConfirmApk.addEventListener('click', async () => {
  if (!selectedDevice || !els.apkFileInput.files.length) return
  const file = els.apkFileInput.files[0]
  
  // For demo, we'd need to upload the file first
  // This is a simplified version - in real app, upload to server temp dir first
  toast('APK yükleme: Dosya sunucuya yüklenmeli (demo kısıtlama)')
  els.modalApk.hidden = true
  els.apkFileInput.value = ''
  els.btnConfirmApk.disabled = true
})

// Toolbar actions
els.btnRefreshApps.addEventListener('click', loadApps)
els.btnRefreshLogs.addEventListener('click', loadLogs)
els.btnClearLogs.addEventListener('click', () => { els.logOutput.textContent = '' })
els.btnRunShell.addEventListener('click', runShell)
els.btnListFiles.addEventListener('click', loadFiles)

els.btnPullFile.addEventListener('click', async () => {
  // Would need file selection UI
  toast('Dosya çekme: Seçili dosya için çift tıklayın')
})

els.btnPushFile.addEventListener('click', () => {
  toast('Dosya gönderme: Demo kısıtlama')
})

els.refreshDevices.addEventListener('click', loadDevices)
els.logFilter.addEventListener('change', loadLogs)
els.shellCmd.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runShell()
})

// Initialize
async function init() {
  setConnectionStatus(true)
  await loadDevices()
  
  // Auto-refresh devices every 10s
  setInterval(loadDevices, 10000)
}

init()