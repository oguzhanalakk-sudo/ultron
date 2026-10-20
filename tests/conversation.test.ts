import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChatSystemPrompt, classifyConversation, describeRuntimeFacts, detectExplicitMemoryRequest, detectFeedbackCorrection, detectForgetRequest, isApplicationLaunchRequest, parseDesktopLaunchRequest, trimConversationContext } from '../electron/conversation.ts'
import { newMemoryEntry } from '../electron/memory-store.ts'
import type { ChatMessage, LocalAiStats, UserProfile } from '../electron/shared.ts'

const profile: UserProfile = { name: 'Ali', instructions: 'Kısa ve doğrudan yanıt ver.', autoLearn: false }
const stats: LocalAiStats = { requests: 4, failedRequests: 1, lastDurationMs: 2400, lastTokensPerSecond: 6.5, lastEvaluatedTokens: 120, lastPromptTokens: 80, lastMeasuredAt: '2026-10-18T10:00:00.000Z', totalEvaluatedTokens: 320 }

test('classifyConversation karşılama ve hâl hatır mesajlarını sohbet sayar', () => {
  assert.equal(classifyConversation('Merhaba Ultron, bugün nasılsın?'), 'chat')
  assert.equal(classifyConversation('Teşekkürler, harika oldu!'), 'chat')
  assert.equal(classifyConversation('Sen kimsin, neler yapabilirsin?'), 'chat')
  assert.equal(classifyConversation('Biraz sohbet edelim.'), 'chat')
  assert.equal(classifyConversation('Neden yavaş çalışıyorsun?'), 'chat')
})

test('classifyConversation işlem isteklerini görev sayar', () => {
  assert.equal(classifyConversation('Teşekkürler, şimdi testleri çalıştır.'), 'task')
  assert.equal(classifyConversation('bu dosyayı düzelt ve hataları gider'), 'task')
  assert.equal(classifyConversation('Bu uygulamayı incele, hataları bul, performansını artır ve test et.'), 'task')
  assert.equal(classifyConversation('Geçen gün üzerinde çalıştığımız projeye devam edelim.'), 'task')
  assert.equal(classifyConversation('Qwen modelini indir.'), 'task')
  assert.equal(classifyConversation(''), 'task')
})

test('kısa internet ve site istekleri araştırma görevine yönlenir', () => {
  assert.equal(classifyConversation("Google'da React 19 SSR hatasını ara"), 'task')
  assert.equal(classifyConversation('Bu siteye gir ve başlıkları oku'), 'task')
  assert.equal(classifyConversation('https://example.com adresini incele'), 'task')
})

test('güvenli Windows uygulaması açma istekleri sohbet moduna düşmez', () => {
  assert.deepEqual(parseDesktopLaunchRequest("Ultron, Hesap Makinesi'ni aç."), { target: 'hesap makinesi' })
  assert.deepEqual(parseDesktopLaunchRequest('Not Defteri uygulamasını başlat'), { target: 'not defteri' })
  assert.equal(classifyConversation("Hesap Makinesi'ni aç"), 'task')
  assert.equal(classifyConversation('Not Defteri uygulamasını başlat'), 'task')
  assert.equal(isApplicationLaunchRequest('Bilinmeyen uygulamayı aç'), true)
  assert.equal(parseDesktopLaunchRequest('Bir hesap makinesi uygulaması yapalım'), null)
})

test('classifyConversation açık hafıza isteklerini sohbet olarak yönlendirir', () => {
  assert.equal(classifyConversation('Bunu hatırla: projem TypeScript kullanıyor.'), 'chat')
  assert.equal(classifyConversation('Hafızaya kaydet: toplantılar salı günü.'), 'chat')
  assert.equal(classifyConversation('Şunu unut: eski ofis adresi.'), 'chat')
})

test('classifyConversation eylemsiz geri bildirimi sohbet, eylemli düzeltmeyi görev sayar', () => {
  assert.equal(classifyConversation('Bu cevap yanlış, doğrusu şu: her zaman önce soruyu netleştirmelisin.'), 'chat')
  assert.equal(classifyConversation('Yanlış yaptın, şimdi dosyayı düzelt.'), 'task')
})

test('detectExplicitMemoryRequest kayıt metnini ve türünü çıkarır', () => {
  assert.deepEqual(detectExplicitMemoryRequest('Bunu hatırla: projem TypeScript kullanıyor.'), { kind: 'knowledge', text: 'projem TypeScript kullanıyor.' })
  assert.deepEqual(detectExplicitMemoryRequest('Bundan sonra her zaman kısa yanıt ver, not al: kısa cevap tercih ediliyor.'), { kind: 'preference', text: 'kısa cevap tercih ediliyor.' })
  assert.equal(detectExplicitMemoryRequest('Hatırlarsan şu dosyayı düzelt.'), null)
  assert.equal(detectExplicitMemoryRequest('Merhaba nasılsın?'), null)
})

test('detectForgetRequest "unut" ile "unutma"yı ayırır', () => {
  assert.equal(detectForgetRequest('Şunu unut: eski ofis adresi.'), 'eski ofis adresi.')
  assert.equal(detectForgetRequest('Bunu unutma: yarın toplantı var.'), null)
  assert.equal(detectForgetRequest('Merhaba.'), null)
})

test('detectFeedbackCorrection düzeltmeleri yakalar, soru kalıbını yakalamaz', () => {
  assert.ok(detectFeedbackCorrection('Bu cevap yanlış, doğrusu şöyle olmalı: önce testleri çalıştır.'))
  assert.ok(detectFeedbackCorrection('Aslında şöyle yapmalıydın, önce dosyayı okumalısın.'))
  assert.equal(detectFeedbackCorrection('Bu doğru değil mi?'), null)
  assert.equal(detectFeedbackCorrection('Bugün hava güzel.'), null)
})

test('buildChatSystemPrompt profil, hafıza ve gerçek sistem durumunu içerir', () => {
  const entry = newMemoryEntry({ kind: 'preference', text: 'Kısa yanıtları sever.' })
  assert.ok(entry)
  const prompt = buildChatSystemPrompt({
    profile,
    memory: [entry],
    projectMemory: null,
    runtime: { model: 'qwen3:8b', stats, hardware: null, projectName: 'ultron', taskNote: null },
  })
  assert.match(prompt, /Kısa ve doğrudan yanıt ver/)
  assert.match(prompt, /Kısa yanıtları sever/)
  assert.match(prompt, /qwen3:8b/)
  assert.match(prompt, /2400 ms/)
  assert.match(prompt, /6\.5 token\/sn/)
  assert.match(prompt, /uluslararası|iddia etme|uydurma/i)
  assert.match(prompt, /araç çağrısı/i)
})

test('buildChatSystemPrompt hafıza boşken hatırlama iddiasını engeller', () => {
  const prompt = buildChatSystemPrompt({
    profile: { name: '', instructions: '', autoLearn: false },
    memory: [],
    projectMemory: null,
    runtime: { model: 'qwen3:8b', stats: { ...stats, lastMeasuredAt: null, lastDurationMs: null }, hardware: null, projectName: null, taskNote: null },
  })
  assert.match(prompt, /Kayıtlı hafıza bilgisi yok/)
  assert.match(prompt, /Henüz gerçek model ölçümü kaydedilmedi/)
  assert.match(prompt, /hatırladığını iddia etme/i)
})

test('describeRuntimeFacts ölçüm olmadığında uydurmaz', () => {
  const text = describeRuntimeFacts({ model: 'test:1b', stats: { ...stats, lastMeasuredAt: null, lastDurationMs: null, lastTokensPerSecond: null, lastEvaluatedTokens: null }, hardware: null, projectName: null, taskNote: null })
  assert.match(text, /Henüz gerçek model ölçümü kaydedilmedi/)
  assert.match(text, /test:1b/)
  assert.match(text, /açık bir proje klasörü yok/)
})

test('trimConversationContext mesaj sayısı sınırında son mesajları korur', () => {
  const history: ChatMessage[] = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}` }))
  const trimmed = trimConversationContext(history)
  assert.equal(trimmed.length, 20)
  assert.equal(trimmed[0].content, 'm10')
  assert.equal(trimmed[0].role, 'user')
  assert.equal(trimmed.at(-1)?.content, 'm29')
  assert.deepEqual(trimConversationContext([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])
})

test('trimConversationContext karakter bütçesini aşan eski mesajları düşürür', () => {
  const history: ChatMessage[] = [
    { role: 'user', content: `eski ${'x'.repeat(4000)}` },
    { role: 'assistant', content: 'y'.repeat(4000) },
    { role: 'user', content: 'yeni soru' },
  ]
  const trimmed = trimConversationContext(history, { maxChars: 5000 })
  assert.equal(trimmed.length, 1)
  assert.equal(trimmed[0].role, 'user')
  assert.equal(trimmed[0].content, 'yeni soru')
})

test('trimConversationContext en az son mesajı her koşulda gönderir ve kullanıcıyla başlatır', () => {
  const trimmedHuge = trimConversationContext([
    { role: 'assistant', content: 'a'.repeat(50_000) },
    { role: 'user', content: 'z'.repeat(50_000) },
  ], { maxChars: 1000 })
  assert.equal(trimmedHuge.length, 1)
  assert.equal(trimmedHuge[0].role, 'user')
  const trimmedPair = trimConversationContext([
    { role: 'assistant', content: 'eski yanıt' },
    { role: 'user', content: 'soru' },
  ], { maxMessages: 2 })
  assert.deepEqual(trimmedPair, [{ role: 'user', content: 'soru' }])
})

// ---- Günlük dil regresyon kümesi: 29 sohbet + 10 görev cümlesi ----
const dailyChatSentences = [
  'Merhaba, bugün nasılsın?',
  'Naber kanka, ne var ne yok?',
  'Bugün hava çok güzeldi, dışarıda yürüyüş yaptım ve kendimi iyi hissettim',
  'Canım bugün çok sıkıldı, bana bir şeyler anlatsana',
  'Kafam çok karışık, ne yapacağımı bilmiyorum',
  'Bugün moralim çok bozuk çünkü işler istediğim gibi gitmedi',
  'Teşekkürler, çok yardımcı oldun bugün bana',
  'Dün akşam güzel bir film izledim, sen film sever misin?',
  'Ben sana biraz kendimden bahsetsem ne dersin',
  'Ne yapıyorsun şu an, meşgul müsün?',
  'Selam, dün seninle konuştuğumuz şeyi düşündüm ve haklısın',
  'Uykum var ama biraz daha konuşalım istersen',
  'Bana kendinden bahset biraz da sen anlat',
  'Bugün işte çok yoruldum, eve yeni geldim',
  'Sen gerçek misin yoksa sadece bir program mısın, merak ediyorum',
  'Sence hayatın anlamı ne? Bazen çok düşünüyorum bunu',
  'Hadi bana komik bir fıkra anlat, moralim bozuk',
  'Sabah kahvemi içerken seni düşündüm',
  'Bugün hava yağmurlu, canım hiçbir şey yapmak istemiyor',
  'Seni çok sevdim, çok tatlısın',
  'Bu akşam ne yapsak acaba, dizi mi izlesek',
  'Bugün çok yorgunum, erken yatacağım galiba',
  'Keyfim yok bugün, biraz konuşalım mı?',
  'Çok stresli bir gün geçirdim, başım ağrıyor',
  'Günaydın, bugün güzel bir gün olacak gibi',
  'Dışarıda kar yağıyor, sıcacık bir çay içiyorum',
  'Annem bugün kurdlanda yemek yaptı, çok güzeldi',
  'Yeni çıkan bir albüm beğendi misin acaba?',
  'Sonunda hafta sonu, ailece piknik yapmayı düşünüyoruz',
]

const dailyTaskSentences = [
  'index.js dosyasındaki hatayı düzelt',
  'Yeni bir todo uygulaması oluştur',
  'Bu projeyi analyse et ve testleri çalıştır',
  'Merhaba, bugün hava güzel. Projedeki testleri çalıştır.',
  'Git commit at',
  'Bana bir python scripti yaz',
  'Kodun tamamını gözden geçir ve yavaş kısımları optimize et',
  'package.json dosyasına yeni bir script ekle',
  'Şu hatayı bul ve düzelt: TypeError cannot read properties',
  'Veritabanı tablosuna created_at sütunu ekle',
]

test('günlük dil kümesi: sohbet cümleleri sohbet sınıfında kalır', () => {
  for (const sentence of dailyChatSentences) {
    assert.equal(classifyConversation(sentence), 'chat', `günlük chat bozuldu: ${sentence}`)
  }
})

test('günlük dil kümesi: görev cümleleri görev sınıfında kalır', () => {
  for (const sentence of dailyTaskSentences) {
    assert.equal(classifyConversation(sentence), 'task', `görev bozuldu: ${sentence}`)
  }
})

test('dosya arama ve yazılım envanteri istekleri görev yoluna düşer', () => {
  assert.equal(classifyConversation('Bilgisayarımdaki tüm PDF dosyalarını bul'), 'task')
  assert.equal(classifyConversation('İndirilenler klasöründeki excel tablolarını listele'), 'task')
  assert.equal(classifyConversation('içinde hata geçen metin dosyalarını ara'), 'task')
  assert.equal(classifyConversation('Bilgisayarımda yüklü programları listele'), 'task')
  assert.equal(classifyConversation('Hangi editörler kurulu, söyle bana'), 'task')
  assert.equal(classifyConversation('Kod editörümü açar mısın'), 'task')
  assert.equal(classifyConversation('Kurulu programlara bak, eklentileri söyle'), 'task')
  assert.equal(classifyConversation('Bilgisayarımda ne var ne yok, hangi yazılımlar var'), 'task')
  assert.equal(classifyConversation('PDF nasıl açarım, eksik yetenek var mı'), 'task')
})

test('negatif kontrol: günlük sohbet cümleleri sohbet sınıfında kalır', () => {
  assert.equal(classifyConversation('Yarın hava soğuk olacakmış, inanamıyorum'), 'chat')
  assert.equal(classifyConversation('Şu filmi çok beğendim, sence de müzikler harikaydı'), 'chat')
})
