# Ultron — Güncel Denetim ve Dönüşüm Raporu

**Tarih:** 19.10.2026  
**Kapsam:** `C:\Users\user\Desktop\codexx`  
**Tür:** Denetim raporu + uygulama günlüğü. İlk bölüm salt denetimi; son ek ise aynı gün tamamlanan düzeltmeleri ve Codex tarzı arayüz teslimini belgeler.  
**Kanıt dosyaları:** `docs/evidence/EVIDENCE-SUMMARY-2026-10-19.md`, `docs/evidence/unit-tests-2026-10-19.txt`, `docs/evidence/ui-smoke-failure-2026-10-19.txt`, `docs/evidence/agent-flow-demo-2026-10-19.json`, `docs/evidence/file-search-sensitive-audit-output.txt`  

> Bu rapor, mevcut kodun ölçülen durumunu anlatır. Hedef mimari değildir. Bir özellik yalnızca kodda bulunduğu için “çalışıyor” sayılmadı; test edilmeden geçen hiçbir senaryo başarılı kabul edilmedi. İlk denetim aşamasında kaynak kod değiştirilmedi; sonraki bölümlerde uygulanan düzeltmeler ve 19.10.2026 akşamı tamamlanan Codex tarzı arayüz teslimi ayrıca kaydedildi. Nihai doğrulama ve kurulum bilgileri raporun sonundaki ek bölümdedir.

## Yönetici özeti

Ultron’un çekirdeği ciddi bir mühendislik iskeletine sahip: 67 IPC kanalı, 60 araç şeması, kalıcı görev kaydı, doğrulama defteri, yedek/geri alma, iki sağlayıcı adaptörü ve 276 geçen birim testi var. Ancak **üç P0 sorun** üretim güvenilirliğini ve güvenliğini engelliyor:

1. **Hassas veri sızıntısı:** `read_file` `.env` dosyasını engelliyor; fakat dosya arama, dosya önizleme ve `.codex-local` arama yolları aynı politikayı uygulamıyor. Bu denetimde `scanDirectoryForQuery` sahte bir projede `.env` ve `.codex-local/tasks.json` snippet’lerini döndürdü. Ajan, `.env`, anahtarlar ve kullanıcı klasörlerinden içerik alıp yapılandırılmış uzak sağlayıcıya gönderebilir.
2. **Tamamlanma durumu hatası:** Boş model turlarında `needs_review` denmesi gereken durum `failed` olarak kaydediliyor. Güncel UI smoke testi bu nedenle **başarısız**; canlı Demo #5 de tamamlanmadı.
3. **Yürütme sınırı yok:** Komut allowlist’i ve onay kartı güvenlik sınırı değil. Proje içine yazılan bir Python/Node betiği, kullanıcının dosya ve ağ yetkileriyle çalışabilir.

Olumlu taraf: tip kontrolü temiz, üretim derlemesi başarılı, 276/276 birim testi geçiyor, kurulu uygulamada sahte OpenAI uyumlu sağlayıcı testi geçiyor. Eksik olan, bu parçaların güvenli ve dürüst bir uçtan uca akışta birleştirilmesi.

Somut örnek: 19.10.2026’daki “bir hesap makinesi uygulaması yapalım” görevi (`b9a9ed70-…`) `failed` oldu; plan 3 adımken yalnızca `list_files` ve iki `read_file` çalıştı, hiç dosya yazma aracı çağrılmadı. Ajan, aynı çalışma alanındaki eski VPN/MainActivity bağlamını okumaya devam etti; son model isteği 3×120 sn sonra zaman aşımına uğradı (bkz. bölüm 9.2 ve kanıt özeti 5.1).

---

## 1. Doğrulanmış mimari haritası

### 1.1 Ölçülen gerçekler

| Ölçüm | Değer | Kanıt |
|---|---:|---|
| Ürün / sürüm | Ultron 1.1.0, Electron 44, React 19, Vite 8.3.4 | `package.json` |
| Ana süreç | **5.298 satır**, 394.034 bayt | `electron/main.ts` |
| Preload | **112 satır**, 67 IPC kanalı | `electron/preload.ts` |
| Renderer | **1.168 satır**, 131.764 bayt | `src/App.tsx` |
| IPC kanalları | **67**; main ve preload birebir aynı | `main.ts:5002-5014`, preload |
| Araç şeması | **60** | `main.ts` içindeki `agentTools` |
| Dispatch case | **62** | `runTool` switch’i |
| Dispatch-only orphan | **2**: `project_scaffold`, `list_project_templates` | şemada yok, case’te var |
| Electron TS modülü | 41 | `electron/*.ts` |
| Test dosyası | 38 | `tests/*.test.ts` |
| Birim/entegrasyon testi | **276/276 geçti** | 19.10.2026, 5.896 ms |
| Üretim derlemesi | Başarılı: main 697,54 kB; preload 5,63 kB; renderer 1.398,47 kB | `npm run build` |
| Varsayılan sağlayıcı | Ollama / `qwen3:8b` | `main.ts:108` |
| Görev limitleri | 96 model turu, 256 araç çağrısı, 30 dk, 8 araç/tur, 24.000 karakter bağlam | `agent-orchestrator.ts:24-38` |

### 1.2 Katmanlar ve sorumluluklar

| Katman | Ana dosyalar | Sorumluluk | Durum |
|---|---|---|---|
| Renderer | `src/App.tsx`, `src/main.tsx` | Sohbet, dosya/panel UI, onay kartları, görev geçmişi, ayarlar | UI var; monolitik |
| Preload köprüsü | `electron/preload.ts` | `contextBridge` ile 67 kanalı açar | 67/67 eşleşiyor |
| IPC güvenliği | `main.ts:5002-5014` | Her handler’da ana pencere, ana frame ve URL doğrulaması | Statik doğrulandı; doğrudan test yok |
| Pencere güvenliği | `main.ts:170-185` | `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, navigation/open guard | Statik doğrulandı |
| Koordinatör | `main.ts` | `runAgent`, sohbet, araç dispatch, izinler, dosya, Git, build, bellek | 40 yerel modülü içe aktarıyor; yüksek bağlaşım |
| Ajan çekirdeği | `agent-intent.ts`, `agent-orchestrator.ts`, `agent-verification.ts`, `agent-editing.ts` | Niyet, limit, hata sınıflandırma, doğrulama, yama | Birim testli |
| Görev durumu | `task-store.ts` | Kalıcı görev, olay, plan, resume/interrupt, final kapısı | Birim testli; ana akış entegrasyonu zayıf |
| İzinler | `permissions.ts`, `permission-manager.ts` | Risk sınıfı, onay, kalıcı grant, profil | Birim testli; OS sandbox yok |
| Sağlayıcılar | `model-provider.ts`, `openai-provider.ts`, `provider-secrets.ts` | Ollama ve OpenAI uyumlu adaptör, anahtar, timeout | Kurulu mock testi geçti; gerçek bulut yok |
| Dosya arama | `file-search.ts`, `text-extract.ts` | Ad/içerik/kopya arama, PDF/DOCX/XLSX çıkarma | Birim testli; hassas filtre yok |
| Kalıcılık | `.codex-local/`, `atomic-json.ts`, `json-store.ts` | Görev, workspace, yedek, undo, bellek | Çalışıyor; temizleme/redo sınırlı |

### 1.3 Görev akışı

```text
React UI
  → window.kodAtolyesi (preload, 67 kanal)
  → assertTrustedIpcSender
  → main.ts / runAgent
  → niyet + plan + sağlayıcı isteği (Ollama veya OpenAI uyumlu)
  → model araç çağrıları
  → runTool: izin/onay → gerçek dosya/komut/Git/build
  → doğrulama defteri (test/build/komut kanıtı, kaynak parmak izi)
  → task-store günlüğü
  → final kapısı: completed / needs_review / blocked / failed / cancelled
```

Güven sınırları:

- **Renderer** ana pencere ve ana frame olmak zorunda; alt frame ve başka pencere reddedilir (`main.ts:5002-5007`).
- **Model** güvenilmez kabul edilmeli; araç parametreleri şema ve izin katmanından geçer.
- **Araç çıktısı** güvenilmez veridir; dosya içeriği ve web sonucu model için talimat değil, veri olmalıdır.
- **Dosya sistemi** hassas dosya politikasıyla korunmalıdır; bugün bu politika tüm dosya erişim yollarında uygulanmıyor.
- **Sağlayıcı** yerel varsayılan olsa da, uzak endpoint seçildiğinde görev bağlamı ve araç çıktıları oraya gider; bugün bunun için ayrı bir veri politikası yok.

### 1.4 Durum modeli

`task-store.ts:8` ve `task-store.ts:201-226` şu durumları tanımlar:

`running`, `waiting_approval`, `interrupted`, `paused`, `blocked`, `needs_review`, `completed`, `failed`, `cancelled`.

`finish(completed)` çağrısı şu kurallarla durumu düşürebilir:

- Başarısız doğrulama veya açık `errorAnalysis` varsa → `failed`.
- Eski doğrulama, açık plan adımı, eksik kabul testi veya değişiklik doğrulaması yoksa → `needs_review`.
- Aksi halde → `completed`.

Bu kapı iyi tasarlanmış; ancak hata sınıflandırması ve boş tur davranışı bu kapıyı yanlış yönde tetikliyor.

---

## 2. Çalışan özellikler ve durum matrisi

### 2.1 Durum matrisi

**Durum etiketleri:** `Çalışıyor + testli` · `Kodlandı, yetersiz test` · `Kısmen` · `Sadece UI` · `Eksik` · `Başarısız`. `Doğrulanmadı/engellendi`, test edilemediği için geçti sayılmayan ayrı bir durumdur; `Statik doğrulandı`, çalışma zamanı testi olmayan “Kodlandı, yetersiz test” alt durumudur. Bu denetimde tamamen UI-only bir özellik tespit edilmedi; paneller arka uç araçlarına bağlı.

| # | Alan | Kanıt | Durum |
|---:|---|---|---|
| 1 | Tip kontrolü | `npm run typecheck` çıkış 0 | **Çalışıyor + testli** |
| 2 | Üretim derlemesi | `npm run build` başarılı; boyutlar ölçüldü | **Çalışıyor + testli** |
| 3 | Birim/entegrasyon paketi | 276/276, 0 fail, 5.896 ms | **Çalışıyor + testli** |
| 4 | UI smoke (mock model) | `npm run test:smoke` → assertion fail, `failed` ≠ `completed` | **Başarısız** |
| 5 | Canlı ajan demoları (gerçek Qwen) | Demo #5: 25 dk 50 sn, `failed`; hesap makinesi: 8 dk 55 sn, `failed`, yazma aracı yok | **Başarısız** |
| 6 | Kurulu sağlayıcı mock testi | `SAGLAYICI-KONTROL: GECTI`; `MODELS-ISTEGI: 2`, `CHAT-ISTEGI: 1` | **Çalışıyor + testli** |
| 7 | Gerçek bulut sağlayıcısı | Yalnızca sahte sunucu; gerçek API anahtarı/ağ testi yok | **Kodlandı, yetersiz test** |
| 8 | 67 IPC + sender doğrulaması | Statik: 67 handler, hepsi wrapper’dan geçiyor | **Kodlandı, yetersiz test** |
| 9 | Pencere güvenliği | `contextIsolation`, `sandbox`, `nodeIntegration:false`, navigation guard | **Statik doğrulandı** |
| 10 | Doğrudan `.env` okuma engeli | UI smoke erken assertion + `sensitive-files` testleri | **Çalışıyor + testli** |
| 11 | Arama/önizleme hassas filtre | Runtime: `.env` ve `.codex-local/tasks.json` snippet’leri döndü; `files:preview` statik | **Başarısız** |
| 12 | Görev kalıcılığı/resume | `task-store` testleri; kurulu sohbet kalıcılığı önceki kanıt | **Çalışıyor + testli** |
| 13 | Doğrulama defteri/güncellik | Birim testler; UI smoke’un ilgili senaryoları güncel koşuda çalışmadı | **Kısmen** |
| 14 | Boş tur/tamamlanma | Güncel UI smoke fail; `needs_review` mesajı `failed` üretiyor | **Başarısız** |
| 15 | Dosya düzenleme/yama | `agent-editing` testleri; CRLF/LF, normalize eşleşme | **Çalışıyor + testli** |
| 16 | Yedek/geri alma | UI smoke’ta önceki kanıt; doğrudan birim testi yok; temizleme/redo yok | **Kodlandı, yetersiz test** |
| 17 | İzin profilleri/grant | `permissions` ve `permission-manager` testleri; kişisel otomatik risk | **Kısmen** |
| 18 | Git dalları/commit | Git PATH’te yok; canlı test engellendi | **Doğrulanmadı** |
| 19 | Android/Windows/Web build araçları | Birim testli; gerçek build ortam testi sınırlı | **Kodlandı, yetersiz test** |
| 20 | Eklenti sistemi | `plugin-manager` testleri; kurulu uçtan uca test yok | **Kodlandı, yetersiz test** |
| 21 | Yerel model/sohbet geçmişi | Önceki kurulu smoke ekran görüntüleri; güncel provider testi | **Kısmen** |
| 22 | MCP, uygulama içi tarayıcı, rol profilleri, otomatik self-improvement, sağlayıcı fallback | Kod/dep yok | **Eksik** |
| 23 | CSP ve Electron izin isteği politikası | `src/index.html`’de CSP yok; `setPermissionRequestHandler` yok | **Eksik** |
| 24 | GitHub CI | `.github/workflows/ci.yml` var; GitHub’da hiç çalışmadı | **Doğrulanmadı** |
| 25 | Paketleme/kurulum | Derleme başarılı; kurulu asar 16:33, kaynak daha yeni | **Kısmen / sürüm kayması** |

### 2.2 Gerçekten çalışan çekirdek

- **Sağlayıcıdan bağımsız araç şeması:** Araçlar OpenAI `function` biçiminde tanımlanıyor; Ollama ve OpenAI uyumlu adaptörler aynı çağrıları işliyor (`main.ts:3312`, `openai-provider.ts`).
- **Dosya düzenleme:** `agent-editing.ts` birebir, normalize ve trimmed eşleşme; CRLF/LF koruması; çoklu eşleşme; satır aralıklı okuma. Birim testli.
- **Doğrulama defteri:** Başarılı test/build için kaynak parmak izi; kaynak değişince receipt geçersiz; başarısız kontrol final kapısını kilitliyor (`agent-verification.ts:68-119`).
- **Kalıcı görev günlüğü:** Görev, plan, olay, kullanılan araçlar, hata analizi; 80 görev ve 120 olay sınırı; atomik JSON yazımı (`task-store.ts`).
- **Onay/izin altyapısı:** Risk sınıfları, kalıcı grant, görev/proje/kategori kapsamı; varsayılan `controlled/review/confirm` (`permissions.ts`, `permission-manager.ts`).
- **Pencere ve IPC sertleştirmesi:** Ana frame kontrolü, navigation engeli, dış URL’yi yalnızca `shell.openExternal` ile açma.
- **Dosya okuma koruması (kısmi):** `readProjectFile`, `sensitive-files.ts` üzerinden `.env`, `.ssh`, özel anahtarları engelliyor (`main.ts:574-586`).
- **Yerel sağlayıcı testi:** Kurulu uygulamada sahte OpenAI uyumlu sunucuyla model listesi ve sohbet akışı geçti; API anahtarı ayarlar dosyasına sızmadı.

### 2.3 Test edilmiş ama uçtan uca doğrulanmamış

- Android/Gradle, Windows build, web proje araçları: birim testleri var; gerçek SDK/derleme ortamında uçtan uca kanıt sınırlı.
- Git araçları: birim testleri var; canlı Git yok, ilk commit akışı doğrulanmadı.
- Eklenti sistemi: host/izin testleri var; kurulu uygulamada gerçek eklenti çalıştırma yok.
- Yedek/geri alma: önceki UI smoke’ta geçtiği ekran görüntüsü var; güncel koşuda ilk assertion’da durdu; bağımsız test yok.
- Web araştırma: SSRF/özel ağ koruması birim testli; gerçek internet ve gerçek sağlayıcı kombinasyonu test edilmedi.

---

## 3. Eksik veya bozuk özellikler

| Özellik | Gözlenen | Etki | Sınıf |
|---|---|---|---|
| Yerel Qwen taslak görevi | `read_file` + `propose_file_edit` sonrası 3 boş tur → `failed` | Taslak hazır olduğu halde kullanıcıya “başarısız” deniyor | **Bozuk** |
| UI smoke | `failed` yerine `completed` bekleniyor; test düşüyor | Regresyon kapısı çalışmıyor; sonraki senaryolar koşmuyor | **Bozuk** |
| Canlı Demo #5 | Testler 3/3 geçti, görev `failed` | Otonom tamamlama iddiası kanıtsız | **Bozuk** |
| Hassas dosya araması | `search_file_contents` ve `find_files` `.env` içeriğini döndürebilir | API anahtarı/parola sızıntısı | **Bozuk/güvenlik** |
| Dosya önizleme | `files:preview` proje içindeki `.env`’i ham okur | Renderer ele geçirilirse anahtar sızıntısı | **Bozuk/güvenlik** |
| `.codex-local` araması | `read_file` yolunu `excludedDirectories` engelliyor; ancak `scanDirectoryForQuery` `.codex-local`’i gezebiliyor | Görev geçmişi/yedek içeriği arama snippet’iyle modele açılabilir | **Bozuk/güvenlik** |
| Kullanıcı klasörü araması | `@user/desktop`, `@user/documents` vb. çözümleniyor; agent şemasında görünmüyor | Onaysız kişisel dosya taraması | **Bozuk/güvenlik** |
| Komut zaman aşımı | Çıktı yalnızca `Komut çıkış kodu: -2`; `[zaman aşımı]` sadece UI olayında | Hata `unknown` sınıflanıyor; yanlış kurtarma | **Bozuk** |
| Doğrulama kaydı | Başarısız `run_command` kalıcı; başka başarılı komut temizlemiyor | Görev, geçici hata yüzünden kalıcı `failed` | **Bozuk** |
| Plan–araç kopukluğu | Hesap makinesi görevinde plan 3 adım; yalnızca `list_files`/`read_file`; yazma yok; 3×120 sn timeout | Model planı uygulamıyor; eski proje bağlamı görevi ele geçiriyor | **Bozuk** |
| Boş tur koruması | Sadece `pendingSteps > 0` iken duruyor | Açık adım yoksa başarısız kontrolle 96 tura kadar dönebilir | **Bozuk** |
| Hata başına tekrar sınırı | `maxCorrectionAttempts = Number.MAX_SAFE_INTEGER`; `shouldBlock` daima false | Aynı hatalı çağrı bütçeyi tüketebilir | **Bozuk** |
| Kurulu build | 3 dakikalık yeni `run_command` sınırı asar’da yok | Kullanıcı eski 15 dakikalık davranışı yaşıyor | **Sürüm kayması** |
| MCP istemcisi | Kod yok | Codex benzeri araç ekosistemi yok | **Eksik** |
| Uygulama içi tarayıcı | `browser_check` yok; Playwright yalnızca test bağımlılığı | UI doğrulaması sınırlı | **Eksik** |
| Rol profilleri | Planner/architect/coder ayrımı yok | Tek prompt, tek model davranışı | **Eksik** |
| Otomatik self-improvement | Yalnızca bellek; kod değişikliği otomasyonu yok | Kontrollü iyileştirme yok | **Eksik** |
| Sağlayıcı fallback | Tek aktif sağlayıcı; yedekleme yok | Sağlayıcı kesintisi görevi durduruyor | **Eksik** |
| CSP / izin isteği handler’ı | Yok | Savunma derinliği eksik | **Eksik** |
| OS düzeyi komut sandbox’ı | Yok; `spawn` + env filtresi | Proje betiği kullanıcı yetkileriyle çalışır | **Eksik/güvenlik** |
| PTY / arka plan GUI yönetimi | `run_command` pipe tabanlı; stdin/PTY yok | GUI/interaktif uygulama testi yanlış zaman aşımına gidiyor | **Eksik** |
| Dinamik Tool Manager | `agentTools` dizisi + `runTool` switch | 60/62 tutarlılığı elle; orphan case’ler var | **Eksik** |
| Anlamsal kod indeksi | Dosya indeksi ad/metadata; embedding yok | Büyük projede bağlam seçimi zayıf | **Kısmen** |
| Yedek temizliği/redo | Yedekler birikiyor; redo yok; `create_directory` undo dışı | Disk büyümesi ve eksik geri alma | **Kısmen** |
| CI | Dosya var, GitHub’da çalışmadı | Paketleme/kurulum regresyonu görünmüyor | **Doğrulanmadı** |

### 3.1 “8B model = frontier” iddiası yok

Varsayılan `qwen3:8b`, yerel ve ücretsiz bir başlangıç modelidir; frontier bir modelle eşdeğer değildir. Demo #5’in başarısızlığı bunun somut kanıtıdır. Codex benzeri davranış modelden değil; **plan, araç disiplini, doğrulama, durum makinesi, sandbox ve kurtarma** katmanlarından gelmelidir. 8B model ancak bu katmanlar güçlendirilirse kullanılabilir bir taban olur.

---

## 4. Kritik mimari ve güvenlik sorunları

### 4.1 P0 — Yayın öncesi kapatılması gerekenler

#### P0-1. Hassas dosya politikası tüm dosya erişim yollarında uygulanmıyor

**Kanıt:**

- `sensitive-files.ts:10-20` hassas dosya/klasör listesini tanımlıyor.
- `main.ts:574-586` `readProjectFile` bu politikayı uyguluyor; `.env`, `.ssh`, `id_rsa`, `.pem` vb. reddediliyor.
- `file-search.ts:278-344` `scanDirectoryForQuery` hiçbir hassas dosya kontrolü yapmıyor; `defaultScanOptions` `.env`, `.ssh` veya `.codex-local`’i dışlamıyor.
- `main.ts:3091-3092` `runFileSearchFlow` doğrudan bu taramayı çağırıyor.
- `main.ts:3765-3767` `find_files` ve `search_file_contents` ajan araçları aynı akışı kullanıyor.
- **Runtime kanıtı (19.10.2026):** `docs/evidence/file-search-sensitive-audit.mjs` sahte bir proje ağacında `scanDirectoryForQuery` çağırdı; `.env` için `API_TOKEN=FAKE_AUDIT_SECRET`, `.codex-local/tasks.json` için `TASK_INTERNAL_SECRET` snippet’leri döndü. Çıktı: `docs/evidence/file-search-sensitive-audit-output.txt`.
- `main.ts:5052-5069` `files:preview` proje içindeki dosyayı `fs.readFile` ile ham okuyor; hassas kontrol yok.
- `main.ts:2986-2990` `@user/desktop`, `@user/documents`, `@user/downloads` gibi kapsamlar çözümleniyor. Bu kapsamlar UI’da listelenmese de ajan `scope` parametresiyle kullanabilir; `find_files` şeması yalnızca `@resource` diyor, gerçek çözümleyici daha geniş.
- `main.ts:127` `.codex-local` dosya ağacından dışlanıyor; `validateRelativePath` (`main.ts:509-530`) bu klasörü `read_file` ve `files:preview` için de engelliyor. Ancak `scanDirectoryForQuery` bu kontrolü kullanmıyor ve `defaultScanOptions` `.codex-local`’i dışlamıyor; `search_file_contents` / `find_files` `.codex-local/tasks.json`, `undo.json` ve `backups/*` içeriğini tarayabilir.

**Etki:** Ajan, `.env` içindeki API anahtarını, `.ssh` anahtarını, kullanıcının Belgeler/Masaüstü dosyalarındaki kişisel verileri veya görev günlüğündeki önceki dosya içeriklerini okuyup yerel/uzak modele gönderebilir. “Hassas dosya engeli” yalnızca tek bir okuma yolunda çalıştığı için güvenlik iddiası doğru değil.

**Çözüm yönü:** Tek bir `isAgentReadablePath` / `assertAgentReadablePath` politikası oluştur; `readProjectFile`, `runFileSearchFlow` (yalnızca `caller:'tool'`), `findDuplicateFiles`, dosya indeksi, `files:preview` ve arama sonuçları aynı politikadan geçsin. `read_file`/`files:preview` için mevcut `excludedDirectories` kontrolü korunmalı; arama, indeks ve kopya taraması da `.codex-local`, `.git`, yedek/trash ve hassas dosyaları dışlamalı. `@user` kapsamlarını ajan şemasından çıkar veya yalnızca kullanıcı onayıyla açık bir kaynak köküne dönüştür.

#### P0-2. Komut allowlist’i sandbox değildir

**Kanıt:**

- `permissions.ts:42-85` komutu tokenize edip yürütülebilir adına ve risk sınıfına bakıyor; `shell:false` kullanılıyor.
- `main.ts:840-852` süreç proje dizininde, filtrelenmiş ortamla başlatılıyor.
- `command-environment.ts:19-25` yalnızca kimlik bilgisi görünümlü ortam değişkenlerini çıkarıyor; dosya sistemi veya ağ erişimini kısıtlamıyor.
- `python script.py`, `node script.js`, `pytest` gibi komutlar “development” riskiyle otomatik çalışabilir; betiğin içeriği denetlenmiyor.
- `permissions.ts:88-95`: `personal` profili + `commandMode: automatic` bütün risk sınıflarını otomatik onaylıyor.

**Etki:** Proje içine yazılan bir betik, kullanıcının tüm dosya ve ağ yetkileriyle çalışır. Onay kartı komut adını gösterir; betiğin ne yapacağını göstermez. Prompt injection veya kötü niyetli bir bağımlılık, veri sızdırabilir.

**Çözüm yönü:** Kısa vadede `personal + automatic` kombinasyonunu güvenli varsayılanla sınırla; betik çalıştırmayı dosya bazlı açık onaya bağla; ağ erişimini varsayılan kapalı yap. Orta vadede Windows Job Object/restricted token/AppContainer veya WSL/Docker tabanlı gerçek bir yürütme sandbox’ı ekle. `taskkill /T` yalnızca süreç ağacını öldürür; dosya/ağ izolasyonu sağlamaz.

#### P0-3. Boş tur ve tamamlanma durumu çelişkisi

**Kanıt:**

- `main.ts:4317-4332`: plan varsa, bekleyen adım veya başarısız kontrol varsa `isTrulyComplete=false`; 3 boş turda `throw` ediliyor.
- `agent-orchestrator.ts:148-151`: yorum “needs_review’a geçilir” diyor; fonksiyon yalnızca boolean döndürüyor.
- `main.ts:4489`: `completedWork` regex’i `write_file`, `apply_patch`, `run_tests` vb. içeriyor; **`propose_file_edit` yok**.
- `main.ts:4490-4504`: hata mesajı “Model yanıtı...” içerdiği için `modelUnavailable` true oluyor; ancak `completedWork` false olduğundan `needs_review` dalına girilmiyor, doğrudan `failed` yazılıyor.
- `tests/ui-smoke.mjs:175`: “Yerel Qwen görevi tamamlanmalı” assertion’ı `failed` alıyor.

**Etki:** Yalnızca okuma ve diff taslağı isteyen bir görev, taslak hazır olmasına rağmen “başarısız” görünüyor. Kullanıcıya “doğrulama bekliyor” mesajı verilse bile kalıcı durum `failed`. Bu, ürünün en temel “taslak hazırla” akışını bozuyor.

**Çözüm yönü:** Boş turu hata fırlatmak yerine tipli bir `IdleStop` sonucu yap; gerçek iş varsa `needs_review`, gerçekten iş yoksa `failed`/`blocked` üret. `propose_file_edit`’i tamamlanmış iş say. Plan adımları modele bırakılmadan, araç kanıtından türetilebiliyorsa otomatik `done` işaretle. UI smoke beklentisini ürün kararına göre `needs_review` veya `completed` olarak netleştir; iki durumu da test et.

### 4.2 P1 — Güvenilirlik ve güvenlik açıkları

| ID | Sorun | Kanıt | Etki |
|---|---|---|---|
| P1-1 | Doğrulama defteri zehirlenmesi | `agent-verification.ts:78-107`, `main.ts:4437-4454` | Başarısız bir `run_command` kalıcı başarısızlık; başka başarılı komut temizlemiyor; Demo #5’in ana nedeni |
| P1-2 | Timeout yanlış sınıflandırma | `main.ts:874,896`; `agent-orchestrator.ts:49-77` | Çıktıda yalnızca `Komut çıkış kodu: -2`; `[zaman aşımı]` UI olayında kalıyor; hata `unknown` |
| P1-3 | Boş tur koruması eksik | `main.ts:4320-4328`, `agent-orchestrator.ts:150-151` | `pendingSteps=0` + başarısız kontrol durumunda 96 tura kadar döngü |
| P1-4 | Hata başına tekrar sınırı yok | `agent-orchestrator.ts:31,104-115` | Aynı hatalı çağrı bütçeyi tüketir; test bunu bilinçli olarak doğruluyor |
| P1-5 | Kurulu build kayması | Kurulu asar 16:33; kaynak `run_command` 3 dk: `main.ts:3669-3674` | Yeni sınır kullanıcıya ulaşmadı; Demo #5 eski 15 dk davranışıyla çalıştı |
| P1-6 | API anahtarı düz metin | `provider-secrets.ts:52-61`, `main.ts:194` | Electron `userData` altındaki `provider-secrets.json`; Windows’ta `0o600` etkisi sınırlı; DPAPI/Keychain yok |
| P1-7 | CSP yok | `src/index.html:1-9` | Savunma derinliği yok; renderer XSS’inde IPC yüzeyi riski |
| P1-8 | İzin isteği politikası yok | `main.ts:170-185` içinde `setPermissionRequestHandler` yok | Kamera/mikrofon/bildirim gibi isteklerde açık politika yok |
| P1-9 | Kişisel otomatik komut | `permissions.ts:88-95` | Sahibinin seçimi olsa da yıkıcı/sistem komutları onaysız çalışır |
| P1-10 | Git commit güvenliği | `main.ts:3826-3839` | `git add -A` tüm çalışma ağacını commit eder; test/dal doğrulaması yok; ilk commit akışı kırılgan |
| P1-11 | Plan–araç kopukluğu ve sohbet bağlamı kirlenmesi | Görev `b9a9ed70-…`, `workspace.json`; `main.ts` plan/araç döngüsü | Hesap makinesi görevinde plan 3 adımken yalnızca `list_files`/`read_file` çağrıldı; eski VPN bağlamı okundu; hiç yazma aracı yok; model 3×120 sn sonra timeout |

### 4.3 P2 — Mimari borç ve gelecek riskleri

- **Monolit:** `main.ts` 5.298 satır ve 40 yerel modül ithal ediyor; 67 IPC ve 62 dispatch case aynı dosyada. Her değişiklik tüm yüzeyi etkiliyor.
- **Tool Manager yok:** 60 şema ve 62 case elle senkron; `project_scaffold` ve `list_project_templates` orphan. Araç riski, timeout ve izin politikası şema dışında dağınık.
- **Yedek büyümesi:** `.codex-local/backups` temizlenmiyor; `undo.json` son 100 kayıtla sınırlı (`main.ts:314-321`). Redo yok; `create_directory` geri alınamıyor.
- **Git stratejisi:** Dal adı ve commit mesajı doğrulanıyor; ancak commit öncesi test kanıtı, değişiklik kapsamı ve kullanıcı değişikliklerinin ayrılması yok. `git add -A` kullanıcı dosyalarını da commit edebilir.
- **Test kapsamı:** `main.ts`/`runAgent` için doğrudan test yok; IPC sender, CSP, yedek/undo, canlı Git, kurulu build timeout’u ve dosya arama bypass’ı test edilmiyor.
- **Bağlam:** 24.000 karakterlik sohbet bütçesi 16k token yerel model için makul; ancak anlamsal kod indeksi ve akıllı dosya seçimi yok. Büyük projede model yanlış dosyalara bakabilir.
- **Sağlayıcı veri politikası:** Uzak endpoint seçildiğinde proje bağlamı ve araç çıktıları gönderilir; kullanıcıya “bu sağlayıcıya hangi veri gidiyor” uyarısı ve per-task onay yok. Yerel varsayılan iyi, ancak yeterli değil.
- **Model beklentisi:** 8B modelin frontier olmadığı açıkça belirtilmeli; ürün vaadi model zekâsı değil, doğrulanabilir iş akışı olmalı.

---

## 5. Modül bağımlılıkları ve uygulama sırası

### 5.1 Bağımlılık haritası

```text
shared.ts (tipler)
  ├─ model-provider.ts
  ├─ agent-verification.ts
  ├─ agent-editing.ts
  ├─ agent-intent.ts
  └─ task-store.ts ── atomic-json.ts
permissions.ts
  └─ permission-manager.ts ── sensitive-files.ts
provider-secrets.ts
  └─ openai-provider.ts
text-extract.ts
  └─ file-search.ts
agent-orchestrator.ts ── shared.ts
main.ts (40 yerel import) ── yukarıdakilerin tamamı + build/git/web/plugin
preload.ts ── shared.ts + ana IPC yüzeyi
src/App.tsx ── window.kodAtolyesi (preload)
```

Ölçülen bağlaşım:

- `main.ts` 40 yerel modülü içe aktarıyor; bu, tek dosyada koordinatör + uygulama + güvenlik + araç katmanlarını birleştiriyor.
- `task-store.ts` bağımsız test edilebilir; `main.ts` içindeki `runAgent` ise doğrudan test edilemiyor.
- `file-search.ts` saf ve enjekte edilebilir fs ile test edilebilir; hassas filtre çağıran katmana bırakılmış durumda. Bu tasarım kararı, politikanın unutulmasına yol açmış.
- Preload 67 kanalı birebir açıyor; kanal eklemek/çıkarmak için iki dosya ve renderer aynı anda değişmeli.

### 5.2 Önerilen uygulama sırası

1. **Politika ve tipler:** `shared`, `sensitive-files`, `tool-validation`, `permissions`. Önce tek okuma politikası ve araç metadata’sı.
2. **Kalıcılık:** `atomic-json`, `task-store`; durum geçişleri ve resume testleri.
3. **Saf ajan modülleri:** `agent-intent`, `agent-editing`, `agent-verification`, `agent-orchestrator`, `file-search`, `text-extract`.
4. **Sağlayıcılar:** `model-provider`, `provider-secrets`, `openai-provider`; yetenek keşfi ve fallback.
5. **Orkestrasyon:** `main.ts` içinden `runAgent`, `tool-registry`, `process-manager` çıkarımı; IPC yüzeyi korunur.
6. **Preload/renderer:** Kanal sözleşmesi sabit tutulur; UI paneli yeni durum ve kanıtları gösterir.

**Geri dönüşü olmayan büyük refactor yapılmamalı.** Her adımda mevcut 67 IPC ve 60 araç korunmalı; parity testiyle doğrulanmalıdır.

---

## 6. Codex benzeri ajan için gereksinimler

Codex benzeri olmak, aynı modeli kullanmak değildir. Gereken, sağlayıcıdan bağımsız ve denetlenebilir bir çalışma döngüsüdür:

| Gereksinim | Mevcut durum | Yapılması gereken |
|---|---|---|
| Sağlayıcıdan bağımsız çekirdek | Ollama + OpenAI uyumlu adaptör var; döngü `main.ts` içinde | `provider-registry`; yetenek keşfi; hata/fallback politikası |
| Tool Manager | 60 şema + 62 case; orphan’lar var | Tek manifest: ad, şema, risk, read/write/exec, timeout, onay, idempotency |
| Plan/act/observe/verify | Plan ve doğrulama var; durum geçişleri kırılgan | Tipli durum makinesi; her adımda kanıt kimliği |
| Yürütme sandbox’ı | Yok | Proje kökü, ağ, ortam, süreç ağacı ve dosya erişimi için gerçek sınır |
| Kanıt zorunluluğu | Test/build receipt var; exploratory komutlar zehirliyor | Doğrulama ve keşif komutlarını ayır; başarısızı çözülebilir yap |
| Kalıcı görev/resume | Var | Crash sonrası idempotent devam; onay durumunu da sakla |
| Git/worktree | Kısmi | Görev başına dal/worktree; commit öncesi test; kullanıcı değişikliklerini ayır |
| Bağlam/retrieval | 24k karakter; dosya indeksi ad/metadata | Dosya haritası, sembol arama, isteğe bağlı yerel embedding |
| Bellek | Proje/kullanıcı belleği var | Açık rıza, redaksiyon, dışa aktarma/silme; gizli veri yok |
| İzin/onay | Var; kişisel otomatik risk | Varsayılan güvenli; risk sınıfına göre açık onay; dosya içeriği göster |
| Gözlemlenebilirlik | Aktivite/görev geçmişi var | Token/maliyet/süre, araç başarı oranı, kanıt görünürlüğü |
| Genişletilebilirlik | Eklenti var; MCP/browser yok | Opsiyonel MCP/browser; izinli ve testli |
| Kontrollü self-improvement | Yok | Yalnızca ayrı dal + diff + test + kullanıcı onayı; otomatik merge yok |
| Güvenlik | Kısmi | Tüm dosya erişim yollarında hassas politika, CSP, izin handler’ı, anahtar kasası |

---

## 7. Ücretsiz araçlar ve modeller

### 7.1 Yerel/ücretsiz model adayları

> Lisanslar ve kota koşulları değişebilir; üretimde kullanmadan önce doğrulanmalıdır. “Ücretsiz” hukuki veya ticari kullanım garantisi değildir.

| Model | Yaklaşık boyut / donanım | Lisans notu | Uygunluk |
|---|---:|---|---|
| `qwen3:8b` (mevcut varsayılan) | ~5–6 GB Q4; 8 GB VRAM sınırında | Apache-2.0 | Başlangıç; frontier değil |
| `qwen2.5-coder:7b` | ~4–5 GB Q4 | Apache-2.0 | Kod düzenleme; tool-calling şablonu doğrulanmalı |
| `qwen2.5-coder:14b` | ~9–10 GB Q4 | Apache-2.0 | Daha iyi kod kalitesi; 12 GB+ VRAM |
| Qwen3-Coder 30B-A3B (Ollama etiketi kurulumda doğrulanmalı) | ~18–20 GB Q4; MoE | Apache-2.0 | Ajanik kod için güçlü aday; 24 GB sınıfı |
| Devstral Small 24B (Ollama etiketi kurulumda doğrulanmalı) | ~14–16 GB Q4 | Apache-2.0 | Ajanik kodlama için tasarlanmış; 24 GB sınıfı |
| `granite-code` (8B/20B) | 8B ~5 GB; 20B ~12 GB | Apache-2.0 | Kurumsal kod; tool-calling doğrulanmalı |
| `mistral-small3.1:24b` | ~14–16 GB Q4 | Apache-2.0 | Genel amaçlı; kod için özel değil |
| Gemma / Llama aileleri | Değişken | OSI değil; kendi kullanım koşulları | Lisans incelemesi olmadan üretimde önermem |

**Pratik seçim:** 8 GB VRAM’de `qwen3:8b` veya `qwen2.5-coder:7b`; 12–16 GB’de `qwen2.5-coder:14b`/`devstral-small:24b` (quantization ile); 24 GB’de `qwen3-coder:30b-a3b`/`devstral-small:24b`. CPU’da 30B modeller yavaş kalır; ajan döngüsü için gecikme önemlidir.

### 7.2 Ücretsiz geliştirme araçları

| Araç | Lisans / maliyet | Rol | Not |
|---|---|---|---|
| Ollama | MIT, ücretsiz | Yerel model sunucusu | Mevcut; varsayılan |
| llama.cpp / llama-server | MIT | Alternatif yerel sunucu | Daha fazla kontrol, daha az kullanım kolaylığı |
| Git | GPLv2 | Dal/commit/diff | Mevcut değil; kurulum gerekli |
| ripgrep | MIT/Unlicense | Hızlı kod arama | Yeni zorunluluk değil; Node/PowerShell alternatifi var |
| Playwright | Apache-2.0 | UI/E2E testi | Zaten test bağımlılığı; uygulama içi tarayıcı için temel |
| pytest / unittest | MIT / stdlib | Python testleri | Mevcut proje üretiminde kullanılıyor |
| Ruff / Pyright | MIT / Apache-2.0 | Python lint/tip | Opsiyonel, hızlı |
| ESLint / Prettier | MIT | JS/TS kalite | Opsiyonel |
| TypeScript | Apache-2.0 | Tip kontrolü | Mevcut |
| CMake / Ninja | BSD / Apache-2.0 | C/C++ build | Windows build için |
| MSVC Build Tools / Windows SDK | Ücretsiz | Windows native build | Mevcut Windows aracı |
| Android SDK / Gradle / JDK | Ücretsiz | Android build | Mevcut Android aracı |
| NSIS / Inno Setup | Ücretsiz | Installer | Mevcut NSIS |
| GitHub Actions | Public ücretsiz; private kota plana bağlı | CI | Mevcut workflow çalıştırılmadı |
| MCP (opsiyonel) | Açık protokol | Araç ekosistemi | Ağır SDK olmadan stdio JSON-RPC ile başlanabilir |

### 7.3 Ücretsiz barındırılan seçenekler (dikkatli)

GitHub Models, Google AI Studio ücretsiz katmanı, OpenRouter ücretsiz modelleri, Groq/Cerebras ücretsiz kotaları düşük maliyetli denemeler için kullanılabilir. Ancak:

- Kotalar ve modeller sık değişir; üretim SLA’sı yoktur.
- Özel kod ve kullanıcı verisi gönderilmemelidir; kullanım koşulları ve veri politikası incelenmelidir.
- Sağlayıcı fallback’i olmadan tek ücretsiz kota, görevi kilitleyebilir.
- Yerel/özel veri için varsayılan **Ollama** kalmalıdır.

**Veri politikası:** Uzak sağlayıcı yalnızca kullanıcı açıkça yapılandırdığında ve o görev için onay verdiğinde kullanılmalı; hangi bağlamın/dosya çıktısının gönderileceği gösterilmeli. Mevcut `@user`/dosya arama sızıntısı düzeltilmeden uzak sağlayıcıyla otonom görev çalıştırılmamalıdır. Otomatik telemetri veya onaysız yükleme eklenmemelidir.

**Minimal bağımlılık ilkesi:** Phase 0–2 için yeni runtime bağımlılığı gerekmez. Node `fs`/`child_process`, mevcut Electron/React, mevcut test araçları ve Git yeterlidir. Playwright zaten testte var. Ağır ajan framework’ü, vektör veritabanı veya bulut SDK’sı erken eklenmemelidir.

---

## 8. Aşamalı geliştirme planı

| Aşama | Hedef | Ana işler | Çıkış kapısı |
|---|---|---|---|
| **0. Güvenlik ve gerçeklik** | P0 sızıntıyı kapat, durumu dürüstleştir | Tek hassas yol politikası; `.codex-local` ve `@user` kısıtı; preview/search filtreleri; CSP/izin handler’ı; testler; build/install doğrulama | Secret sızıntı testleri geçer; UI smoke yeşil; kurulu build kaynakla aynı |
| **1. Güvenilir tamamlama** | `needs_review`/`completed`/`failed` ayrımını düzelt | Idle guard’ı tipli sonuç yap; `propose_file_edit`’i iş say; timeout’u çıktıya yaz; doğrulama kaydını çözülebilir yap; hata başına 3 tekrar sınırı | UI smoke geçer; Demo #5 `needs_review` veya `completed`; 276 test korunur |
| **2. Yürütme sınırı** | Komutu gerçekten sınırla | Process manager; PTY/arka plan; GUI süreçlerini ayrı yönet; ağ/dosya politikası; Job Object/restricted token veya WSL/Docker; kişisel otomatik kapat | Betik dışarıya yazamaz/okuramaz; GUI komutu zamanında durur; süreç ağacı temizlenir |
| **3. Ajan çekirdeği + Git** | Bakımı kolay, test edilebilir çekirdek | `runAgent`’ı `main.ts`’ten çıkar; Tool Manager/manifest; provider registry; görev başına Git dalı; commit öncesi test; `git add -A` yerine kapsam | 60 araç parity; canlı Git temp repo testi; commit yalnızca görev değişiklikleri |
| **4. Bağlam, bellek, kod zekâsı** | Daha iyi planlama, daha az token | Dosya haritası; sembol/lexical arama; isteğe bağlı yerel embedding; bellek redaksiyonu/rıza; bağlam bütçesi ölçümü | Büyük projede doğru dosya seçimi; secret yok; bellek testleri |
| **5. Genişletilebilirlik ve kontrollü iyileştirme** | Codex benzeri ekosistem | MCP stdio; uygulama içi Playwright; rol profilleri; ayrı dal + diff + test + onayla self-improvement; fallback; CI/install smoke | MCP mock; browser loopback; rol testleri; otomatik merge yok; kurulu smoke |

**Sıra gerekçesi:** Önce veri sızıntısı ve yanlış durum düzeltilmeden yeni özellik eklemek, güvenilmeyen bir ajanı daha yetenekli yapar. Sandbox, ajan yeteneklerinden önce gelir. Git ve MCP, ancak çekirdek durum makinesi güvenilir olduktan sonra anlamlıdır.

---

## 9. Test ve kabul ölçütleri

### 9.1 Bu denetimde ölçülen komutlar

| Komut | Sonuç |
|---|---|
| `cmd /c "npm run typecheck"` | **Geçti**, çıkış 0 |
| `cmd /c "npm run build"` | **Geçti**; main 697,54 kB, preload 5,63 kB, renderer 1.398,47 kB |
| `cmd /c "npm run test:permissions"` | **276/276 geçti**, 0 fail, 5.896 ms |
| `cmd /c "npm run test:smoke"` | **Başarısız**; UI smoke `failed` ≠ `completed` |
| `node tests/installed-provider-check.mjs` | **Geçti**; sahte OpenAI uyumlu sunucu |
| `node --experimental-strip-types docs/evidence/file-search-sensitive-audit.mjs` | **Bypass doğrulandı**; `.env` ve `.codex-local/tasks.json` snippet’leri döndü |
| Canlı Demo #5 | **Başarısız**; 25 dk 50 sn, `failed` |
| Canlı hesap makinesi görevi (`b9a9ed70-…`) | **Başarısız**; 8 dk 55 sn, 3 araç, yazma aracı yok |
| `git` canlı kontrol | **Engellendi**; Git PATH’te yok, commit yok |
| GitHub CI | **Çalıştırılmadı** |

> **Kural:** Çalıştırılmamış test “geçti” sayılmaz. Önceki ekran görüntüsü/kanıt, güncel kaynak için geçerli sayılmaz; ayrıca belirtilir.

### 9.2 On iki senaryo matrisi

| # | Senaryo | Beklenen | Bu denetimde kanıt | Durum |
|---:|---|---|---|---|
| 1 | Proje açma + sohbet + geçmiş kalıcılığı | Çalışır | Kurulu smoke/persist ekran görüntüleri önceki kanıt; güncel yeniden koşu yok | **Önceki kanıt** |
| 2 | OpenAI uyumlu sağlayıcı + anahtar maskeleme | `/models` ve sohbet; anahtar sızıntısı yok | `installed-provider-check` güncel: geçti (`MODELS-ISTEGI: 2`, `CHAT-ISTEGI: 1`) | **Geçti (mock)** |
| 3 | Yerel model (UI smoke mock): oku + diff taslağı hazırla | Taslak başarıyla tamamlanır | Güncel UI smoke: `failed` | **Başarısız** |
| 4 | Taslağı uygula + geri al + çakışma koruması | Uygulanır; eski içerik değişmişse reddedilir | UI smoke görev assertion’ında durdu; sonraki testler çalışmadı; önceki kanıt var | **Çalıştırılmadı** |
| 5 | Test sonrası dosya değişikliği → eski kanıt geçersiz | `needs_review`; aynı test tekrar istenir | UI smoke ilgili bölüme ulaşmadı | **Çalıştırılmadı** |
| 6 | Başarısız test → düzelt → yeniden test | `completed` | UI smoke ilgili bölüme ulaşmadı | **Çalıştırılmadı** |
| 7 | Model 503 → `failed`; resume → tamamlanma | Resume çalışır; kanıt korunur | UI smoke ilgili bölüme ulaşmadı | **Çalıştırılmadı** |
| 8 | Sıfırdan not defteri: GUI + testler 3/3 | Tamamlanır veya dürüst `needs_review` | Demo #5: `failed` | **Başarısız** |
| 9 | Doğrudan `read_file('.env')` | Engellenir | Güncel UI smoke erken assertion geçti; unit testler | **Geçti** |
| 10 | `search_file_contents` / `files:preview` ile `.env` | Engellenir | Runtime: `.env` ve `.codex-local/tasks.json` snippet’leri; `files:preview` statik | **Başarısız (runtime + statik)** |
| 11 | Yabancı frame’den IPC | Reddedilir | `assertTrustedIpcSender` var; doğrudan test yok | **Doğrulanmadı** |
| 12 | Git dalı + commit | Dal oluşur; commit yalnızca görev değişikliklerini alır | Git yok; canlı test engellendi | **Engellendi** |

**Ek gerçek vaka — hesap makinesi:** Görev `b9a9ed70-3bb5-497a-80c8-944506002a1c` (19.10.2026 14:06:45–14:15:40) `failed`. Plan 3 adım; yalnızca `list_files` ve iki `read_file` çalıştı; hiç `write_file`/`apply_patch`/`propose_file_edit`/`create_*`/`run_tests` yok. Model, aynı çalışma alanındaki eski VPN/MainActivity bağlamını okudu; son model isteği 3×120 sn sonra timeout oldu. Ayrıntı: `docs/evidence/EVIDENCE-SUMMARY-2026-10-19.md` bölüm 5.1.

### 9.3 Aşama kabul testleri

| Aşama | Zorunlu testler | Kabul ölçütü |
|---|---|---|
| 0 | `.env`, `.ssh`, `id_rsa`, `.codex-local/tasks.json`, `undo.json`, `backups/*`, `@user/desktop` için arama/okuma/önizleme; CSP/izin handler statik testi; UI smoke | Hiçbir secret sonuç dönmez; UI smoke geçer; 276 test korunur; build/install aynı |
| 1 | Idle 3 tur; proposal-only; pending=0 + failed check; timeout -2; başarısız komut sonrası başarılı test; resume | Doğru `needs_review`/`completed`/`failed`; Demo #5 yanlış `failed` vermez; UI smoke geçer |
| 2 | Betik dosya okuma/yazma/ağ; GUI komut; süreç ağacı; iptal; timeout | Sandbox dışına erişim yok; süreçler temizlenir; GUI 3 dk’da durur |
| 3 | 60 araç parity; tool manifest; 67 IPC; Git temp repo; commit kapsamı | Şema/case farkı yok; orphan yok; commit yalnızca görev dosyaları; canlı Git geçer |
| 4 | Dosya haritası/retrieval; bellek redaksiyonu; bağlam bütçesi | Doğru dosya seçimi; secret yok; bellek temizlenebilir |
| 5 | MCP mock; Playwright loopback; rol profilleri; self-improvement diff; CI/install | İzinsiz araç yok; browser yerel; otomatik merge yok; kurulu smoke geçer |

### 9.4 Kapatılması gereken test boşlukları

- `main.ts` / `runAgent` için doğrudan birim/entegrasyon testi yok.
- `assertTrustedIpcSender` için saldırı testi yok.
- `files:search`, `files:preview`, `search_file_contents` için hassas dosya testi yok.
- CSP ve `setPermissionRequestHandler` için test yok.
- Yedek/undo için bağımsız test yok.
- Canlı Git için test yok; ilk commit (unborn repo) davranışı belirsiz.
- Kurulu build’in 3 dakikalık `run_command` sınırı için test yok.
- Gerçek bulut sağlayıcısı, gerçek Android/Windows build ve gerçek kurulum smoke’u yok.
- GitHub Actions hiç çalıştırılmadı.

---

## 10. İlk üç düzeltme

> Bu üç düzeltme bu aşamada **uygulanmadı**. Kaynak kod değişikliği için onay bekleniyor.

### Düzeltme 1 — Tek hassas yol politikası (P0)

**Amaç:** Ajanın okuyabildiği her yolun aynı güvenlik politikasından geçmesi.

**Dokunulacak yerler:**

- `electron/sensitive-files.ts`: `.codex-local`, yedek/trash, görev/undo dosyaları ve hassas dizinler için genişletilmiş politika.
- `electron/main.ts:574-586` `readProjectFile`: `.env`/anahtar reddi korunmalı; `.codex-local` zaten `validateRelativePath` ile engelli, bu davranış testle sabitlenmeli.
- `electron/main.ts:3076-3092` `runFileSearchFlow`: `caller:'tool'` için hassas dosya filtresi; UI araması için ayrı, açık kullanıcı akışı.
- `electron/file-search.ts:278-344` `scanDirectoryForQuery`: opsiyonel `shouldInclude`/`isSensitive` yüklemi; varsayılan güvenli.
- `electron/main.ts:5052-5069` `files:preview`: hassas dosya kontrolü; kullanıcıya açık “gizli dosyayı göster” onayı olmadan reddet.
- `electron/main.ts:3765-3767` araç dispatch: `find_files`/`search_file_contents` için `@user` kapsamını kaldır veya onaylı kaynak köküne çevir.
- `electron/main.ts:3364-3365` şema: `@user` görünmüyorsa çözümleyici de kabul etmemeli; şema ile davranış aynı olmalı.

**Testler:**

- Proje içinde `.env`, `.ssh/id_rsa`, `.codex-local/tasks.json`, `.codex-local/undo.json`, `.codex-local/backups/*.json` oluştur.
- `read_file` ile `.env` ve `.codex-local` yollarının reddedildiğini; `search_file_contents`, `find_files`, `files:preview`, `files:search` ile aynı içeriklerin dönmediğini doğrula.
- Normal `src/app.ts` gibi dosyaların hâlâ okunabildiğini doğrula.
- `@user/desktop` ve `@user/documents` için ajan çağrısının reddedildiğini doğrula.

**Kabul:** Hiçbir yolla secret dönmez; hassas olmayan dosya okuma ve arama çalışır; mevcut 276 test + yeni testler geçer.

### Düzeltme 2 — Boş tur ve tamamlanma durumunu düzelt (P0)

**Amaç:** Taslak hazırlayan görev “failed” olmasın; gerçek durum dürüst olsun.

**Dokunulacak yerler:**

- `electron/main.ts:4317-4332`: `throw` yerine tipli `IdleStop`/`NeedsReview` sonucu.
- `electron/main.ts:4486-4507`: `needs_review` dalını idle durumu için de çalıştır; `failed` yalnızca gerçekten çözülemeyen hata için.
- `electron/main.ts:4489`: `completedWork` listesine `propose_file_edit` ekle; `read_file` tek başına iş sayılmasın ama taslak sayılsın.
- `electron/agent-orchestrator.ts:148-151`: `shouldStopForIdleTurns` yalnızca `pendingSteps` değil, başarısız kontrol/eksik kabul testi için de durmalı.
- **Görev bağlamı izolasyonu:** Yeni proje/uygulama isteğinde önceki görevin `workspace.messages` içeriğini körü körüne taşıma; yalnızca özet/ilgili bağlamı ver. “Yeni uygulama” niyetinde `list_files` ile eski projeyi taramak yerine `create_directory`/`create_*_project`/`write_file` yolunu zorunlu kıl.
- **Plan–araç bağlama:** Plan adımı “dosya oluştur” diyorsa ilk N turda yazma aracı yoksa görevi `needs_review`/`blocked` yap; salt `list_files`/`read_file` ilerleme sayılmasın.
- `tests/ui-smoke.mjs:175`: ürün kararına göre `needs_review` veya `completed` beklentisini netleştir; iki yolu da test et. Hesap makinesi vakası için boş projede `write_file`/`propose_file_edit` çağrısını doğrulayan ayrı E2E ekle.

**Kabul:** UI smoke geçer; proposal-only görevde kullanıcı “taslak hazır, doğrulama bekliyor” görür; 3 boş tur sonrası durum `failed` değil `needs_review` olur; boş projede hesap makinesi görevi en az bir yazma aracı çağırır; 276 test korunur.

**Uygulama durumu (19.10.2026, kaynak):** Düzeltme 2 kapsamındaki maddeler uygulandı.

- `electron/agent-intent.ts`: `shouldIsolateNewProjectRequest` ve `requestsProposalOnly` eklendi. “Bir hesap makinesi uygulaması yapalım” gibi istekler mevcut proje düzeltme/tamamlama isteklerinden ayrılıyor; “sadece diff/taslak hazırla, dosyayı değiştirme” gibi istekler taslak teslimi olarak işaretleniyor.
- `electron/main.ts` `runAgent`: yeni proje isteğinde model yalnızca son kullanıcı mesajını ve temiz hafızayı görüyor; ilk başarılı dosya işlemine kadar `list_files`/`read_file`/arama/analiz araçları araç şemasından çıkarılıyor, yazma sonrası tüm araçlar geri açılıyor. Araçsız turlarda modele doğrudan `write_file`/`propose_file_edit` çağrısı yapması söylenıyor; bağlam bütçesi en geniş araç şemasına göre hesaplanıyor.
- Tamamlanma: `propose_file_edit` iş kanıtı sayılıyor; üst üste araçsız turda mevcut dosya/taslak işi varsa görev `failed` yerine `needs_review` oluyor. Yalnızca taslak isteyen görevlerde otomatik plan atlanıyor; taslak teslimi görevi `completed` kapatıyor.
- `electron/agent-orchestrator.ts` + `electron/main.ts`: `shouldStopForIdleTurns` artık yalnızca açık plan adımlarına değil, tamamlanmamış doğrulamaya (başarısız/eskimiş kontrol, çalıştırılmamış kabul testi) da bakıyor. Model üst üste araçsız kalırsa görev 96 tura kadar dönmek yerine mevcut kanıtlarla dürüst duruma (`completed`/`needs_review`/`failed`) finalize ediliyor; “1 kabul komutu için güncel başarılı test kaydı yok” gibi açıklama kullanıcıya gösteriliyor.
- `electron/agent-orchestrator.ts`: ağ hatası kalıbındaki sözcük sınırı düzeltildi; `mobileconnectionapp` gibi bir yol artık `econn` sanılmıyor, `ENOENT` isteği `filesystem` olarak sınıflanıyor.
- `electron/main.ts` `streamCompletion`: sabit 120 sn istek zaman aşımı yerine ilerleme tabanlı zaman aşımı (120 sn hareketsizlik + 10 dk üst sınır); yavaş ama ilerleyen yerel model yanıtı erken kesilmiyor.
- `electron/main.ts`: `parseLocalTextFileOperation` ana sürece bağlandı (`answerLocalTextFileFastPath`). Proje kökünde veya açıkça belirtilen kullanıcı klasöründe basit metin dosyası oluşturma/okuma model çağrısı olmadan yapılıyor; değiştirme isteği doğrudan yazmıyor, inceleme taslağı üretiyor. Hassas dosya adları ve kod/uygulama istekleri hızlı yoldan çıkarılıyor.
- `electron/main.ts`: `refreshFileIndex` ile oluşturulan dosya dizini artık `runFileSearchFlow` içinde kullanılıyor; içerik araması olmayan ve dizin 15 dakikadan eski olmayan sorgularda canlı tarama yerine indeks sonucu dönüyor ve “Hızlı sonuç” bildirimi ekleniyor.

**Doğrulama (kaynak):** 278/278 birim testi, `npm run typecheck` ve `npm run build` temiz. UI smoke’a deterministik bir “yeni hesap makinesi” senaryosu eklendi: mock model eski sohbet bağlamı sızarsa veya ilk turda hâlâ `read_file`/`list_files` sunulursa testi kasten başarısız edecek biçimde yazıldı; senaryo `write_file` + `run_tests` + adım tamamlama ile `completed` bekliyor. **E2E doğrulama (19.10.2026):** `npm run test:smoke` tüm senaryolarla geçti — gerçek yerel Qwen taslak akışı, yerel metin dosyası yolu, dosya dizini araması, mock ajan, hesap makinesi regresyonu, gruplu web projesi, elle terminal/onay, tazelik/doğrulama ve model-hatası kurtarma senaryoları dahil. Kanıt: konsol çıktısı “UI smoke test passed”, ekran görüntüsü `release/ui-smoke.png`. **Paketli doğrulama (19.10.2026):** `npm run test:packaged`, taşınabilir `release\Ultron 1.1.0.exe` (19:13 derlemesi) üzerinde aynı E2E paketini geçti; smoke, betiğin başlattığı paketli uygulamaya CDP (`UI_SMOKE_DEBUG_PORT`) üzerinden bağlanır (kanıt: `tests/run-packaged-smoke.ps1` satır 41–54, `tests/ui-smoke.mjs` satır 10, 149). **Kurulu uygulama doğrulaması (19.10.2026):** Kurulum sessiz çalıştırıldı (`Ultron Setup 1.1.0.exe /S`, çıkış kodu 0); kurulu `app.asar` SHA-256 `7625F896…3FEB9C` yeni derlemeyle birebir aynı. `npm run test:installed` iki oturumda geçti: kurulu uygulama sohbet kontrolü ve yeniden açılışta sohbet geçmişi kalıcılığı. Kanıt: `release/installed-smoke.png`, `release/installed-persist.png`.

### Düzeltme 3 — Doğrulama, timeout ve kurulu build güvenilirliği (P0/P1)

**Amaç:** Geçici bir komut hatası görevi kalıcı olarak kilitlemesin; timeout doğru sınıflansın; düzeltme gerçekten kullanıcıya ulaşsın.

**Dokunulacak yerler:**

- `electron/main.ts:867-897`: timeout çıktısına `Komut zaman aşımına uğradı (exit -2)` ekle; yalnızca UI olayına bırakma.
- `electron/agent-orchestrator.ts:49-77`: exit code `-2`/`-3` ve “zaman aşımı” metnini `resources` olarak sınıflandır.
- `electron/agent-verification.ts:78-107`: keşif komutu ile kabul testini ayır; başarısız keşif komutunu aynı komutun başarılı tekrarı veya açık kullanıcı feragati ile çözülebilir yap; başarılı `run_tests`’in ilgisiz eski hatayı temizlemesini engelle.
- `electron/agent-orchestrator.ts:31,104-115`: aynı imza için 3 tekrar sınırı; `shouldBlock`’u gerçekten çalıştır.
- `electron/main.ts:3669-3674`: 3 dakikalık sınırı koru; `run_tests`/build için ayrı, yeterli timeout.
- Release: yeniden `npm run build`, installer üret, kurulu asar’ın yeni sınırı içerdiğini doğrula; kurulu smoke çalıştır.

**Kabul:** Demo #5 benzeri akışta testler geçtikten sonra görev `needs_review` veya `completed` olur; timeout `unknown` değil `resources` görünür; aynı hatalı çağrı sonsuz dönmez; kurulu build kaynakla aynı davranır.

### Neden sandbox ilk üçte değil?

OS düzeyi sandbox, Job Object/restricted token/AppContainer veya WSL/Docker gerektiren daha büyük bir iştir. İlk üç düzeltme, mevcut güvenlik açığını **hafifletir** (secret okuma, timeout, durum), ancak **tam izolasyon sağlamaz**. Bu nedenle Aşama 2’de sandbox zorunlu kapıdır; o tamamlanmadan “güvenli otonom ajan” denmemelidir.

---

## Sonuç ve karar noktası

Ultron’un temeli var; fakat mevcut haliyle “Codex benzeri, güvenilir, sağlayıcıdan bağımsız” bir ürün değil. En büyük risk model kalitesi değil, **güvenlik politikasının tutarsızlığı ve görev durum makinesinin yanlış sonuç üretmesi**. 8B modelle frontier davranışı vaat etmek doğru olmaz; doğru hedef, modelden bağımsız çalışan plan/araç/doğrulama/sandbox hattıdır.

Önerilen sıra: **Düzeltme 1 → 2 → 3 → Aşama 2 sandbox → Tool Manager/Git → bağlam/bellek → MCP/browser/roller.** Her aşamada mevcut 67 IPC ve 60 araç korunmalı; yeni yetenek eklemeden önce mevcut akış yeşil olmalıdır.

**İlk denetim aşamasında kaynak kod değiştirilmedi.** Sonraki bölümlerde düzeltmeler uygulandı; güncel doğrulama ve kurulum bilgileri son ek bölümündedir.

---

## Ek — Codex tarzı arayüz teslimi (19.10.2026)

**Durum:** Tamamlandı. Kaynak, testler, Windows paketi ve kurulu uygulama güncellendi. Ayrıntılı tasarım ve kanıt dokümanı: `docs/UI-CODEX-STYLE-2026-10-19.md`.

**Kapsam:** Açık gri kenar çubuğu + beyaz ana panel, sade tipografi, ana sayfa, görev listesi, üst başlık, sohbet baloncukları, besteci, profil menüsü, ayarlar, onay/inceleme kartları, modaller, terminal çevresi ve sağ panel sekmelerinin tamamı. OpenAI logosu/marka varlığı kullanılmadı; düzen ve çalışma dili özgün biçimde uyarlandı. Mevcut işlevler ve test sözleşmeleri korundu; kullanıcı verisi değiştirilmedi.

**Final doğrulama:**

- `npm run test:permissions`: **278/278 geçti**, 0 başarısız.
- `npm run typecheck`: geçti (node + web).
- `npm run test:smoke`: geçti.
- `npm run test:packaged`: final taşınabilir paket üzerinde geçti.
- `npm run dist`: Setup + portable üretildi.
- Sessiz kurulum (`/S`): çıkış kodu 0.
- Kurulu `app.asar` SHA-256 `672767FD78E9ED3122DFCEC4E6DF4353F74BEF83D2ABBF4C1A7D3F87FB88AD54`; yeni derlemeyle birebir aynı.
- `npm run test:installed`: iki oturum geçti (sohbet + yeniden açılışta kalıcılık).
- Görsel denetim: `release/installed-home-codex.png`, `release/installed-profile-codex.png`, `release/installed-settings-codex.png`, `release/installed-yerel-ai-codex.png`, `release/installed-hafiza-codex.png`, `release/installed-codex-final.png`, `release/ui-smoke.png`.

**Yeni yükleyici hash'leri:**

- `Ultron Setup 1.1.0.exe`: `8BC5AD2B50803809738CC5FCC780AD7B9670302AC43C9DCD733450623DA7863E`
- `Ultron 1.1.0.exe`: `B6B16C4A675FF11EEF41AB8A2F386CB5CB34E648821724B86AFA2364CBEAA2BE`
- `win-unpacked\Ultron.exe`: `F0FE7B7B10C51868AEB546E60BB8D8F53C7331E0DE307B23676890AF819BF8FC`

**Sınırlar:** Yükleyici imzasızdır. Açık tema varsayılandır; ayrı karanlık tema anahtarı yoktur. Bu çalışma görsel/etkileşim katmanıdır; ajan izin/güvenlik politikasını değiştirmez. OpenCode uyarlamasının P0 izin kural motoru ve adım bütçesi bu teslime dahil değildir.