import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { normalizeInventoryPorts, parseAuthorizedPrivateCidr, scanPrivateTcpInventory } from '../electron/network-inventory.ts'

test('ağ kapsamı özel IPv4 ve en fazla 16 adresle sınırlıdır', () => {
  assert.deepEqual(parseAuthorizedPrivateCidr('192.168.1.0/29'), ['192.168.1.1', '192.168.1.2', '192.168.1.3', '192.168.1.4', '192.168.1.5', '192.168.1.6'])
  assert.deepEqual(parseAuthorizedPrivateCidr('127.0.0.1/32'), ['127.0.0.1'])
  assert.throws(() => parseAuthorizedPrivateCidr('8.8.8.0/29'), /özel IPv4/)
  assert.throws(() => parseAuthorizedPrivateCidr('192.168.1.0/24'), /en fazla 16/)
  assert.throws(() => parseAuthorizedPrivateCidr('192.168.1.4/29'), /ağ başlangıcı/)
  assert.throws(() => parseAuthorizedPrivateCidr('127.0.0.0/30'), /Loopback/)
})

test('port listesi doğrulanır ve TCP envanteri yalnızca açık port bilgisini raporlar', async () => {
  const server = createServer((socket) => socket.end())
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    assert.deepEqual(normalizeInventoryPorts([address.port]), [address.port])
    assert.throws(() => normalizeInventoryPorts([0]), /benzersiz/)
    assert.throws(() => normalizeInventoryPorts(Array.from({ length: 25 }, (_, index) => index + 1)), /1 ile 24/)
    const report = await scanPrivateTcpInventory('127.0.0.1/32', [address.port])
    assert.deepEqual(report.openPorts, [{ host: '127.0.0.1', port: address.port }])
    assert.deepEqual(Object.keys(report).sort(), ['completedAt', 'hostsScanned', 'openPorts', 'portsTested', 'target'])
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})
