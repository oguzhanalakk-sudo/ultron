# OpenCode → Ultron: Araştırma ve Uyarlama Planı (19.10.2026)

Bu belge, Ultron'u bağımsız, yerel çalışan ve yazılım geliştirme görevlerini baştan sona
yapabilen bir kodlama ajanına dönüştürmek için OpenCode projesinin mimarisini, araçlarını
ve mühendislik çözümlerini inceleyip Ultron'a uyarlama planını kaydeder.

> **Durum notu:** Kullanıcının görev mesajı 2. bölümün ortasında kesilmiş olarak ulaştı
> ("...bağımsız bir sistem olmaktır."). Bölüm 3 ve sonrası elimizde yok. Bu belge ilk
> araştırma bulgularını ve ön planı içerir; eksik bölümler gelince güncellenecektir.

## 1. Erişim doğrulaması (kanıt)

| Kaynak | Durum | Yöntem / kanıt |
| --- | --- | --- |
| Depo: github.com/anomalyco/opencode | **Erişildi** | GitHub sayfası HTTPS ile açıldı; varsayılan dal `dev`; MIT lisansı; 20.584 commit; 217k yıldız; kök dizin listesi alındı |
| Ham dosya: `raw.githubusercontent.com/.../dev/AGENTS.md` | **Erişildi** | Depo mühendislik kuralları ve “Session Core” mimari notları okundu |
| GitHub API: `api.github.com/repos/anomalyco/opencode/contents/packages` | **Erişildi** | Paket dizini JSON listesi alındı |
| Dokümantasyon V1: `opencode.ai/docs/` | **Erişildi** | Kullanıcının verdiği URL; V1 içerik (ör. `opencode-ai` kurulumu) |
| Dokümantasyon V2: `opencode.ai/v2/docs/` + `opencode.ai/v2/llms.txt` | **Erişildi** | V2 doküman dizini ve sayfalar (tools, permissions, agents) okundu |

**Kısıt:** Bu makinede `git` kurulu değil (`git --version` → bulunamadı). Bu nedenle depo
klonlanamıyor ve commit geçmişi/diff analizi yapılamıyor. İnceleme, HTTP üzerinden dosya
bazında (GitHub API + `raw.githubusercontent.com`) sürdürülüyor. Erişilemeyen hiçbir şey
“incelendi” olarak raporlanmamıştır.

## 2. OpenCode mimarisi — ilk bulgular (kaynaklı)

### 2.1 Monorepo ve paket yapısı

`packages/` altında 34 paket var (GitHub API, 19.10.2026): `ai`, `app`, `cli`, `client`,
`codemode`, `console`, `containers`, `core`, `desktop`, `effect-drizzle-sqlite`,
`function`, `gui-extensions`, `http-recorder`, `httpapi-codegen`, `identity`, `latex`,
`merman`, `plugin`, `plugin-browser`, `plugins`, `posts`, `protocol`, `schema`, `script`,
`sdk`, `server`, `session-ui`, `simulation`, `stats`, `storybook`, `theme`, `tui`, `ui`,
`util`, `web`.

Bağımlılık yönü kuralı (AGENTS.md, mota mot): *“Keep runtime dependencies directed from
Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code
may depend on Schema and Protocol but never Core or Server; `sdk` composes Client, Core,
and Server.”* — yani sözleşme/şema katmanı en altta, çalıştırma çekirdeği ortada,
istemci ve SDK üstte.

### 2.2 Oturum çekirdeği (“Session Core”) — AGENTS.md

Ultron için en değerli mimari fikirler bu bölümde:

- **Durable olaylar minimaldir:** yalnızca indirgenemez yeni gerçekler yazılır; sıralı
  geçmişin katlanmasıyla türetilebilen durum tekrar kaydedilmez.
- **Prompt kabulü ile model yürütmesi ayrıdır:** `Session.prompt(...)` önce kalıcı bir
  `session.inbox.enqueued` yayınlar (projeksiyon `session_inbox` satırını ekler), sonra
  `SessionExecution.wake(sessionID)` ile yürütmeyi uyarır. Teslim (`delivered`) aşamasında
  inbox satırı tüketilir ve görünür mesaj aynı işlemde yazılır. `session_inbox` yalnızca
  tüketilmemiş işi tutar; aynı kimlikle tekrar deneme idempotenttir (ilk kabul kazanır).
- **`SessionExecution` süreç-global ve oturum kimliği tabanlıdır;** kesme (interrupt)
  yalnızca o oturumun etkin sahiplik zincirini hedefler; boş/başka süreçteki oturumun
  kesilmesi etkisizdir.
- **Konum (Location) kapsamı:** `SessionRunner`, model çözümlemesi, araç kayıt defteri,
  izinler ve dosya sistemi Location'a bağlıdır. `Location.workspaceID` yokluğu “örtük
  yerel” yerleşim demektir; açık kimlik ilerideki çoklu-yerleşim içindir.
- **Her adım tek bir açık `llm.stream` çağrısıdır ve yeniden yüklenen geçmişten devam
  eder. Bellekte araç döngüsü eklenmez.** (Ultron'un şu anki `for (turn…)` döngüsü
  bellekte tutuyor; uzun vadeli dayanıklılık için önemli bir fark.)
- **Yazma-öncesi yürütme iddiası (write-ahead claim):** süreç-yerel meşguliyet işareti;
  terminal bitiş/başarısızlık/kullanıcı kesmesi serbest bırakır, süreç ölümü korur ve
  başlangıç kurtarması iddialı üst düzey oturumları sürdürür. Exactly-once garantisi
  değildir; kurtarma işaretidir.
- **Teslim sözlüğü açıktır:** promptlar varsayılan olarak “steer” eder; güvenli adım
  sınırlarında sıkıştırma (compaction) önceliklidir; boşta kalma sınırında steer'ler
  önce gelir, yoksa tam olarak bir kuyruk öğesi teslim edilir.
- **“turn” ilerideki birimdir:** bir prompt promosyonundan oturum boşa dönene kadar tüm
  adımları kapsar; tek bir `llm.stream` çağrısına “turn” denmez.

### 2.3 Araç kataloğu (V2 dokümanı: `/v2/docs/tools/`)

- **Dosya:** `read` (sayfalama; 2.000 satır / 50 KiB, görsel+PDF), `glob` (varsayılan
  limit 100, 30 sn), `grep` (regex ya da `literal`; limit 100, 30 sn), `edit`
  (`oldString` tek kez eşleşmeli, `replaceAll`), `write` (üst dizinleri oluşturur,
  biçimlendirici çalışabilir), `patch` (ekle/güncelle/taşı/sil; desteklenen GPT
  modellerine özel).
- **Komut:** `shell` (`workdir`, milisaniye `timeout`, varsayılan 2 dk; `background`
  uzun süreçler; büyük çıktı yönetilen dosyada; izin tarayıcısı komuttan kaynak üretir).
- **Web:** `webfetch` (markdown/text/html, ≤120 sn), `websearch`.
- **Etkileşim:** `question` (seçenekli soru; iptal = soruyu iptal), `skill` (SKILL
  talimatlarını yükle; kimlik ilan edilen listede olmalı).
- **Otomasyon:** `subagent` (alt oturum; foreground/background; varsayılan iç içe
  derinlik 1), `execute` (Code Mode: JS çalışma zamanı; fs/import/timer yok; `fetch`
  var; katalogdaki araçları çağırıp sonuçları birleştirir), oturum yardımcıları
  (`session_rename`, `session_move`), worktree araçları (`create/list/remove`).
- **Tarayıcı:** masaüstü uygulamasına bağlı `browser` ad alanı; sekme kimliği zorunlu;
  sayfa anlık görüntüsü, tıklama, form, ekran görüntüsü, konsol/ağ, iz (trace), heap,
  Lighthouse. Sayfa içeriği **güvenilmeyen veri** olarak işaretlenir.
- **Uzantılar:** MCP sunucuları araçlarını varsayılan olarak `execute` üzerinden sunar;
  `codemode: false` ile doğrudan listelenir; izin eylemi `<server>_<tool>`.

### 2.4 İzin modeli (V2 dokümanı: `/v2/docs/permissions/`)

- Kural biçimi: `{ action, resource, effect }`; etkiler `allow | deny | ask`.
- **Sıralı ve “son eşleşen kazanır”**: genel → ajan; istisnalar geniş kuraldan sonra yazılır.
- Kaynak eşlemede `*` ve `?` joker; yol normalizasyonu (Windows'ta `\` → `/`, harf
  duyarsız); `git status *` kuralı argümansız `git status` ile de eşleşir.
- Tek işlem birden çok kaynağı denetleyebilir: **herhangi bir `deny` işlemi reddeder;
  yoksa herhangi bir `ask` sorar; yoksa izin verilir.**
- Varsayılan taban politika: `*:* → allow`, `*.env` → ask, `*.env.*` → ask,
  `*.env.example` → allow. Gömülü ajanlar ek politikalar uygular (`plan` düzenlemeleri
  reddeder; `explore` yalnızca keşif; `title`/`summary` her şeyi reddeder).
- `external_directory` eylemi, aktif Location'ın dışına çıkan okuma/düzenlemeleri ayrıca
  denetler; `~` ve `$HOME` yalnızca read/edit/external_directory kaynaklarında genişletilir.
- Onaylar: `once` / `always` / `reject`. **“Always” kalıcı ve proje kapsamlı `allow`
  kuralı kaydeder; yapılandırılmış `deny` asla geçersiz kılınmaz.**
- Politikalar (policies): kural ve kayıtlı onaylardan **sonra** gelen sert reddetme
  katmanı; `allow`/`ask` → `deny`. Kurumsal/kullanıcı güvenliği için.
- Kabuk tarayıcısı: komut metninden kaynak ve dizin çıkarımı (git ve ağaç-dil
  tarayıcıları); deneysel “portable shell scanner” bayrağı.

### 2.5 Ajan profilleri (V2 dokümanı: `/v2/docs/agents/`)

- Ajan = sistem istemi + model tercihi + izinler + görünüm; Markdown olarak
  `.opencode/agents/<ad>.md` (proje) veya global dizinde; ayrıca config içinde JSONC.
- Alanlar: `description`, `mode` (`primary|subagent|all`), `model`
  (`provider/model#variant`), `system`, `permissions` (sıralı kurallar), `steps`
  (pozitif üst sınır), `hidden`, `color`, `disabled`, `request`.
- Gömülü ajanlar: `build`, `plan` (düzenlemeleri reddeder), `general` (alt ajan),
  `explore` (salt-okuma alt ajan); gizli `compaction`, `title`, `summary`.
- Alt ajanlar **temiz bağlamla** çalışır; ebeveynin `subagent` izni kimi
  başlatabileceğini, alt ajanın kendi izinleri neyi yapabileceğini belirler.
- `steps` bütçesi: son adımda araçlar kaldırılır ve modelden metin özeti istenir; yeni
  kullanıcı girdisi bütçeyi sıfırlar.
- Birleştirme: genel kurallar önce, ajan kuralları sonra eklenir; skaler alanlarda son
  değer kazanır.

### 2.6 Diğer V2 başlıkları (llms.txt)

`config`, `migrate-v1`, `troubleshooting`, `models`, `skills`, `themes`, `commands`,
`plugins`, `providers`, `websearch`, `network`, `snapshots`, `compaction`, `formatters`,
`references`, `attachments`, `tools`, `mcp-servers`, `permissions`, `policies`,
`instructions`, `warming`; CLI/SDK/Client/API ve Console bölümleri.

## 3. Ultron ile karşılaştırma (ön değerlendirme)

| Alan | OpenCode | Ultron (bugün) | Fark / fırsat |
| --- | --- | --- | --- |
| Mimari | İstemci–sunucu; çekirdek/kabuk ayrımı; kalıcı oturum çekirdeği | Tek Electron ana süreci; JSON çalışma alanı + görev günlüğü | Bazı fikirler (kabul/yürütme ayrımı, adım başına `llm.stream`) taşınabilir |
| İzinler | Sıralı kural listesi, joker kaynak eşleme, politikalar, kalıcı onaylar | Mod tabanlı izin yöneticisi + görev kapsamlı izinler | **Kural motoru** yüksek değerli, orta efor |
| Ajan profilleri | `build`/`plan`/`explore` + Markdown profiller, adım bütçesi | Tek ajan kişiliği; plan modu yok | **Salt-okunur plan modu** ve adım bütçesi taşınabilir |
| Bağlam yönetimi | Compaction ajanı, oturum sınırlarında sıkıştırma | `trimConversationContext` + budama | Özetleyici tabanlı sıkıştırma iyileştirmesi |
| Araç kataloğu | read/glob/grep/edit/write/patch/shell/web/… | ~60 araç; benzer kapsam; kod modu var | Araç şemaları ve güvenlik notları karşılaştırılacak |
| Alt ajanlar | `subagent` aracı + temiz bağlam | Yok (bu ortamda var; Ultron uygulamasında yok) | Orta vadeli, yüksek yetenek artışı |
| Yetenekler/Skills | SKILL.md keşfi ve `skill` aracı | `language-knowledge` + çözüm hafızası | Skills kayıt defteri uyarlanabilir |
| Worktree | create/list/remove | Git yok (makinede git kurulu değil) | Şimdilik ertelenir |
| MCP | Yerleşik istemci | Yok | Orta öncelik |
| Referanslar | Adlandırılmış dış dizinler | `resourceRoots` | Eşleme kolay |

## 4. Uyarlama adayları (öncelik sırası)

**P0 — güvenlik ve güvenilirlik**
1. **Kural tabanlı izin motoru:** `{action, resource, effect}` sıralı listesi, joker
   eşleme, “son eşleşen kazanır”, çok-kaynaklı işlemlerde deny/ask/allow birleşimi,
   kalıcı proje onayları, sert politika katmanı. Ultron'un mevcut mod tabanlı izin
   yöneticisinin üzerine uyarlanır.
2. **Adım bütçesi ve son adım özeti:** `steps` üst sınırı, son adımda araçları kaldırıp
   metin özeti isteme; yeni kullanıcı girdisiyle sıfırlama.
3. **Boşta kalma/tamamlanma dürüstlüğü:** (Ultron'da 19.10.2026'da kısmen yapıldı)
   eksik kabul testi, eski kanıt ve başarısız kontrol için dürüst durum.

**P1 — yetenek**
4. **Ajan profilleri:** `plan` (salt-okunur) ve `build` ayrımı; proje dosyasından
   yüklenebilen profil biçimi (Markdown frontmatter).
5. **Compaction/özetleme:** bağlam taşmasında özet ajanı; oturum sınırlarında sıkıştırma.
6. **Skills:** `SKILL.md` keşfi ve istek üzerine yükleme.
7. **Alt ajanlar:** temiz bağlamlı çocuk oturum; ebeveyn izinleriyle sınırlı.

**P2 — genişleme**
8. MCP istemcisi; 9. Referanslar (adlandırılmış dış dizinler); 10. Snapshot/geri alma
   semantiğinin hizalanması; 11. Biçimlendiriciler; 12. Sunucu/API ayrımı (büyük mimari).

## 5. Bağımsızlık, lisans ve sınırlar

- **Yerel öncelik:** Uyarlamalar hiçbir bulut sağlayıcıyı zorunlu kılmamalı; Ultron
  varsayılan olarak yerel Ollama/OpenAI-uyumlu uçlarla çalışmaya devam etmeli.
  OpenCode desenleri sağlayıcı-bağımsızdır; bu yönüyle uyarlanabilir.
- **Lisans:** OpenCode MIT lisanslıdır. Doğrudan kod kopyalanırsa telif/lisans bildirimi
  korunmalıdır; tasarım ve davranış uyarlamaları temiz-oda yaklaşımıyla yapılır.
- **Marka:** “OpenCode” adı, logosu veya arayüzü kopyalanmayacak; hiçbir bağlantı iddiası
  kullanılmayacak (depo README'sindeki “not affiliated” kuralına uygun).
- **Kanıt kuralı:** Her uyarlama kararı bir kaynağa (dosya URL'si / doküman sayfası)
  dayandırılacak; erişilemeyen kaynak hakkında iddia üretilmeyecek.

## 6. Çalışma yöntemi

Her uyarlama için: (1) kaynak notu ve alıntı → (2) Ultron'a özgü tasarım notu → (3) test
önce (başarısız test) → (4) uygulama → (5) birim + UI smoke doğrulaması → (6) belge
güncellemesi. Mevcut 278 test ve geçen UI smoke yeşil kalmalı; kullanıcının commit
edilmemiş değişiklikleri korunur.

## 7. Açık sorular (kullanıcı girdisi bekliyor)

1. Görev mesajının 3. ve sonraki bölümleri ulaşmadı; tam gereksinimler neler?
2. Öncelik: P0 izin motoru mu, P1 ajan profilleri mi önce?
3. Yeni kaynak derlemesi (`release/` kurulum paketi) kullanıcının makinesine kurulsun mu
   (sessiz NSIS güncellemesi), yoksa kullanıcı kendisi mi kurmak ister?
