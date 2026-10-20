// Ultron sohbet modülü: doğal konuşma sınıflandırması, açık hafıza istekleri,
// geri bildirim algılama, kontrollü bağlam yönetimi ve sohbet sistem istemi.
// Saf işlevler; ağ erişimi yoktur.
import type { ChatMessage, LocalAiStats, LocalHardware, MemoryEntry, ProjectMemory, UserProfile } from './shared.ts'
import { memoryKindLabels } from './memory-store.ts'

// Kontrollü bağlam bütçesi: geçmiş hem mesaj sayısıyla hem toplam karakterle sınırlanır.
export const conversationContextLimits = { maxMessages: 20, maxChars: 24_000 }

// Model bağlamına gönderilecek geçmişi seçer. En yeni mesajlar korunur; mesaj sayısı
// veya karakter bütçesi aşılınca eskiler düşürülür. Geçmiş her zaman bir kullanıcı
// mesajıyla başlar ve en az son mesaj her koşulda gönderilir; böylece uzun sohbetlerde
// gereksiz büyük geçmiş tekrar tekrar modele taşınmaz.
export function trimConversationContext(messages: ChatMessage[], options: { maxMessages?: number; maxChars?: number } = {}): ChatMessage[] {
  const maxMessages = Math.max(1, Math.floor(options.maxMessages ?? conversationContextLimits.maxMessages))
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? conversationContextLimits.maxChars))
  const kept: ChatMessage[] = []
  let chars = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (kept.length >= maxMessages) break
    if (kept.length > 0 && chars + message.content.length > maxChars) break
    kept.push(message)
    chars += message.content.length
  }
  kept.reverse()
  while (kept.length > 1 && kept[0].role !== 'user') kept.shift()
  return kept
}

export type ConversationKind = 'chat' | 'task'

export type DesktopLaunchRequest = {
  target: 'hesap makinesi' | 'not defteri' | 'dosya gezgini' | 'paint' | 'denetim paneli' | 'görev yöneticisi' | 'ekran görüntüsü aracı'
}

// JavaScript \b yalnız ASCII "kelime" karakterlerini tanır; Türkçe ç/ş içeren
// fiillerde sınır kaçırmamak için burada boşluk/noktalama sonunu da kabul ediyoruz.
const desktopLaunchVerb = /(?:aç(?:ar)?|başlat|çalıştır|\bopen\b|\blaunch\b|\bstart\b)/iu

/** Açık bir Windows uygulaması başlatma isteğini sohbetten ayırır. */
export function parseDesktopLaunchRequest(request: string): DesktopLaunchRequest | null {
  if (!desktopLaunchVerb.test(request)) return null
  const text = request.toLocaleLowerCase('tr-TR')
  if (/hesap makinesi|\bcalculator\b|\bcalc\b/.test(text)) return { target: 'hesap makinesi' }
  if (/not defteri|\bnotepad\b|metin editörü/.test(text)) return { target: 'not defteri' }
  if (/dosya gezgini|file explorer|\bexplorer\b/.test(text)) return { target: 'dosya gezgini' }
  if (/\bpaint\b|\bmspaint\b/.test(text)) return { target: 'paint' }
  if (/denetim paneli|control panel/.test(text)) return { target: 'denetim paneli' }
  if (/görev yöneticisi|task manager/.test(text)) return { target: 'görev yöneticisi' }
  if (/ekran görüntüsü aracı|snipping tool|snippingtool/.test(text)) return { target: 'ekran görüntüsü aracı' }
  return null
}

export function isApplicationLaunchRequest(request: string): boolean {
  return desktopLaunchVerb.test(request) && /uygulama|program|hesap makinesi|calculator|calc|not defteri|notepad|dosya gezgini|explorer|paint|denetim paneli|görev yöneticisi|snipping/i.test(request)
}

// Eylem bildiren fiiller: bunlardan biri geçiyorsa istek görev olarak yürütülür.
const actionIntent = /düzelt|oluştur|(?<![\p{L}\p{N}])yaz(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])yap(?![\p{L}\p{N}])|değiştir|güncelle|(?<![\p{L}\p{N}])ekle(?![\p{L}\p{N}])|kaldır|(?<![\p{L}\p{N}])sil(?![\p{L}\p{N}])|çalıştır|(?<![\p{L}\p{N}])kur(?![\p{L}\p{N}])|derle|analiz|incele|araştır|refactor|implement|(?<![\p{L}\p{N}])fix(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])create(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])write(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])edit(?![\p{L}\p{N}])|modify|(?<![\p{L}\p{N}])update(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])install(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])run(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])build(?![\p{L}\p{N}])|debug|deploy|hazırla|geliştir|iyileştir|yenile|düzenle|tasarla|çevir|dönüştür|optimize|artır|azalt|başlat|durdur|(?<![\p{L}\p{N}])dene(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])onar(?![\p{L}\p{N}])|temizle|(?<![\p{L}\p{N}])push(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])commit(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])pull(?![\p{L}\p{N}])|yükle|indir(?![\p{L}\p{N}])|kurulum/iu

// Teknik konular: dosya/kod/proje gibi nesneler geçiyorsa istek görev kabul edilir.
const technicalSubject = /dosya|kod|proje|fonksiyon|class(?![\p{L}\p{N}])|component|hatası|hatayı|bug(?![\p{L}\p{N}])|test|api(?![\p{L}\p{N}])|veritabanı|database|(?<![\p{L}\p{N}])git(?![\p{L}\p{N}])|terminal|komut|script|paket|apk(?![\p{L}\p{N}])|exe(?![\p{L}\p{N}])|sunucu|server|veri tabanı|uygulama|(?<![\p{L}\p{N}])pdf(?![\p{L}\p{N}])|excel|docx|word belge|zip arşiv|arşiv|yinelen/iu

// Yazılım/edilgen yetenek sorguları: "yüklü programlar", "kod editörüm", "eklenti"
// gibi ifadeler görev yoluna (envanter/uygulama eylemi) düşer. 'program' tek kelimesi
// gündelik dilde ("bir program mısın") geçtiği için kalıplar bağlam şartlıdır.
const capabilitySubject = /eklenti|plugin|kod edit[öo]r|hangi edit[öo]r|edit[öo]rler(?:im|i)|y[üu]kl[üu]\s+(?:program|uygulama|yaz[ıi]l[ıi]m)|kurulu\s+(?:program|uygulama|yaz[ıi]l[ıi]m)|(?:programlar|uygulamalar|yaz[ıi]l[ıi]mlar)(?:[ıi])?\s+(?:var\s+m[ıi]|neler|listele|listesi|envanter)|bilgisayar[ıi]mda\s+(?:ne|hangi|neler)|envanter|eksik\s+yetenek|yetene[ğg]im/iu

// Göreve devam/deneme ifadeleri sohbet sayılmaz.
const taskControl = /(?<![\p{L}\p{N}])(devam|sürdür|resume|continue|yeniden|tekrar|başla|bitir)(?![\p{L}\p{N}])/iu

// Kısa web araştırma istekleri teknik konu içermese bile görev yoluna girmelidir.
// Aksi hâlde "Google'da ara" veya "bu siteye gir" sohbet olarak sınıflanır ve
// web araçları modele sunulmadan yalnızca metin yanıtı üretilebilir.
const researchAction = /(?:google(?:'da|’da|da)?|internette|internetten|web(?:'de|’de|de)?|siteye|web sitesine|url(?:'yi|’yi|yi)?|sayfayı|sayfaya)\s*(?:ara|araştır|bul|gir|aç|incele|oku|kontrol et|bak)/iu

// Doğal karşılama, hâl hatır ve kimlik ifadeleri.
const conversational = /merhaba|selamlar|(?<![\p{L}\p{N}])selam(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])hey(?![\p{L}\p{N}])|günaydın|iyi akşamlar|iyi geceler|nasılsın|nasılsınız|naber|ne haber|nasıl gidiyor|teşekkür|sağ ?ol|eyvallah|hoşça kal|görüşürüz|rica ederim|kimsin|adın ne|ismin ne|sen kimsin|kendini tanıt|neler yapabilirsin|ne yapabilirsin|yeteneklerin|neler yapabiliyorsun|sohbet edelim|biraz sohbet|bunu beğendim|çok iyi|harika|mükemmel|süper|aferin|üzgünüm|yoruldum|sıkıldım|moralim|nasıl hissediyorsun|duyguların|ne düşünüyorsun|neden yavaş|niye yavaş|yavaş çalışıyorsun|hızın nasıl|ne durumdasın|durumun nasıl|iyi misin/iu

// Günlük dil, duygu durumu ve sosyal sohbet ifadeleri. Eylem fiilleri ve teknik konular
// bu kalıptan önce denetlendiği için gerçek görevler buraya takılmaz; amaç, uzun günlük
// cümlelerin yanlışlıkla görev yoluna düşmesini engellemektir.
const dailyLanguage = /sıkıl|sıkıc|sıkıntı|canım|yorul|yorgun|moral|hissett|hissed|hava|yağmur|yağıyor|piknik|hafta ?sonu|alb[üu]m|yürüyüş|film|dizi|müzik|şarkı|kitap|kahve|yemek|tatil|izledim|(?<![\p{L}\p{N}])m[ıiuü]s[ıiu]n(?:[ıiu]z)?(?![\p{L}\p{N}])|merak|(?<![\p{L}\p{N}])sence(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])anlat(?![\p{L}\p{N}])|mutlu|üzül|üzgün|üzücü|kızgın|sinirli|stres|ağrı|keyif|keyfi|geçmiş olsun|kolay gelsin|eline sağlık|tebrik|afiyet olsun|hayırlı olsun|acaba|galiba|sanırım/iu

export function classifyConversation(request: string): ConversationKind {
  const text = request.trim()
  if (!text) return 'task'
  if (parseDesktopLaunchRequest(text) || isApplicationLaunchRequest(text)) return 'task'
  if (detectExplicitMemoryRequest(text) || detectForgetRequest(text)) return 'chat'
  if (taskControl.test(text)) return 'task'
  if (researchAction.test(text) || /https?:\/\/\S+/iu.test(text)) return 'task'
  if (actionIntent.test(text)) return 'task'
  if (technicalSubject.test(text)) return 'task'
  if (capabilitySubject.test(text)) return 'task'
  if (detectFeedbackCorrection(text)) return 'chat'
  if (conversational.test(text) || dailyLanguage.test(text)) return 'chat'
  if (text.length <= 48 && !/\d/.test(text)) return 'chat'
  return 'task'
}

// "Şunu hatırla: ...", "not al: ...", "hafızaya kaydet: ..." gibi açık istekleri yakalar.
export function detectExplicitMemoryRequest(message: string): { kind: 'knowledge' | 'preference'; text: string } | null {
  const patterns = [
    /(?:şunları|şunu|bunu|bunları)?\s*hatırla(?![\p{L}\p{N}])\s*[::]?\s*(.+)/iu,
    /(?:not\s+al(?![\p{L}\p{N}])|not\s+et(?![\p{L}\p{N}])|not\s+düş(?![\p{L}\p{N}]))\s*[::]?\s*(.+)/iu,
    /(?<![\p{L}\p{N}])unutma(?![\p{L}\p{N}])\s*[::]?\s*(.+)/iu,
    /hafızaya\s+(?:kaydet|ekle|al)(?![\p{L}\p{N}])\s*[::]?\s*(.+)/iu,
    /(?<![\p{L}\p{N}])(?:remember|save\s+to\s+memory)(?![\p{L}\p{N}])\s*[::]?\s*(.+)/iu,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(message)
    const text = match?.[1]?.trim()
    if (text && text.length >= 3) {
      const preference = /tercih|her zaman|bundan sonra|asla|sevmiyorum|istemiyorum|seviyorum|kısaca|kısa tut|uzun anlat|detaylı anlat/iu.test(message)
      return { kind: preference ? 'preference' : 'knowledge', text: text.slice(0, 2000) }
    }
  }
  return null
}

// "Şunu unut: ..." isteğini yakalar (bilgiyi hafızadan silmek için).
export function detectForgetRequest(message: string): string | null {
  const match = /(?:şunu|bunu|şunları)?\s*unut(?!ma)(?![\p{L}\p{N}])\s*[::]?\s*(.+)/iu.exec(message)
  const target = match?.[1]?.trim()
  return target && target.length >= 3 ? target.slice(0, 200) : null
}

// Kullanıcının düzeltme/geri bildirim mesajlarını yakalar; otomatik öğrenme açıkken hafızaya yazılır.
export function detectFeedbackCorrection(message: string): { text: string } | null {
  const probe = message.replace(/değil\s*mi\s*\?/giu, ' ').replace(/isn'?t\s+it\s*\?/giu, ' ')
  const pattern = /(?:yanlış|hatalı|doğru değil|öyle değil|böyle değil|hata yaptın|yanlış yaptın|aslında şöyle|aslında şu|doğrusu şu|doğrusu şöyle|düzeltiyorum|(?<![\p{L}\p{N}])(?:wrong|incorrect|that'?s not right)(?![\p{L}\p{N}]))/iu
  if (!pattern.test(probe)) return null
  const text = message.trim().slice(0, 600)
  return text.length >= 5 ? { text } : null
}

const GIGABYTE = 1024 ** 3
const formatGigabytes = (bytes: number) => `${(bytes / GIGABYTE).toFixed(1)} GB`

export function describeRuntimeFacts(runtime: ChatRuntimeContext): string {
  const parts: string[] = [`Seçili yerel model: ${runtime.model}.`]
  if (runtime.hardware) {
    const gpu = runtime.hardware.gpu ? `${runtime.hardware.gpu}${runtime.hardware.gpuMemoryBytes ? ` (${formatGigabytes(runtime.hardware.gpuMemoryBytes)} VRAM)` : ''}` : 'görünür GPU yok'
    parts.push(`Donanım: ${runtime.hardware.cpu} (${runtime.hardware.cpuCores} çekirdek), ${formatGigabytes(runtime.hardware.memoryTotalBytes)} RAM, ${formatGigabytes(runtime.hardware.memoryFreeBytes)} boş; GPU: ${gpu}.`)
  }
  const stats = runtime.stats
  if (stats.lastMeasuredAt && stats.lastDurationMs !== null) {
    const tokens = stats.lastEvaluatedTokens !== null ? `, ${stats.lastEvaluatedTokens} token` : ''
    const speed = stats.lastTokensPerSecond !== null ? `, ${stats.lastTokensPerSecond.toFixed(1)} token/sn` : ''
    parts.push(`Son gerçek model ölçümü: ${stats.lastDurationMs} ms${tokens}${speed} (${stats.lastMeasuredAt}).`)
  } else {
    parts.push('Henüz gerçek model ölçümü kaydedilmedi.')
  }
  parts.push(`Bu oturumdaki model istekleri: ${stats.requests}, başarısız: ${stats.failedRequests}.`)
  if (runtime.projectName) parts.push(`Açık proje: ${runtime.projectName}.`)
  else parts.push('Şu anda açık bir proje klasörü yok.')
  if (runtime.taskNote) parts.push(runtime.taskNote)
  return parts.join(' ')
}

export type ChatRuntimeContext = {
  model: string
  stats: LocalAiStats
  hardware: LocalHardware | null
  projectName: string | null
  taskNote?: string | null
}

export function buildChatSystemPrompt(options: { profile: UserProfile; memory: MemoryEntry[]; projectMemory: ProjectMemory | null; runtime: ChatRuntimeContext }): string {
  const { profile, memory, projectMemory, runtime } = options
  const memoryLines = memory.length
    ? memory.map((entry) => `- [${memoryKindLabels[entry.kind]}] ${entry.text}`)
    : ['- Kayıtlı hafıza bilgisi yok.']
  const preferenceTexts = profile.instructions ? [profile.instructions] : []
  const projectLines = projectMemory
    ? [
        `Proje hafızası özeti: ${projectMemory.summary || 'kayıtlı özet yok'}`,
        projectMemory.technologies.length ? `Teknolojiler: ${projectMemory.technologies.slice(0, 12).join(', ')}` : '',
        projectMemory.knownIssues.length ? `Bilinen sorunlar: ${projectMemory.knownIssues.slice(0, 5).join('; ')}` : '',
      ].filter(Boolean)
    : []
  return [
    "Sen Ultron'sun: bu bilgisayarda tamamen yerel çalışan, Türkçe konuşan bir yapay zekâ asistanısın. Şu an sohbet modundasın; araç çağırma, dosya değiştirme veya komut çalıştırma yetkin yok. Bilgisayarda işlem gerektiren isteklerde bunu açıkça söyle ve kullanıcıya proje açıkken görev olarak isteyebileceğini belirt.",
    'Doğal, akıcı ve insan gibi konuş; Türkçe yaz, gerekmedikçe kısa yanıt ver, soru sorulduğunda net cevap ver. Bağlamı takip et ve gerektiğinde açıklayıcı soru sor. Emin olmadığın konularda belirsizliğini açıkça belirt; bilmediğin bilgiyi uydurma, ölçmediğin bir değeri veya yapmadığın bir işlemi iddia etme.',
    'Aşağıdaki hafıza kayıtları dışında geçmiş konuşmaları hatırladığını iddia etme. Hafızada olmayan bir şeyi hatırlıyormuş gibi davranma; "hatırlamıyorum" demek doğrudur.',
    ...(preferenceTexts.length ? [`Kullanıcının kalıcı talimatları ve iletişim tercihleri: ${preferenceTexts.join(' ')}`] : []),
    `Yerel hafıza kayıtları (kullanıcı onaylı, cihazda saklanır):\n${memoryLines.join('\n')}`,
    ...projectLines,
    `Gerçek sistem durumu: ${describeRuntimeFacts(runtime)} Bu değerler cihazda yapılan gerçek ölçümlerdir; bu değerlerin dışında performans iddiası üretme.`,
    'Yanıt biçimi: düz Türkçe metin (gerekirse Markdown). Araç çağrısı, JSON işlem bloğu veya fonksiyon çağrısı üretme; yalnızca sohbet et.',
  ].join('\n')
}
