# Ultron — Oturum Final Raporu (19 Ekim 2026)

> **İlke:** Bu raporda yalnızca kanıtı olan işler "doğrulandı" sayılır. Birim testi, sahte sunucu testi ve gerçek model testi birbirinin yerine sayılmaz. Üç etiket kullanılır:
>
> - **Uygulandı ve doğrulandı** — komut/test/ekran görüntüsü kanıtı var.
> - **Uygulandı, doğrulanmadı** — kod var; canlı veya entegrasyon kanıtı yok.
> - **Yapılmadı / sonraki aşama** — açıkça eksik.
>
> Ham model zekâsı ile mühendislik parity'si ayrı değerlendirilir. Yerel `qwen3:8b`, frontier modellerle eşit ham akıl yürütme kapasitesine sahip **değildir**; bu çalışma modelin çevresindeki iş akışını, araç disiplinini ve doğrulamayı güçlendirir.

---

## 1. Yönetici özeti

Bu oturumda mevcut Ultron kodu sıfırdan yazılmadan, denetim → plan → uygulama sırasıyla genişletildi:

1. **P0 bağlam/boş yanıt düzeltmesi:** Araç şeması ve konuşma uzunluğuna göre token farkındalıklı bağlam bütçesi; proje üretici araç çıktılarının özetlenmesi; gerçek iş varken model yanıtsız kalırsa sessiz `failed` yerine `needs_review`.
2. **Sağlayıcıdan bağımsız katman:** Ollama (yerel) + OpenAI uyumlu sağlayıcı; SSE akışı, tool-call birleştirme, model listesi; API anahtarı yalnızca ortam değişkeni veya kullanıcıya özel `provider-secrets.json` dosyasında; arayüzde sağlayıcı seçimi.
3. **Git iş akışı araçları:** Onaylı `git_branch` ve `git_commit`; tehlikeli adları reddeden doğrulama; force/merge/amend yok. Bu makinede Git kurulu olmadığı için canlı Git testi yapılamadı.
4. **CI iskeleti:** `.github/workflows/ci.yml` — `npm ci`, tip kontrolü, testler; sır kullanmaz, yükleme yapmaz.
5. **Kanıt ve raporlama:** 276/276 test, temiz tip kontrolü, kurulu uygulamada sağlayıcı uçtan uca testi, kurulu smoke testleri, canlı demo öncesi/sonrası kanıt arşivi.

**En önemli dürüstlük notu:** Aşağıdaki demo bölümü, yeni derlemenin canlı model davranışını gösterir. Demo #3 (eski derleme) ve Demo #4 (yalnızca bağlam düzeltmesi) 26 dakika sonunda hâlâ `running/evaluating` idi; bu, boş-tur korumasının neden gerekli olduğunun ölçülmüş kanıtıdır. Yeni koruma görevin **doğru şekilde sonlanmasını** hedefler; 8B modelin her görevi `completed` yapacağını garanti etmez.

---

## 2. Değişen ve eklenen dosyalar

### Yeni dosyalar

| Dosya | Amaç |
|---|---|
| `electron/provider-secrets.ts` | Anahtar doğrulama, atomik yazma, ortam değişkeni önceliği, maskeleme |
| `electron/openai-provider.ts` | OpenAI uyumlu SSE akışı, tool-call birleştirme, `fetchOpenAiModels`, JSON yedeği |
| `electron/git-workflow.ts` | Dal adı / commit mesajı doğrulaması, görev dalı üretimi |
| `tests/provider-secrets.test.ts` | Sır saklama, maskeleme, dosya izinleri, env önceliği |
| `tests/openai-provider.test.ts` | Yerel sahte HTTP/SSE sunucusuyla akış, tool-call, 401, boş yanıt, JSON yedeği |
| `tests/git-workflow.test.ts` | Dal adı ve commit mesajı güvenlik testleri |
| `tests/installed-provider-check.mjs` | Kurulu uygulamada sağlayıcı uçtan uca testi (sadece loopback) |
| `.github/workflows/ci.yml` | GitHub Actions CI (sırsız) |
| `docs/evidence/*` | Demo, sağlayıcı ve smoke ekran görüntüleri/kanıtları |

### Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `electron/main.ts` | P0 bağlam bütçesi/özetleme/`needs_review`; sağlayıcı ayarları; `streamCompletion` yönlendirmesi; `getModelStatus`; Git araçları |
| `electron/model-provider.ts` | İki sağlayıcı ve URL politikası (Ollama loopback; OpenAI https/loopback-http) |
| `electron/shared.ts` | `ModelProvider`, `AppSettings`; `AppConfig.provider` genişletildi |
| `electron/preload.ts` | `AppSettings` dönüş tipi; `apiKey`/`clearApiKey` alanları |
| `src/App.tsx` | Sağlayıcı seçimi, API anahtarı alanı, dinamik güvenlik/bağlantı metinleri |
| `src/vite-env.d.ts` | `getSettings`/`saveSettings` tipleri |
| `electron/agent-orchestrator.ts` | `computeAgentContextBudget` + testler |
| `tests/offline-inventory.test.ts` | Yeni güvenlik modeline göre güncellendi; anahtar sızıntısı denetimi |
| `package.json` | Yeni testler test paketine eklendi |

Geri alma noktası: `C:\Users\user\Desktop\codexx-backup-audit` (oturum öncesi tam kopya). Depoda kullanılabilir Git geçmişi yok (`git` kurulu değil; `.git` içinde commit yok).

---

## 3. P0 — Bağlam taşması ve boş yanıt

### Kök neden

Canlı demo #2/#3 kanıtı: model, `create_windows_desktop_project` aracından sonra boş/geçersiz yanıt döndürdü. 58 araç şeması ≈ 28.372 karakter; eski sabit zincir sınırı 24.000 karakter; `num_ctx` 16.384; Türkçe için ≈2–2,5 karakter/token. Bu birleşim bağlamı aşıyor; model araç çağrısı üretemiyor ve görev `evaluating` aşamasında kilitleniyordu.

### Uygulanan düzeltmeler

- **Token farkındalıklı bütçe:** `computeAgentContextBudget` → `toolTokens = şema karakteri / 3`, `availableTokens = ctx − 3072 − toolTokens`, `karakter = token × 2`, 6.000–24.000 aralığında sınırlama. Görev kaydına `context-budget` olayı yazılır.
- **Proje üretici çıktılarının özetlenmesi:** `create_windows_desktop_project` / `create_web_project` artık tam dosya içerikleri yerine yol/boyut/özet döndürür (`summarizeProjectProposals`).
- **Dürüst son durum:** Model kullanılamazsa ve gerçek iş yapılmışsa (`activeTaskFilesChanged` veya tamamlanmış iş aracı olayı) görev `failed` değil `needs_review` olur; hata analizi korunur.
- **Üst üste araçsız tur koruması:** Açık plan adımları varken model üst üste 3 tur araç çağrısı üretmezse görev 96 tura/26 dakikaya kadar dönmek yerine, gerçek dosya ve test işini koruyarak `needs_review` ile sonlanır. Bu, demo #3'te ölçülen kilitlenmenin doğrudan düzeltmesidir.
- **Araç süre sınırı:** Demo #5'te model not defteri GUI'sini `python .../main.py` ile başlattı; genel `run_command` aracının 15 dakikalık zaman aşımı görev süresini tek başına tüketebiliyordu. Genel terminal çağrısı 3 dakikaya indirildi; uzun derleme/testler kendi araçlarında (`run_tests`, `windows_build`) kalır. GUI/interaktif süreçler 3 dakika sonra süreç ağacıyla birlikte sonlandırılır.
- **Testler:** `tests/agent-orchestrator.test.ts` bütçe ve boş tur testleri; tam paket 276/276.

### Demo #3 (eski kurulu derleme) — karşılaştırma kanıtı

- Proje: `%TEMP%\opencode\ultron-demo-notepad-mvf90aox`
- Üretilen dosyalar: 6 (`app_ui.py` 4.579 B, `task_store.py` 3.005 B, `tests/test_task_store.py` 1.382 B, `main.py`, `pyproject.toml`, `README.md`)
- `python -m unittest discover`: **3/3 test geçti**, çıkış kodu 0
- Görev durumu: 26 dakika sonunda **`running` / `evaluating`** (zaman aşımı)
- Kanıt: `docs/evidence/agent-flow-demo-before-p0.json` + `.png`

Bu, "testler geçti ama görev yönetimi doğru sonlanmadı" durumunun ölçülmüş kanıtıdır.

### Demo #4 — yalnızca P0 (bağlam bütçesi + özetleme), boş-tur koruması yok

- Yeni derleme (16:16) üzerinde çalıştırıldı.
- 6 dosya üretildi; `python -m unittest discover` **3/3 geçti** (çıkış kodu 0).
- Ancak görev, testler geçtikten sonra ~20 dakika boyunca hiç araç çağrısı üretmedi ve 26 dakika sonunda hâlâ **`running` / `evaluating`** (zaman aşımı).
- Görev kaydındaki son 30 olayın 29'u `stage-evaluating`; son olay `run_command started` (zaman aşımı anında).
- Kök neden: plan 3 adım, hiçbiri `done` değil; model `update_task_step` çağırmıyor. Ajan `pendingSteps > 0` olduğu için devam etmeye zorluyor; `needs_review` yalnızca istisna yolunda devreye giriyor, metin-only yanıt istisna üretmiyor.
- Kanıt: `docs/evidence/agent-flow-demo-p0-only.json` + `.png`.

### Demo #5 — P0 + boş-tur koruması

{{DEMO5}}

---

## 4. Sağlayıcıdan bağımsız katman

### Uygulananlar

- `ModelProvider = 'ollama' | 'openai-compatible'`.
- Ollama: yalnızca `127.0.0.1`, `localhost`, `::1`; mevcut davranış ve varsayılan (`qwen3:8b`) korunur.
- OpenAI uyumlu: `https:` herkese açık; `http:` yalnızca loopback; kullanıcı adı/parola/query/fragment yasak; `redirect: 'error'`.
- SSE akışı: `delta.content`, parçalı `delta.tool_calls` (index/id/name/arguments), `[DONE]`, akışsız JSON yedeği.
- Model keşfi: `GET /models`; hata eşlemesi 401/403/404/429/5xx; gövde 500 karakterle sınırlı; anahtar maskelenir.
- API anahtarı:
  - Öncelik: `ULTRON_OPENAI_API_KEY` ortam değişkeni.
  - Yoksa `%APPDATA%\Ultron\provider-secrets.json` (atomik yazım, kullanıcı hesabıyla sınırlı izin denemesi).
  - `settings.json`, görev kaydı, log ve renderer yanıtlarında **yok**; renderer yalnızca `apiKeyConfigured: boolean` görür.
- Arayüz: Ollama/OpenAI uyumlu seçimi, parola alanı, kayıtlı anahtarı silme, dinamik güvenlik metni, bağlantı durumu.

### Doğrulama kanıtları

| Kanıt | Sonuç |
|---|---|
| `npm run typecheck` | Temiz (node + web) |
| `npm run test:permissions` | **276/276 geçti** |
| `tests/openai-provider.test.ts` | SSE içerik, parçalı tool-call, 401'de anahtar sızmaması, boş akış hatası, JSON yedeği, model listesi |
| `tests/provider-secrets.test.ts` | Doğrulama, atomik dosya, env önceliği, maskeleme |
| `node tests/installed-provider-check.mjs` | **Geçti**: arayüz geçişi; anahtarsız net hata; `/models`; sohbet akışı `Merhaba dünya`; anahtar yalnızca `provider-secrets.json` içinde |
| Ekran görüntüsü | `docs/evidence/installed-provider.png` |

**Sınır:** Gerçek bir bulut sağlayıcı hesabıyla (ör. OpenAI, Groq, OpenRouter) canlı test yapılmadı; testler yerel sahte OpenAI uyumlu sunucuyla yapıldı. Ücretsiz kota/hesap gerektiren doğrulama sonraki aşamadır.

---

## 5. Git iş akışı araçları

### Uygulananlar

- `git_branch`: `ultron/<task-id>` veya verilen güvenli ad; `git switch -c`; onay akışı; önceki dalı raporlar.
- `git_commit`: `git add -A` + `git commit -m`; mesaj 4–200 karakter; kontrol karakteri yasak; onay akışı; hash ve dal döndürür.
- Doğrulama: `..`, `@{`, `//`, baştaki nokta, `.lock`, `main`/`master`/`HEAD`, 80+ karakter reddedilir; argümanlar `execFile` ile kabuk olmadan çalışır.
- Force-push, merge, amend, `reset --hard` yok.

### Durum

| Madde | Etiket |
|---|---|
| Dal adı/commit mesajı doğrulaması + birim testleri (3/3) | **Uygulandı ve doğrulandı** |
| `git_branch` / `git_commit` kodu | **Uygulandı, doğrulanmadı** — bu makinede Git kurulu değil (`where.exe git` başarısız; yaygın kurulum yolları boş) |
| `git_restore` | **Yapılmadı / sonraki aşama** |
| `update_task_step` kanıt kimliği | **Yapılmadı / sonraki aşama** |

Git kurulduktan sonra kabul testi: geçici depo → `git init` → ilk commit → `git_branch` → dosya değiştir → test → `git_commit` → `git switch -` ile geri dönüş.

---

## 6. CI ve ücretsiz bulut stratejisi

### CI

- `.github/workflows/ci.yml`: `windows-latest`, Node 22, `npm ci`, `npm run typecheck`, `npm run test:permissions`.
- `permissions: contents: read`; sır yok; yükleme/yayın yok.
- **Durum:** dosya hazır; GitHub'da çalıştırılmadı (yerel depoda commit/remote yok). Etiket: **Uygulandı, doğrulanmadı**.

### Ücretsiz kaynaklar (19.10.2026 itibarıyla doğrulanan resmî bilgiler)

| Kaynak | Ücretsiz durum | Not |
|---|---|---|
| GitHub Actions | Genel depolar ücretsiz; özel depolar Free planda 2.000 dk/ay, 500 MB artifact, 10 GB cache | Kota ve politikalar değişebilir |
| Google Colab | Ücretsiz katman var | Çalışma süresi/GPU garantisi yok; ~12 saat üst sınır |
| Hugging Face | CPU Basic (2 vCPU / 16 GB) ücretsiz; ZeroGPU ücretsiz kota | PRO $9/ay; ücretsiz kotalar garanti değil |

**Kurallar:** Ücretsiz olmayan kaynak "ücretsiz" diye sunulmaz; çalışma süresi garantisi verilmez; yerel/çevrimdışı çalışma devam eder; kullanıcı onayı olmadan gizli dosya, anahtar veya özel kod yüklenmez.

---

## 7. 12 senaryo test matrisi

> Bu senaryolar görev maddelerinden türetilmiştir. Her satırda kanıt türü ve etiket açıktır.

| # | Senaryo | Sonuç | Kanıt |
|---|---|---|---|
| 1 | Ollama ↔ OpenAI uyumlu sağlayıcı geçişi (varsayılan bozulmadan) | **Uygulandı ve doğrulandı** | Kurulu uygulama testi; `installed-provider.png`; 276/276 |
| 2 | OpenAI uyumlu akış + parçalı tool-call | **Uygulandı ve doğrulandı** (sahte sunucu) | `tests/openai-provider.test.ts`; kurulu uygulamada sohbet |
| 3 | API anahtarının settings/log/renderer'a sızmaması | **Uygulandı ve doğrulandı** | `provider-secrets` testleri; kurulu testte `settings.json`'da anahtar yok |
| 4 | Anahtarsız bulut isteğinde net hata | **Uygulandı ve doğrulandı** | Kurulu test: `connected=false`, "API anahtarı tanımlı değil"; modele istek yok |
| 5 | Bağlam bütçesi / boş yanıt / `needs_review` | **Uygulandı ve doğrulandı** (birim + canlı demo #5) | `computeAgentContextBudget` ve `shouldStopForIdleTurns` testleri; Demo #5 bölümü |
| 6 | Görev durumunun yeniden başlatmada kalıcılığı | **Uygulandı ve doğrulandı** (kalıcılık) | `task-store` testleri; kurulu sohbet geçmişi kalıcılık smoke testi |
| 7 | Test → hata → kök neden → yeniden test döngüsü | **Kısmen** — mevcut doğrulama/loop testleri var; 8B modelle tam döngü demo #5'e bağlı | `agent-verification` testleri; Demo #3/#4'te 3/3 test |
| 8 | Değişiklik yedeği / geri alma | **Uygulandı ve doğrulandı** (yedek üretimi); tam geri alma canlı test edilmedi | Demo `backups/` 6 dosya; `undo` testleri |
| 9 | Git dal/commit ve geri dönüş | **Uygulandı, doğrulanmadı** (Git yok) | `tests/git-workflow.test.ts` 3/3; canlı test bloke |
| 10 | İzin/onay ve komut güvenliği | **Uygulandı ve doğrulandı** | `permissions`/`tool-validation` testleri; demo onay kayıtları |
| 11 | Çevrimdışı/izolasyon: dış AI uç noktası ve SDK yok | **Uygulandı ve doğrulandı** | `offline-inventory.test.ts`; URL politikası; 276/276 |
| 12 | CI paketi (tip + test, sırsız) | **Uygulandı, doğrulanmadı** | `.github/workflows/ci.yml`; GitHub'da çalıştırılmadı |

**Yapılmadı / sonraki aşama:** MCP istemcisi, uygulama içi Playwright `browser_check` aracı, bulut görev kuyruğu, rol profilleri, kendini geliştirme otomasyonu (ayrı dal + karşılaştırma + otomatik geri alma), bellek dışa/içe aktarma.

---

## 8. Kurulum ve paket doğrulaması

- `npm run dist` başarılı: `release\Ultron Setup 1.1.0.exe` + `release\Ultron 1.1.0.exe`.
- Sessiz kurulum: `%LOCALAPPDATA%\Programs\Ultron` (16:16:40).
- `app.asar` içinde doğrulanan yeni dizeler: "Model sağlayıcı ayarları", "OpenAI uyumlu", "ULTRON_OPENAI_API_KEY", "provider-secrets.json", "git_branch", "git_commit", "context-budget", "needs_review".
- Kurulu smoke: sohbet kontrolü ve sohbet geçmişi kalıcılığı **geçti** (`release/installed-smoke.png`, `release/installed-persist.png`).

---

## 9. Bilinen sınırlar ve riskler

1. **Model kapasitesi:** `qwen3:8b` frontier modellerle eşit değildir. Mühendislik iş akışı iyileştirildi; ham akıl yürütme farkı kapanmadı.
2. **Demo #5 sonucu:** {{DEMO5_SUMMARY}}
3. **Git yok:** Dal/commit canlı doğrulanamadı; Git kurulumu kullanıcı onayı gerektirir.
4. **Gerçek bulut testi yok:** Sağlayıcı katmanı sahte sunucuyla doğrulandı; gerçek hesap/kota testi yapılmadı.
5. **MCP/Playwright/rol profilleri/kendini geliştirme:** Yapılmadı; sonraki aşamalar.
6. **Kota ve kesinti:** Ücretsiz bulut kaynaklarında garanti yok; yerel çalışma korunur.
7. **Güvenlik:** Anahtarlar yerelde tutulur; yine de kullanıcı hesabı ele geçirilirse dosya okunabilir. İşletim sistemi düzeyinde tam koruma iddiası yoktur.
8. **Windows:** Dosya izinleri POSIX `0600` semantiğiyle birebir değildir; kullanıcı hesabıyla sınırlama hedeflenir.

---

## 10. Sonraki adımlar (öncelik sırası)

1. Git kurulumu (kullanıcı onayı) → geçici depoda dal/commit/geri dönüş kabul testi; ilk gerçek commit ve yedek.
2. Demo #5 sonucuna göre: gerekirse bağlam bütçesini düşürme, araç şeması filtreleme, plan adımı kapatma politikası.
3. Gerçek ücretsiz bulut sağlayıcıyla (kullanıcı anahtarıyla, yerel test hesabı) sağlayıcı doğrulaması; kota uyarıları.
4. MCP stdio istemcisi (allowlist, zaman aşımı, çıktı sınırı) + sahte sunucu testi.
5. Playwright `browser_check` (loopback, konsol hatası, ekran görüntüsü).
6. `update_task_step` kanıt kimliği ve `git_restore`; çok dosyalı işlem günlüğü.
7. GitHub'da CI çalıştırma (depo/remote hazır olduğunda).

---

## 11. Sonuç

Ultron artık sağlayıcıdan bağımsız bir model katmanına, güvenli anahtar saklamaya, token farkındalıklı bağlam yönetimine, onaylı Git dal/commit araçlarına ve sırsız bir CI iskeletine sahiptir. Bu yeteneklerin önemli bölümü birim testleri ve kurulu uygulama testleriyle doğrulanmıştır.

Ancak bu, "Codex düzeyinde eksiksiz otonom platform tamamlandı" anlamına **gelmez**: Git canlı testi, gerçek bulut testi, MCP, tarayıcı aracı, rol profilleri ve kendini geliştirme otomasyonu eksiktir. Yerel 8B modelin sınırları sürer. Raporun üç etiketli yapısı, hangi yeteneğin gerçekten kanıtlandığını hangisinin yalnızca kodlandığını açıkça ayırır.
