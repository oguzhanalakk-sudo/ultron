import { createConnection } from 'node:net'

export const defaultInventoryPorts = [22, 53, 80, 443, 445, 3000, 3306, 5000, 5432, 5433, 5672, 6379, 8000, 8080, 8443, 9090, 9200, 11211, 15672, 27017]

function parseIPv4(value: string) {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) throw new Error('Yalnızca geçerli IPv4 ağ kapsamları kabul edilir.')
  return parts.reduce((result, part) => (result * 256 + Number(part)) >>> 0, 0)
}

function formatIPv4(value: number) {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

function isPrivateOrLoopback(ip: string) {
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

export function parseAuthorizedPrivateCidr(cidr: string) {
  if (typeof cidr !== 'string' || cidr.length > 64) throw new Error('Ağ kapsamı geçersiz.')
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/.exec(cidr.trim())
  if (!match) throw new Error('Hedefi IPv4 CIDR biçiminde belirtin; örneğin 192.168.1.0/29.')
  const prefix = Number(match[2])
  const address = parseIPv4(match[1])
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (address & mask) >>> 0
  if (network !== address) throw new Error('CIDR adresi ağ başlangıcı olmalı; host adresine göre kapsam genişletilmedi.')
  const size = 2 ** (32 - prefix)
  if (size > 16) throw new Error('Tek taramada en fazla 16 özel ağ adresine izin verilir; daha küçük bir CIDR kullanın.')
  const hosts = prefix >= 31 ? Array.from({ length: size }, (_, index) => formatIPv4(network + index)) : Array.from({ length: size - 2 }, (_, index) => formatIPv4(network + index + 1))
  if (!hosts.length || hosts.some((host) => !isPrivateOrLoopback(host))) throw new Error('Yalnızca RFC1918 özel IPv4 ağları veya tek bir loopback adresi taranabilir.')
  if (hosts.some((host) => host.startsWith('127.') && (hosts.length !== 1 || prefix !== 32))) throw new Error('Loopback kapsamı yalnızca tek bir /32 host olabilir.')
  return hosts
}

export function normalizeInventoryPorts(value: unknown) {
  if (value === undefined) return [...defaultInventoryPorts]
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) throw new Error('1 ile 24 arasında port numarası verin.')
  const ports = [...new Set(value.map((port) => Number(port)))]
  if (ports.length !== value.length || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Portlar benzersiz 1–65535 tam sayıları olmalı.')
  return ports
}

function isOpen(host: string, port: number, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const socket = createConnection({ host, port })
    const finish = (open: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

export async function scanPrivateTcpInventory(cidr: string, requestedPorts?: unknown) {
  const hosts = parseAuthorizedPrivateCidr(cidr)
  const ports = normalizeInventoryPorts(requestedPorts)
  const tasks = hosts.flatMap((host) => ports.map((port) => ({ host, port })))
  const openPorts: { host: string; port: number }[] = []
  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor++
      if (index >= tasks.length) return
      const target = tasks[index]
      if (await isOpen(target.host, target.port, 650)) openPorts.push(target)
    }
  }
  await Promise.all(Array.from({ length: Math.min(24, tasks.length) }, () => worker()))
  return { target: cidr, hostsScanned: hosts.length, portsTested: ports, openPorts: openPorts.sort((a, b) => a.host.localeCompare(b.host, 'en') || a.port - b.port), completedAt: new Date().toISOString() }
}
