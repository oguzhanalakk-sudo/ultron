# Ultron Mimari Denetimi

**Tarih:** 19 Ekim 2026  
**Kapsam:** `C:\Users\user\Desktop\codexx` — Electron/TypeScript/React + yerel Ollama ajanı  
**Yöntem:** Salt-okunur kaynak incelemesi, bağımlılık ve test envanteri, çalışan kurulu uygulamanın canlı görev kanıtlarının analizi, resmî GitHub API ve resmî bulut fiyatlandırma sayfalarının doğrulanması.  
**Bu denetim sırasında uygulama kaynak kodu değiştirilmedi.**

---

## 1. Yönetici özeti

Ultron, sıfırdan kurulacak bir prototip değil; gerçekten çalışan, yerel-öncelikli bir masaüstü kodlama ajanıdır. Güçlü yanları:

- Electron + React + TypeScript ile paketlenen, Windows'ta kurulabilen bir uygulama.
- Ollama üzerinden **tamamen yerel** model akışı; bulut zorunluluğu yok.
- 58 ajan aracı: dosya okuma/yazma, toleranslı yama, terminal, test, Git durumu/farkı, geri alma, Android/Windows/web proje üretimi, web araştırması, çözüm hafızası, 18 dil bilgi tabanı.
- Kalıcı görev günlüğü, plan adımları, doğrulama makbuzları, izin yöneticisi, denetim kaydı ve yedekli geri alma.
- Gerçek testlerle doğrulanmış örnekler: Tkinter/SQLite masaüstü uygulaması, web API'si, Android sayaç projesi.

Temel eksikler (bu görevin kapsamı açısından):

| Alan | Mevcut durum |
|---|---|
| Model sağlayıcı bağımsızlığı | **Yok.** `AppConfig.provider` yalnızca `'ollama'`; URL doğrulaması yalnızca loopback kabul ediyor. OpenAI uyumlu/bulut sağlayıcı koddan bilinçli olarak çıkarılmış. |
| MCP | **Yok.** Kaynakta “MCP kaynakları bu sürümde desteklenmez” notu var. |
| Tarayıcı otomasyonu | **Ajan aracı olarak yok.** `playwright-core` yalnızca test koşucularında kullanılıyor; uygulama paketinde tarayıcı aracı yok. |
| Git iş akışı | **Kısmi.** `git_status`, `git_diff`, `undo_change` var; dal açma, commit, geri dönüş/merge yok. Ayrıca bu makinede `git` komutu PATH'te bulunamadı. |
| Çoklu ajan / rol profilleri | **Yok.** Tek `runAgent` döngüsü; paralel alt ajan yok. |
| Bulut CI/kuyruk | **Yok.** GitHub Actions iş akışı, görev kuyruğu veya bulut aktarımı yok. |
| Adım kanıtı | **Kısmi.** `update_task_step` modelin “done” beyanını kabul ediyor; adımı teste/dosya kanıtına bağlayan zorunlu kayıt yok. |
| Çökme sonrası grup kurtarma | **Yok.** Çok dosyalı yazma grubu için kalıcı işlem günlüğü yok. |
| Semantik hafıza | **Yok.** Sözcük/önek eşleşmesi ve kategori ağırlığı var; embedding yok. |

Canlı görev kanıtı, en önemli teknik sorunu da gösteriyor: demo, 6 dosyalık Tkinter projesini üretip **3 gerçek unittest'i geçirdiği hâlde** görev `failed` durumunda kaldı. Hata: `Ollama boş veya geçersiz bir yanıt döndürdü.` Bu, “yapılan işi başarısız gösterme” hedefinin hâlâ çözülmediğini kanıtlıyor.

---

## 2. Doğrulanan çalışma ortamı

| Bileşen | Değer / durum |
|---|---|
| İşletim sistemi | Windows 11 x64 |
| CPU / RAM | Intel Core i7-13620H / 16 GB |
| GPU | NVIDIA RTX 4060 Laptop, 8 GB VRAM |
| Node.js | 22.22.1 |
| Python | 3.11.9 |
| Ollama | `qwen3:8b` kurulu ve çalışıyor |
| Git | **`where.exe git` bulunamadı.** `.git` klasörü var ancak `refs/heads` altında commit yok; yalnızca Codex CLI'ın `refs/codex/...` kayıtları var. |
| Proje kökü | `C:\Users\user\Desktop\codexx` (git deposu biçimsel olarak var, kullanılabilir geçmiş yok) |
| Kurulu uygulama | `%LOCALAPPDATA%\Programs\Ultron\Ultron.exe` (sürüm 1.1.0) |
| Son paket | `release\Ultron Setup 1.1.0.exe` |

> Not: `docs/technical-status.md` daha önceki bir ortam taramasında Git'in bulunduğunu yazıyor. Bugünkü ölçümde Git PATH'te yok. Bu çelişki, Git tabanlı iş akışı devreye alınmadan önce çözülmelidir.

---

## 3. Depo yapısı ve giriş noktaları

```
electron/
  main.ts                 ~388 KB — IPC, ajan döngüsü, 58 araç, Ollama akışı, plan, doğrulama
  agent-orchestrator.ts   bütçeler, hata sınıflandırma, bağlam sıkıştırma
  agent-verification.ts   doğrulama defteri, kabul testleri, tazelik
  agent-intent.ts         dosya/kod niyeti algılama
  agent-editing.ts        toleranslı yama, EOL koruma, sayfalama
  task-store.ts           atomik görev günlüğü, durum makinesi
  memory-store.ts         kullanıcı hafızası
  conversation.ts         sohbet/görev sınıflandırma, bağlam kırpma
  model-provider.ts       yalnızca Ollama loopback URL doğrulaması
  permissions.ts / permission-manager.ts / command-environment.ts
  local-ai.ts             Ollama model/donanım önerileri
  language-knowledge.ts   18 dil bilgi tabanı
  android-build-tool.ts / windows-build-tool.ts / web-build-tool.ts
  file-search.ts / software-discovery.ts / app-adapters.ts
  plugin-manager.ts       yerel eklenti sistemi (ağ izni reddedilir)
  web-research.ts         arama sağlayıcısı şablonları, SSRF korumaları
src/
  App.tsx                 ~131 KB — tüm arayüz (sohbet, paneller, ayarlar, hafıza)
  styles.css / settings.css / local-ai.css
tests/
  40+ Node test dosyası; ayrıca ui-smoke, installed-*, perf, agent-flow-live-demo
samples/
  windows-taskboard, web-taskboard, android-counter
docs/
  technical-status.md, agent-development-audit.md, verification-freshness.md
```

### Ajan çalışma akışı

1. `agent:chat` → `runAgent`.
2. Niyet sınıflandırması (`conversation.ts`, `agent-intent.ts`).
3. Plan üretimi (`makeTaskPlan`); başarısızsa deterministik 3 adımlı yedek plan.
4. `toolsForRequest` ile istek türüne göre araç şeması seçimi.
5. `streamCompletion` → `streamOllamaCompletion` (`/api/chat`, NDJSON, `think:false`, `num_ctx:16384`).
6. Araç çağrıları sırayla `runTool`; her sonuç `agent-verification` ile değerlendirilir.
7. `compactAgentContext` her turda zinciri `maxContextChars: 24.000` karaktere sıkıştırır.
8. Görev sonu: plan, doğrulama makbuzları, kabul testleri ve hata durumuna göre `completed` / `needs_review` / `failed`.

### Görev durum makinesi

- `TaskRecord.status`: `running`, `waiting_approval`, `interrupted`, `paused`, `blocked`, `needs_review`, `completed`, `failed`, `cancelled`.
- `TaskRecord.stage`: `analyzing`, `planning`, `awaiting_approval`, `executing`, `evaluating`, `correcting`, `testing`, `finalizing`, `paused`, `interrupted`, `blocked`, `completed`, `failed`, `cancelled`.
- Uygulama açılışında yarım görevler `interrupted` olur; İşlemler panelinden sürdürülebilir.
- Çift çalışmayı önleyen tek etkin görev kilidi var.

---

## 4. Yetenek matrisi (istenen → mevcut)

| İstenen yetenek | Durum | Kanıt / sınır |
|---|---|---|
| Mevcut projeyi analiz etme | ✅ | `analyze_*_project`, `list_files`, `read_file`, `search_code` |
| Yeni dosya oluşturma | ✅ | `write_file`, `create_windows_desktop_project`, `create_web_project` |
| Mevcut dosyayı kontrollü değiştirme | ✅ | `apply_patch`, `propose_file_edit`, önce okuma zorunluluğu, yedek |
| Test çalıştırma ve sonucu okuma | ✅ | `run_tests`, `inspect_errors`, gerçek çıkış kodu |
| Hata mesajı analizi | ✅ | `analyzeAgentError`, 11 kategori, sonraki adım önerisi |
| Basit hatayı düzeltme | ✅ (kısmi) | Düzeltme döngüsü var; 8B modelin başarı oranı sınırlı |
| Düzeltmeden sonra testi yeniden çalıştırma | ✅ | Doğrulama defteri, aynı kontrol kimliği |
| Başarısız değişikliği geri alma | ✅ (dosya bazlı) | `undo_change`, yedek; çok dosyalı grup için çökme kurtarma yok |
| Görev geçmişini kaydetme/yükleme | ✅ | `.codex-local/tasks.json`, atomik yazım |
| Sağlayıcı hatasını yönetme | ⚠️ | Ollama için 3 deneme + geri çekilme; **başka sağlayıcı yok** |
| Çevrimdışı devam | ✅ | Yerel Ollama; bulut kuyruğu yok |
| API anahtarlarını koruma | ⚠️ | API anahtarı kavramı yok; eklenti ağ izni reddediliyor |
| Web araştırması | ✅ | `web_search`, `fetch_web_page`; SSRF/loopback ve güvenilmeyen veri kuralları |
| MCP araçları | ❌ | Kaynakta açıkça desteklenmiyor |
| Playwright tarayıcı testi | ❌ (ajan) | Yalnızca test koşucusunda `playwright-core` |
| Git dalı/commit/geri dönüş | ⚠️ | Yalnızca status/diff/undo; Git kurulu değil |
| Çoklu uzman ajan | ❌ | Tek döngü; rol profilleri yok |
| Kalıcı hafıza | ✅ (kısmi) | Kullanıcı + proje + çözüm hafızası; dışa/içe aktarma ve embedding yok |
| Bulut test/derleme | ❌ | GitHub Actions/Colab/HF entegrasyonu yok |
| Kendi kodunu kontrollü geliştirme | ❌ | Dal/test/geri alma guardrail'i yok |
| Adım kanıtı | ⚠️ | `done` beyanı kanıt zorunluluğu taşımıyor |
| Çok dosyalı atomik işlem | ✅ / ⚠️ | Başlangıç üreticileri grup hâlinde; elle çoklu taslak değil; çökme kurtarma yok |
| Semantik hafıza | ❌ | Sözcük eşleşmesi |

---

## 5. Araç envanteri (58)

- **Dosya:** `list_files`, `open_file`, `read_file`, `search_code`, `search_files`, `write_file`, `apply_patch`, `create_directory`, `rename_path`, `propose_file_edit`, `delete_file`, `find_files`, `search_file_contents`, `find_duplicate_files`, `file_index_refresh`.
- **Komut/test:** `run_command`, `run_powershell`, `run_tests`, `inspect_errors`, `analyze_logs`, `get_environment`, `security_audit`, `network_inventory`.
- **Platform:** Android (10), Windows (4), web (6).
- **Git/görev:** `git_status`, `git_diff`, `undo_change`, `set_task_plan`, `update_task_step`, `project_info`, `update_project_memory`.
- **Araştırma/hafıza:** `web_search`, `fetch_web_page`, `solution_memory`, `language_knowledge`.
- **Envanter/eklenti:** `software_inventory`, `run_app_action`, `check_capabilities`.

Şema boyutu: **28.372 karakter** (58 aracın tamamı). `toolsForRequest` platform dışı araçları eler; tipik bir Windows/Tkinter görevinde yaklaşık 25–30 araç kalır. Yine de şema + sistem istemi + 24.000 karakterlik zincir, 16.384 token bağlamda Türkçe tokenizasyonuyla sınırı aşabilir.

---

## 6. Güvenlik modeli değerlendirmesi

### Güçlü yanlar

- Dosya araçları proje kökü + açıkça yetkilendirilmiş ek kaynaklarla sınırlı; symlink ve sürücü kökü reddedilir.
- Terminal komutları allowlist + shell ayraç yasağı + proje dizini ile sınırlı.
- Yıkıcı komutlar tek tek onay ister; PowerShell otomatik çalışması salt-okunur allowlist ile sınırlı.
- API benzeri sırlar denetim kaydında maskelenir; ortam değişkenleri filtrelenir.
- Web içeriği “güvenilmeyen veri” olarak işaretlenir; modelin talimat olarak uygulaması yasaklanır.
- Eklenti paketleri ağ izni isterse etkinleştirme reddedilir.
- `npm audit` geçmişte 0 bulgu; offline envanter testi sabit bulut uç noktası/telemetri arar.

### Sınırlar

- **İşletim sistemi sandbox'ı yok.** Onaylanan proje betiği kullanıcı hesabının tüm dosya/ağ yetkilerine sahiptir.
- Prompt injection'a karşı matematiksel garanti yok; güvenlik, izin/araç şeması katmanlarına dayanır.
- Hassas dosya/ortam filtresi isim tabanlıdır; her sır biçimini yakalamaz.
- API anahtarı desteği eklenirse, anahtarın renderer'a dönmemesi, loglanmaması ve yalnızca kullanıcı veri klasöründe/ortam değişkeninde tutulması gerekir. Mevcut offline testi bu yüzden yeniden yazılmalıdır; testi silmek güvenlik regresyonu olur.

---

## 7. Test ve doğrulama durumu

- Son doğrulanan birim/izin testi: **253/253** (bu oturum öncesi; `tsc` temiz).
- `npm run dist` ve sessiz kurulum daha önce başarılı; asar içeriği yeni kod dizileriyle doğrulandı.
- Canlı demo altyapısı gerçek `python -m unittest discover -s tests -v` çalıştırıyor ve `ranTests >= 1` arıyor.
- UI smoke, kurulu uygulama, performans ve paketli testler mevcut.
- **Eksik:** yeni sağlayıcı katmanı, MCP, Git dalı ve adım kanıtı için henüz test yok (bu görevde eklenecek).

> Not: `docs/technical-status.md` içindeki 147/206 gibi sayılar önceki dilimlere aittir; güncel sayı için her doğrulamada komut yeniden çalıştırılmalıdır.

---

## 8. Git ve geri dönüş durumu

- `.git` dizini var; `HEAD` `refs/heads/master` gösteriyor ancak `refs/heads` boş — **commit yok**.
- `git` çalıştırılabilir dosyası PATH'te yok. Bu nedenle mevcut `git_status`/`git_diff` araçları bu makinede hata verecektir.
- Öneri:
  1. Git for Windows'u kullanıcı onayıyla kur (veya taşınabilir Git yolu tanımla).
  2. İlk commit'i yalnızca kullanıcı onayıyla oluştur; mevcut dosyaları ezme.
  3. Yedek olarak `codexx-backup-audit` benzeri bir kopya korunmalı.
- Git gelmeden “ayrı dalda çalış, test et, geri al” akışı gerçek anlamda doğrulanamaz.

---

## 9. Canlı E2E kanıtı ve kök neden analizi

**Görev:** “Basit bir not defteri uygulaması yap: Tkinter GUI, kaydet/aç, testleri olsun”  
**Proje:** `%TEMP%\opencode\ultron-demo-notepad-mvf8bk0w\windows-projects\not-defteri`  
**Sonuç:** `failed` — “Ollama boş veya geçersiz bir yanıt döndürdü.”

Gerçekleşenler:

- `create_windows_desktop_project` çağrıldı; 6 dosya üretildi:
  `app_ui.py`, `main.py`, `pyproject.toml`, `README.md`, `task_store.py`, `tests/test_task_store.py`.
- Testler gerçekten çalıştı: **3/3 unittest geçti** (`Ran 3 tests ... OK`).
- Demo, dosyaları uygulamak için 6 taslak daha denedi; “Bu taslak artık bulunamıyor” yanıtı aldı (taslaklar görev sonunda temizlendiği için koşucu artefaktı; dosyalar zaten mevcut).
- Görev günlüğünde son olay: `create_windows_desktop_project completed` → `stage-evaluating` → `task-failed`.
- Hata mesajında `done_reason`, `prompt_eval`, `eval` tanılaması **yok**; bu yüzden bağlam taşması doğrudan kanıtlanamıyor. Ancak ölçülen boyutlar riski açıkça gösteriyor:
  - 58 araç şeması: 28.372 karakter.
  - Zincir sınırı: 24.000 karakter.
  - `num_ctx`: 16.384 token.
  - Türkçe metin + JSON şeması ~2–2,5 karakter/token; 24.000 karakterlik zincir + ~13.000 karakterlik araç şeması + sistem istemi 16k token'a çok yaklaşabilir.
- Araç sonucu (`create_windows_desktop_project`) 6 dosyanın tamamını ve taslak JSON'larını içeriyor; 12.000 karakterde kırpılsa bile sonraki turda bağlamı büyütüyor.

**Sonuç:** Başarısızlık “model iş yapmadı” değil; **bağlam bütçesi + boş yanıt yönetimi** sorunudur. Öncelikli düzeltme:

1. Token farkındalıklı bağlam bütçesi (karakter yerine ölçülen token/şema payı).
2. Araç şemasını istek türüne göre daha agresif küçültmek (çekirdek + ilgili platform araçları).
3. Büyük araç sonuçlarını yapılandırılmış özetle döndürmek (dosya içeriklerini tekrar göndermemek).
4. `num_ctx`/`num_predict` için ölçülmüş bir denge (16k → 24k denemesi) ve boş yanıtta tanılamayı görev kaydına yazmak.
5. Aynı görevde model boş yanıt verirse, **yapılan gerçek işi** `needs_review` olarak korumak; asla “failed” diye silmemek.

---

## 10. Öncelikli bulgular

| Öncelik | Bulgu | Etki | Öneri |
|---|---|---|---|
| P0 | Boş Ollama yanıtı / bağlam taşması | Gerçek iş `failed` görünüyor | Token bütçesi, şema küçültme, tanılama, `needs_review` koruması |
| P0 | Git yok, commit yok | Dal/commit/geri dönüş doğrulanamaz | Git kurulumu + ilk commit (onayla) |
| P1 | Sağlayıcı bağımsızlığı yok | Bulut/OpenAI uyumlu model kullanılamaz | Sağlayıcı katmanı + güvenli anahtar saklama |
| P1 | Adım kanıtı model beyanına bağlı | Yanlış “tamamlandı” | Kanıt kimliği + kabul koşulu |
| P1 | Çok dosyalı çökme kurtarma yok | Yarım dosyalar kalabilir | Kalıcı işlem günlüğü |
| P2 | MCP yok | Araç ekosistemi kapalı | Minimal stdio MCP istemcisi + allowlist |
| P2 | Tarayıcı ajan aracı yok | Web uygulamaları gerçek tarayıcıda test edilemiyor | Playwright + sistem Chrome |
| P2 | Çoklu ajan yok | Uzmanlaşma yok | Rol profilleri; paralel alt ajan sonra |
| P2 | Bulut CI/kuyruk yok | Uzun/derleme işleri buluta taşınamıyor | GitHub Actions şablonu + isteğe bağlı kuyruk |
| P3 | Semantik hafıza yok | İlgili kayıtlar kaçabilir | Embedding opsiyonel |

---

## 11. Sonuç

Ultron'un temeli güçlü: gerçek araçlar, gerçek testler, kalıcı görev kaydı ve ciddi bir izin/doğrulama katmanı var. Eksik olan, bu temelin üzerine **sağlayıcı bağımsızlığı, kanıta bağlı adımlar, Git dalı iş akışı, MCP/tarayıcı araçları ve bulut CI** katmanlarını eklemek ve 8B yerel modelin bağlam sınırlarını mühendislikle yönetmektir.

Bu denetim, `docs/INTEGRATION-PLAN-2026-10-19.md` dosyasındaki aşamalı planın gerekçesini oluşturur. Plana göre önce çalışan sistemi bozmayan P0 düzeltmeleri, ardından sağlayıcı katmanı ve Git iş akışı gelecektir.
