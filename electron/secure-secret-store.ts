import { promises as fs } from 'node:fs'
import path from 'node:path'

export const BRAVE_SEARCH_API_KEY_ENV = 'ULTRON_BRAVE_SEARCH_API_KEY'

export type SecureStringStorage = {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(value: string): Promise<Buffer>
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

type EncryptedSecretFile = { version: 1; encrypted: string }

export async function readEncryptedSecret(filePath: string, storage: SecureStringStorage): Promise<string | null> {
  let raw: string
  try { raw = await fs.readFile(filePath, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('Şifreli arama anahtarı dosyası okunamadı.')
  }
  if (!await storage.isAsyncEncryptionAvailable()) throw new Error('İşletim sisteminin güvenli anahtar deposu kullanılamıyor; kayıtlı arama anahtarı açılamadı.')
  try {
    const parsed = JSON.parse(raw) as Partial<EncryptedSecretFile>
    if (parsed.version !== 1 || typeof parsed.encrypted !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(parsed.encrypted)) {
      throw new Error('invalid')
    }
    const encrypted = Buffer.from(parsed.encrypted, 'base64')
    if (!encrypted.length) throw new Error('invalid')
    let decrypted = await storage.decryptStringAsync(encrypted)
    if (decrypted.shouldReEncrypt) decrypted = await storage.decryptStringAsync(encrypted)
    const secret = decrypted.result
    if (!secret.trim()) throw new Error('invalid')
    return secret
  } catch {
    throw new Error('Şifreli arama anahtarı çözülemedi; anahtarı yeniden kaydedin.')
  }
}

export async function writeEncryptedSecret(filePath: string, secret: string, storage: SecureStringStorage): Promise<void> {
  if (!await storage.isAsyncEncryptionAvailable()) throw new Error('İşletim sistemi güvenli anahtar deposu hazır değil; anahtar güvenli biçimde saklanmadı.')
  const encrypted = await storage.encryptStringAsync(secret)
  if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error('İşletim sistemi arama anahtarını şifreleyemedi.')
  const payload: EncryptedSecretFile = { version: 1, encrypted: encrypted.toString('base64') }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporary, filePath)
  } finally {
    await fs.unlink(temporary).catch(() => undefined)
  }
}

export async function deleteEncryptedSecret(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw new Error('Kayıtlı arama anahtarı silinemedi.')
  })
}
