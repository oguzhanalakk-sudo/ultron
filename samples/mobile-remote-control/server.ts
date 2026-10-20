import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const PUBLIC_DIR = join(__dirname, 'public')
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5179
const HOST = process.env.HOST || '127.0.0.1'

interface AdbDevice {
  serial: string
  state: 'device' | 'unauthorized' | 'offline'
  model?: string
  androidVersion?: string
}

interface RemoteDesktopSession {
  id: string
  type: 'vnc' | 'rdp' | 'custom'
  host: string
  port: number
  password?: string
  ws: WebSocket
  targetProcess?: ReturnType<typeof spawn>
}

const adbDevicesCache: AdbDevice[] = []
const activeSessions = new Map<string, RemoteDesktopSession>()

// ADB yardımcı fonksiyonları
function runAdb(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const adbPath = process.env.ADB_PATH || 'adb'
    const child = execFile(adbPath, args, { timeout: 10000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: error?.code ?? 0
      })
    })
  })
}

async function listAdbDevices(): Promise<AdbDevice[]> {
  const result = await runAdb(['devices', '-l'])
  const lines = result.stdout.trim().split('\n').slice(1)
  const devices: AdbDevice[] = []
  
  for (const line of lines) {
    if (!line.trim()) continue
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2) {
      const serial = parts[0]
      const state = parts[1] as AdbDevice['state']
      const modelMatch = line.match(/model:(\S+)/)
      const androidMatch = line.match(/android:(\S+)/)
      devices.push({
        serial,
        state,
        model: modelMatch?.[1],
        androidVersion: androidMatch?.[1]
      })
    }
  }
  return devices
}

async function adbShell(serial: string, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return runAdb(['-s', serial, 'shell', command])
}

async function adbScreencap(serial: string): Promise<Buffer> {
  const result = await runAdb(['-s', serial, 'exec-out', 'screencap', '-p'])
  return Buffer.from(result.stdout, 'binary')
}

async function adbInput(serial: string, type: 'tap' | 'swipe' | 'text' | 'key', args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return runAdb(['-s', serial, 'shell', 'input', type, ...args])
}

async function adbInstall(serial: string, apkPath: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return runAdb(['-s', serial, 'install', '-r', apkPath])
}

async function adbPull(serial: string, remotePath: string, localPath: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return runAdb(['-s', serial, 'pull', remotePath, localPath])
}

async function adbPush(serial: string, localPath: string, remotePath: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return runAdb(['-s', serial, 'push', localPath, remotePath])
}

async function adbLogcat(serial: string, filters?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const args = ['-s', serial, 'logcat', '-d', '-t', '100']
  if (filters) args.push(filters)
  return runAdb(args)
}

// WebSocket tabanlı ekran akışı
function startScreenStream(serial: string, ws: WebSocket, fps = 10) {
  const interval = setInterval(async () => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(interval)
      return
    }
    try {
      const imageBuffer = await adbScreencap(serial)
      // Basit JPEG/PNG base64 encoding
      const base64 = imageBuffer.toString('base64')
      ws.send(JSON.stringify({
        type: 'screen',
        data: base64,
        timestamp: Date.now()
      }))
    } catch (error) {
      console.error('Screencap error:', error)
    }
  }, 1000 / fps)

  ws.on('close', () => clearInterval(interval))
}

// VNC/RDP proxy (basit TCP proxy)
function startVncProxy(session: RemoteDesktopSession) {
  const { ws, host, port, password } = session
  
  const tcpSocket = require('node:net').createConnection({ host, port }, () => {
    console.log(`VNC connected to ${host}:${port}`)
    
    // VNC handshake - RFB protocol
    if (password) {
      // Basit VNC auth (gerçek uygulamada daha güvenli olmalı)
      tcpSocket.write(Buffer.from([1])) // Client init - shared
    }
  })

  tcpSocket.on('data', (data: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'vnc-data',
        data: data.toString('base64')
      }))
    }
  })

  tcpSocket.on('error', (err: Error) => {
    console.error('VNC socket error:', err)
    ws.close()
  })

  tcpSocket.on('close', () => {
    ws.close()
  })

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'vnc-input') {
        tcpSocket.write(Buffer.from(msg.data, 'base64'))
      }
    } catch (e) {
      // Binary VNC data
      tcpSocket.write(data)
    }
  })

  ws.on('close', () => {
    tcpSocket.destroy()
  })

  session.targetProcess = tcpSocket
}

// HTTP istek işleyici
async function handleRequest(req: any, res: any) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const path = url.pathname
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    // API endpoints
    if (path === '/api/devices' && req.method === 'GET') {
      const devices = await listAdbDevices()
      adbDevicesCache.length = 0
      adbDevicesCache.push(...devices)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ devices }))
      return
    }

    if (path === '/api/devices/refresh' && req.method === 'POST') {
      const devices = await listAdbDevices()
      adbDevicesCache.length = 0
      adbDevicesCache.push(...devices)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ devices, refreshed: true }))
      return
    }

    if (path.startsWith('/api/devices/') && req.method === 'POST') {
      const serial = path.split('/api/devices/')[1].split('/')[0]
      const action = path.split('/api/devices/')[1].split('/')[1]
      
      let body = ''
      for await (const chunk of req) body += chunk
      const params = body ? JSON.parse(body) : {}

      let result
      switch (action) {
        case 'shell':
          result = await adbShell(serial, params.command || '')
          break
        case 'tap':
          result = await adbInput(serial, 'tap', [params.x.toString(), params.y.toString()])
          break
        case 'swipe':
          result = await adbInput(serial, 'swipe', [params.x1.toString(), params.y1.toString(), params.x2.toString(), params.y2.toString(), (params.duration || 300).toString()])
          break
        case 'text':
          result = await adbInput(serial, 'text', [params.text.replace(/ /g, '%s')])
          break
        case 'key':
          result = await adbInput(serial, 'key', [params.keycode.toString()])
          break
        case 'screencap':
          const imageBuffer = await adbScreencap(serial)
          res.writeHead(200, { 'Content-Type': 'image/png' })
          res.end(imageBuffer)
          return
        case 'install':
          result = await adbInstall(serial, params.apkPath)
          break
        case 'pull':
          result = await adbPull(serial, params.remotePath, params.localPath)
          break
        case 'push':
          result = await adbPush(serial, params.localPath, params.remotePath)
          break
        case 'logcat':
          result = await adbLogcat(serial, params.filter)
          break
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unknown action' }))
          return
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }

    if (path === '/api/remote-desktop/connect' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const { type, host, port, password, id } = JSON.parse(body)
      
      const sessionId = id || `rd-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
      
      // WebSocket upgrade bekliyoruz, bu endpoint sadece session oluşturur
      activeSessions.set(sessionId, {
        id: sessionId,
        type: type || 'vnc',
        host,
        port: parseInt(port),
        password,
        ws: null as any
      })
      
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessionId, wsUrl: `ws://${HOST}:${PORT}/ws/remote-desktop/${sessionId}` }))
      return
    }

    // Static files
    let filePath = path === '/' ? '/index.html' : path
    filePath = join(PUBLIC_DIR, filePath)
    
    // Security: prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    try {
      const content = await readFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase()
      const mimeTypes: Record<string, string> = {
        html: 'text/html; charset=utf-8',
        js: 'application/javascript; charset=utf-8',
        css: 'text/css; charset=utf-8',
        png: 'image/png',
        jpg: 'image/jpeg',
        ico: 'image/x-icon',
        json: 'application/json',
        svg: 'image/svg+xml'
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext || ''] || 'application/octet-stream' })
      res.end(content)
    } catch {
      res.writeHead(404)
      res.end('Not Found')
    }
  } catch (error) {
    console.error('Request error:', error)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(error) }))
  }
}

const server = createServer(handleRequest)
const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const path = url.pathname

  // Screen streaming WebSocket
  if (path.startsWith('/ws/screen/')) {
    const serial = path.split('/ws/screen/')[1]
    console.log(`Screen stream started for ${serial}`)
    startScreenStream(serial, ws)
    return
  }

  // Remote desktop WebSocket
  if (path.startsWith('/ws/remote-desktop/')) {
    const sessionId = path.split('/ws/remote-desktop/')[1]
    const session = activeSessions.get(sessionId)
    
    if (!session) {
      ws.close(4004, 'Session not found')
      return
    }

    console.log(`Remote desktop session ${sessionId} connected`)
    session.ws = ws
    startVncProxy(session)
    return
  }

  ws.close(4004, 'Unknown WebSocket path')
})

server.listen(PORT, HOST, () => {
  console.log(`Mobile Remote Control server listening at http://${HOST}:${PORT}`)
  console.log(`WebSocket endpoints:`)
  console.log(`  - ws://${HOST}:${PORT}/ws/screen/<serial>`)
  console.log(`  - ws://${HOST}:${PORT}/ws/remote-desktop/<sessionId>`)
})