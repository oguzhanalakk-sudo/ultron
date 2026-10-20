// Yerel dosya eylem hızlı yolu ("hızlı profil"): masaüstü/indirilenler gibi doğal Türkçe
// hedefli dosya açma/find isteklerini MODEL ÇAĞRISI OLMADAN belirleme mantığı.
// Saf işlevler; dosya sistemine, ağa ve Electron API'lerine erişmez. Birim testleri: tests/local-file-actions.test.ts

export type UserFolderHint = 'Desktop' | 'Documents' | 'Downloads' | 'Pictures' | 'Videos' | 'Music'

export const userFolderHintNames: Record<UserFolderHint, string> = {
  Desktop: 'masaüstü',
  Documents: 'belgeler',
  Downloads: 'indirilenler',
  Pictures: 'resimler',
  Videos: 'videolar',
  Music: 'müzik',
}

// Doğrudan kullanıcı klasörü kalıpları: istek açıkça bir kullanıcı klasörünü işaret etmeli.
const userFolderPatterns: Array<{ pattern: RegExp; hint: UserFolderHint }> = [
  { pattern: /masa\s*üst(?:[üu]n?d[eé]|[üu]mde|ü|ünde)|desktop/iu, hint: 'Desktop' },
  { pattern: /indirdi[ğg]im(?:\s*s[oö]n)?|indirilen(?:ler(?:de|deki|leri)?)?|downloads?\s*klas[öo]r[üu]/iu, hint: 'Downloads' },
  { pattern: /belgeler(?:im(?:de|deki)?)?|documents/iu, hint: 'Documents' },
  { pattern: /resim(?:ler(?:im(?:de|deki)?)?)?|pictures/iu, hint: 'Pictures' },
  { pattern: /video(?:lar(?:ım(?:da|daki)?)?)?/iu, hint: 'Videos' },
  { pattern: /m[üu]z[iİı]k(?:ler(?:im(?:de|daki)?)?)?/iu, hint: 'Music' },
]

// Açma/bulma eylem fiili: yalnızca doğal hızlı eylem kalıpları; "yap/oluştur" gibi üretim modellerine genelleme yok.
const fastOpenPatterns: Array<{ pattern: RegExp; action: 'open' | 'find' }> = [
  { pattern: /(?:dosya(?:y[ıi]|s[ıi]n[ıi]|y[ıi])?|pdf(?:'y?i|yi)|klas[öo]r[üu]n?[üu])\s*(?:a[çc]|g[öo]ster)/iu, action: 'open' },
  { pattern: /(?:a[çc]|g[öo]ster)\s+(?:masa\s*üst[üu]ndek[i]|indirilen(?:ler(?:de)?k[i])?)/iu, action: 'open' },
  { pattern: /(?:b[üu]l|bul)(?:\s+ve\s+)?(?:a[çc])/iu, action: 'open' },
  { pattern: /\b(?:b[uü]l|listele|g[öo]ster)\b/iu, action: 'find' },
]

// Otomatik açılmayacak dosya türleri: çalıştırılabilir/komut/bağlantı türleri yürütme riski taşır.
const deniedExtensions = new Set([
  'exe', 'bat', 'cmd', 'com', 'scr', 'vbs', 'vbe', 'ps1', 'ps2', 'psm1', 'msi', 'msp', 'mst', 'lnk',
  'js', 'jse', 'wsf', 'wsh', 'hta', 'sh', 'py', 'rb', 'pl', 'apk', 'jar', 'iso', 'img', 'vhd', 'vhdx', 'reg',
])

// Varsayılan uygulamayla açılmasına izin verilen türler: belge, medya, görsel, veri ve metin.
const allowedExtensions = new Set([
  'pdf', 'txt', 'md', 'rtf', 'csv', 'tsv', 'log', 'ini', 'yaml', 'yml', 'xml', 'json',
  'doc', 'docx', 'odt', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'tif', 'tiff', 'svg', 'svgz', 'heic',
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'wma', 'aac',
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'm4v',
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz',
  'html', 'htm', 'css', 'mht',
])

export type DetectedFastFileAction = {
  hint: UserFolderHint
  action: 'open' | 'find'
  strength: number
}

export type LocalTextFileOperation =
  | { action: 'create'; fileName: string; content: string; hint?: UserFolderHint }
  | { action: 'read'; fileName: string; hint?: UserFolderHint }
  | { action: 'replace'; fileName: string; search: string; replacement: string; hint?: UserFolderHint }

const textFileName = (text: string) => {
  const match = /(?:^|\s)([\p{L}\p{N}][\p{L}\p{N}_-]{0,100}\.(?:txt|md|csv|json|log))\b/iu.exec(text)
  return match?.[1]?.trim() ?? null
}

// Açık, düşük riskli metin dosyası cümlelerini model araç çağrısına gerek bırakmadan
// yönlendirir. Belirsiz, ikili, silme ve kod üretimi istekleri burada bilinçli olarak yoktur.
export function parseLocalTextFileOperation(request: string): LocalTextFileOperation | null {
  const text = String(request ?? '').trim()
  if (!text || text.length > 700 || /\b(?:sil|kaldır|taşı|kopyala|çalıştır|\.exe|\.bat|\.cmd|\.ps1)\b/iu.test(text)) return null
  const fileName = textFileName(text)
  if (!fileName) return null
  const hint = userFolderPatterns.find((item) => item.pattern.test(text))?.hint
  const create = /\b(?:oluştur|yarat|create)\b/iu.test(text)
  const read = /\b(?:oku|okur musun|içeriğini göster|içeriğini söyle|read)\b/iu.test(text)
  const replace = /\b(?:değiştir|replace)\b/iu.test(text)
  if (create) {
    const content = /(?:içine|içeriğine|içeriği(?:ne)?)[\s:"“']+(.+?)(?:\s+(?:yaz|ekle|kaydet)|[.。]?$)/iu.exec(text)?.[1]?.trim()
    if (!content || content.length > 20_000) return null
    return { action: 'create', fileName, content, hint }
  }
  if (replace) {
    const change = /dosyasındaki\s+["“']?(.+?)["”']?\s+kelimesini\s+["“']?(.+?)["”']?\s+(?:olarak\s+)?değiştir/iu.exec(text)
    if (!change?.[1]?.trim() || !change[2]?.trim() || change[1].length > 2_000 || change[2].length > 2_000) return null
    return { action: 'replace', fileName, search: change[1].trim(), replacement: change[2].trim(), hint }
  }
  return read ? { action: 'read', fileName, hint } : null
}

// İstek hızlı yola uygun mu? Uygunluk ölçülür: kullanıcı klasörü + eylem fiili birlikte
// açıkça geçmiyorsa null (model ajanına devredilir); hafif uyumda daha uzun metinler reddedilir.
export function detectLocalFileFastPath(request: string): DetectedFastFileAction | null {
  const text = String(request ?? '').trim()
  if (!text || text.length > 300) return null
  const folderMatch = userFolderPatterns.find((item) => item.pattern.test(text))
  if (!folderMatch) return null
  const actionMatch = fastOpenPatterns.find((item) => item.pattern.test(text))
  if (!actionMatch) return null
  // "oluştur/sil/değiştir/kopyala" gibi üretici-yıkıcı niyetler hızlı yola girmez; model ajanına devredilir.
  if (/(?:\b(?:sil|kald[ıi]r|olu[şs]tur|ta[şş]?[ıi][nı]?|kopyala|yeniden\s+adland[ıi]r|d[üu]zenle)\b|dosyaya\s+yaz)/iu.test(text)) return null
  let strength = 1
  if (actionMatch.action === 'open') strength += 1
  if (text.length <= 120) strength += 1
  if (/\.(?:pdf|docx?|xlsx?|pptx?|txt|png|jpe?g|mp4|zip)\b/iu.test(text)) strength += 1
  return { hint: folderMatch.hint, action: actionMatch.action, strength }
}

export const extensionPolicy = {
  denied: deniedExtensions,
  allowed: allowedExtensions,
}

// Varsayılan uygulamayla açma izni: önce red listesi, sonra açık izin listesi; bilinmeyen tür reddedilir.
export function isOpenableFileExtension(extension: string): boolean {
  const ext = String(extension ?? '').replace(/^\./, '').toLowerCase()
  if (!ext) return false
  if (deniedExtensions.has(ext)) return false
  return allowedExtensions.has(ext)
}

export type RankableHit = { name: string; path: string; matchType?: string; sizeBytes?: number; modifiedAt?: string }

export type FastPathDecision =
  | { kind: 'open'; hit: RankableHit }
  | { kind: 'ambiguous'; top: RankableHit[] }
  | { kind: 'none' }

// Bir eşleşme: aç; birden fazla: üç teklifi sıralı geri döndür (soru sorması yolu kesinleştiğinde);
// hiçbiri: 'none' (kapsamı daraltmak/model yoluna geçmek için).
export function selectFastPathHit(hits: RankableHit[]): FastPathDecision {
  const list = (hits ?? []).filter((hit) => hit?.path)
  if (list.length === 0) return { kind: 'none' }
  if (list.length === 1) return { kind: 'open', hit: list[0] }
  return { kind: 'ambiguous', top: list.slice(0, 3).map((hit) => ({ name: hit.name, path: hit.path, modifiedAt: hit.modifiedAt, sizeBytes: hit.sizeBytes })) }
}

// Kullanıcının isteğindeki dosya adı terimleri küçük Harf ve uzantıdan temizlenip kullanılabilir.
export function extractPlainNameTerms(nameTerms: string[]): string[] {
  return (nameTerms ?? [])
    .map((term) => String(term ?? '').trim())
    .filter((term) => term.length >= 2)
    .map((term) => term.replace(/\.[a-z0-9]{1,6}$/iu, '').trim() || term.replace(/\s+/g, ' '))
    .filter((term) => term.length >= 2)
    .slice(0, 5)
}
