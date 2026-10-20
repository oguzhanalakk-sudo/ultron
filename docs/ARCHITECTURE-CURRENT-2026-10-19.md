# Ultron — Güncel Mimari ve Durum (19.10.2026)

> Bu belge **mevcut kodun** mimarisini çıkarır. Hedef/tasarım planı ayrıdır: `docs/INTEGRATION-PLAN-2026-10-19.md`.
> Ölçülmemiş hiçbir yetenek "tamamlandı" sayılmaz. Durum etiketleri: **doğrulandı**, **uygulandı/doğrulanmadı**, **yapılmadı**.
>
> **Güncelleme (19.10.2026 akşamı):** Bu belge tarihsel durumdur. Güncel araç sayıları **60 şema / 62 dispatch case**, güncel UI smoke **başarısız**, canlı Demo #5 **failed** ve güncel denetim için `docs/AUDIT-REPORT-CURRENT-2026-10-19.md` esas alınmalıdır.

---

## 0. Durum anlık görüntüsü

| Alan | Değer |
|---|---|
| Ürün / sürüm | Ultron 1.1.0 (Electron 44 + React 19 + Vite) |
| Derleme | `npm run dist` başarılı; NSIS + portable |
| Kurulum | `%LOCALAPPDATA%\Programs\Ultron` — asar 19.10.2026 16:33:34, 2.169.536 bayt |
| Tip kontrolü | `npm run typecheck` temiz |
| Test paketi | `npm run test:permissions` → **276/276** |
| Sağlayıcı E2E | Kurulu uygulamada sahte OpenAI uyumlu sunucuyla **geçti** (`tests/installed-provider-check.mjs`) |
| Kurulu smoke | Sohbet + geçmiş kalıcılığı **geçti** (`release/installed-smoke.png`, `release/installed-persist.png`) |
| Canlı demo #5 | **Devam ediyor** (19.10.2026 17:07 itibarıyla `running/evaluating`, 3 açık plan adımı) |
| Git | **Yok**: `git` PATH'te değil; `.git/HEAD → master`, `refs/heads` 0 dosya |
| CI | `.github/workflows/ci.yml` var; GitHub'da **çalıştırılmadı** |
| Geri dönüş noktası | `C:\Users\user\Desktop\codexx-backup-audit` (oturum öncesi tam kopya) |

**Bu oturumda eklenen ana katmanlar:** P0 bağlam/boş-yanıt düzeltmesi, iki sağlayıcılı model katmanı, güvenli anahtar saklama, Git dal/commit araçları, CI iskeleti, boş-tur koruması, genel terminal için 3 dakikalık süre sınırı (henüz derlenmedi/kurulmadı).

---

## 1. Katmanlı mimari

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 1) RENDERER — React + Vite                                                │
│    src/App.tsx · src/main.tsx · styles.css · settings.css                 │
│    Sohbet · plan/ilerleme · onaylar · ayarlar (sağlayıcı/anahtar)         │
│    dosya ağacı · hafıza · eklentiler · yazılım kataloğu                   │
└───────────────▲──────────────────────────────────────┬───────────────────┘
                │ events: delta/status/tool/approval/done │ IPC: window.kodAtolyesi
┌───────────────┴──────────────────────────────────────▼───────────────────┐
│ 2) PRELOAD — contextBridge (electron/preload.ts)                          │
│    ~70 whitelisted metot · onEvent · Node/fs erişimi yok                  │
└──────────────────────────────────────┬───────────────────────────────────┘
                                       │ IPC handlers
┌──────────────────────────────────────▼───────────────────────────────────┐
│ 3) MAIN / ORKESTRASYON                                                    │
│    electron/main.ts (koordinatör, ~400 KB)                                │
│    agent-orchestrator · agent-intent · agent-verification · agent-editing │
│    conversation · task-store                                              │
│                                                                           │
│    runAgent: analyze → plan → execute → evaluate → verify → finalize      │
└──────┬───────────────────────┬───────────────────────┬───────────────────┘
       │                       │                       │
┌──────▼───────────┐   ┌───────▼────────────┐   ┌──────▼──────────────────┐
│ 4) PROVIDER      │   │ 5) TOOL MANAGER    │   │ 6) GÜVENLİK / ONAY      │
│ model-provider   │   │ 58 araç şeması     │   │ permission-manager      │
│ openai-provider  │   │ dosya/terminal/    │   │ permissions             │
│ provider-secrets │   │ test/build/git/    │   │ tool-validation         │
│ local-ai (Ollama)│   │ web/plugin/...     │   │ sensitive/source/       │
│                  │   │                    │   │ renderer security       │
└──────┬───────────┘   └───────┬────────────┘   └──────┬──────────────────┘
       │                       │                       │
┌──────▼───────────────────────▼───────────────────────▼──────────────────┐
│ 7) KALICILIK                                                              │
│ Proje: <proje>/.codex-local/{workspace,tasks,audit,undo}.json + backups/  │
│ App:   %APPDATA%\Ultron\{settings,memory,solution-memory,chat-history,    │
│        provider-secrets,permission-grants,software-catalog}.json          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Katmanlar ve sorumluluklar

### 2.1 Renderer — `src/`

| Dosya | Görev |
|---|---|
| `App.tsx` | Sohbet, görev paneli, onay pencereleri, ayarlar, sağlayıcı seçimi/API anahtarı, dosya ağacı, hafıza, eklenti ve yazılım panelleri |
| `main.tsx` | React kökü |
| `styles.css`, `settings.css`, `local-ai.css` | Arayüz stilleri |
| `vite-env.d.ts` | `window.kodAtolyesi` ve ayar tipleri |

Renderer'ın Node/fs erişimi yoktur; tüm işlemler preload üzerinden IPC ile yapılır.

### 2.2 Preload — `electron/preload.ts`

- `contextBridge.exposeInMainWorld('kodAtolyesi', …)` ile ~70 whitelisted metot.
- `onEvent` ile ana süreç olayları (`delta`, `status`, `tool`, `approval`, `approval-resolved`, `done`, `build-result`, …) renderer'a taşınır.
- Tipler `electron/shared.ts` + `src/vite-env.d.ts` içinde.

### 2.3 Ana süreç / orkestrasyon

| Modül | Görev |
|---|---|
| `electron/main.ts` | IPC kayıtları, `runAgent`, sağlayıcı yönlendirmesi, tüm araç dispatch'i, onay akışı, görev/hafıza yönetimi |
| `agent-orchestrator.ts` | Tur/araç bütçeleri (`maxModelTurns=96`, `maxToolCalls=256`), token farkındalıklı bağlam bütçesi, bağlam sıkıştırma, boş-tur durdurma eşiği |
| `agent-intent.ts` | Kullanıcı isteğinden niyet/plan ihtiyacı çıkarımı |
| `agent-verification.ts` | Test/derleme kanıtı tazeliği, kabul testleri, doğrulama kayıtları |
| `agent-editing.ts` | Dosya değişiklik taslakları/uygulama yardımcıları |
| `conversation.ts` | Sohbet bağlamı kırpma/özetleme |
| `task-store.ts` | Kalıcı görev durum makinesi, olay günlüğü, yeniden başlatma sonrası sürdürme |

**Ajan döngüsü:** niyet → (gerekirse) plan → model turu → araç çağrıları → doğrulama → sonraki tur → nihai durum. Plan adımları `update_task_step`, plan `set_task_plan` ile güncellenir.

### 2.4 Model sağlayıcı katmanı

| Modül | Görev |
|---|---|
| `model-provider.ts` | `ModelProvider = 'ollama' \| 'openai-compatible'`; URL normalize/politika |
| `openai-provider.ts` | OpenAI uyumlu SSE akışı, parçalı `tool_calls` birleştirme, `/models`, JSON yedeği, hata eşleme |
| `provider-secrets.ts` | Anahtar doğrulama, atomik yazma, maskeleme/redaksiyon, env önceliği |
| `local-ai.ts` | Ollama model listesi, indirme/yükleme, durum |

**Politika:**
- Ollama yalnızca loopback (`127.0.0.1`, `localhost`, `::1`).
- OpenAI uyumlu: `https:` herkese açık; `http:` yalnızca loopback; redirect yasak.
- Anahtar önceliği: `ULTRON_OPENAI_API_KEY` ortam değişkeni → `%APPDATA%\Ultron\provider-secrets.json`.
- `settings.json`, görev kaydı, log ve renderer yanıtlarında anahtar yok; renderer yalnızca `apiKeyConfigured: boolean` görür.
- **Eksik:** sağlayıcılar arası otomatik yedekleme/fallback yok; seçim manuel.

### 2.5 Araç yöneticisi

- Tek şema listesi (`agentTools`, 58 araç) ve tek dispatch noktası (`main.ts` içindeki `switch`).
- Görev/proje tipine göre filtrelenir; Windows masaüstü görevinde demo #5'te **31 araç / 18.084 karakter** bütçe kaydı oluştu.
- Kategoriler:
  - **Dosya:** okuma/yazma/yama, silme (yedekli), arama, ağaç, parmak izi.
  - **Terminal/build:** `run_command` (3 dk sınırı — yeni), `run_tests`, PowerShell, Windows/Android/Web build araçları.
  - **Git:** `git_status`, `git_diff`, `git_branch`, `git_commit` (onaylı; push/merge/amend yok).
  - **Analiz:** proje analizi, hata/log inceleme, ortam tespiti, güvenlik denetimi.
  - **Web:** yerel URL kontrolü, yerel servis başlatma, SQLite sorgusu, web araştırması.
  - **Genişleme:** eklenti yöneticisi, yazılım kataloğu, uygulama adaptörleri, ağ envanteri, ZIP/metin araçları.
- Girdi doğrulama `tool-validation.ts`; çıktı üst sınırları ve zaman aşımları uygulanır.

### 2.6 Güvenlik / onay

| Modül | Görev |
|---|---|
| `permission-manager.ts` | İzin profilleri, kalıcı grant'lar, otomatik onay kararı |
| `permissions.ts` | Risk/kategori sınıflandırma, komut allowlist |
| `tool-validation.ts` | JSON şema doğrulama, yol/argüman sınırları |
| `sensitive-files.ts` | Hassas dosya/anahtar filtresi |
| `source-security.ts`, `renderer-security.ts` | Kaynak/renderer güvenlik denetimleri |
| `command-environment.ts` | Alt süreç ortamından `OPENAI_API_KEY`, `GITHUB_TOKEN` vb. temizleme |

- Tüm dosya işlemleri proje köküne kapsanır; silme/üzerine yazma öncesi yedek.
- Komut, silme ve sistem işlemleri `askApproval` ile onaylanır; kalıcı grant yalnızca izinli kategorilerde.
- Git mutasyonları (`git_branch`, `git_commit`) onay gerektirir.
- Anahtarlar loglarda redakte edilir.

### 2.7 Kalıcılık

| Yer | İçerik |
|---|---|
| `<proje>/.codex-local/workspace.json` | Sohbet, plan, izinler, kaynak kökleri, hafıza |
| `<proje>/.codex-local/tasks.json` | Görev kayıtları, durum/olay geçmişi |
| `<proje>/.codex-local/audit.json` | İşlem denetim kaydı |
| `<proje>/.codex-local/undo.json` + `backups/` | Geri alma kayıtları ve dosya yedekleri |
| `%APPDATA%\Ultron\settings.json` | Sağlayıcı/model/URL/profil (anahtar **yok**) |
| `%APPDATA%\Ultron\provider-secrets.json` | API anahtarı (ayrı, atomik) |
| `%APPDATA%\Ultron\memory.json` | Kullanıcı hafızası |
| `%APPDATA%\Ultron\solution-memory.json` | Çözülmüş hata/çözüm hafızası |
| `%APPDATA%\Ultron\chat-history.json` | Sohbet geçmişi |
| `%APPDATA%\Ultron\permission-grants.json` | Kalıcı izinler |
| `%APPDATA%\Ultron\software-catalog.json` | Yazılım kataloğu |
| `%APPDATA%\Ultron\plugins\` | Eklentiler |

### 2.8 Paketleme / CI

- `electron.vite.config.ts`: main/preload/renderer derlemesi.
- `package.json > build`: NSIS + portable, `out/**/*` paketlenir; ek kaynaklar (plugin host, Gradle wrapper, şablonlar).
- `.github/workflows/ci.yml`: Windows + Node 22, `npm ci`, `npm run typecheck`, `npm run test:permissions`; sır yok, yükleme yok.
- Kanıtlar: `docs/evidence/`, `release/`.

---

## 3. Uçtan uca istek akışı

```
Kullanıcı mesajı
  │
  ▼
React (src/App.tsx) ── sendMessage(messages) ──► preload ──► ipcMain('agent:chat')
                                                              │
                                                              ▼
                                                          runAgent()
                                                              │
                          ┌───────────────────────────────────┼───────────────────────────────┐
                          ▼                                   ▼                               ▼
              buildAgentSystemPrompt              compactAgentContext              taskStore + memory
              (proje, plan, hafıza)               (token bütçesi)                 (durum/olay)
                          │
                          ▼
                  streamCompletion()
                    ├─ provider=ollama ─────────────► POST /api/chat (NDJSON)
                    └─ provider=openai-compatible ──► POST /chat/completions (SSE)
                          │
                          ▼ tool_calls
                  validateToolArguments → PermissionManager → (gerekirse) askApproval
                          │
                          ▼
                  Araç yürütme (dosya/terminal/test/build/git/web/...)
                          │
                          ▼
                  Doğrulama (test/build/read kanıtı) + audit/task olayları
                          │
                          ▼
                  Nihai durum: completed | needs_review | failed | blocked | paused | cancelled
                          │
                          ▼
                  events (delta/status/tool/approval/done) ──► preload.onEvent ──► UI
```

---

## 4. Görev durum makinesi

```
                 ┌──────────┐
   yeni görev ──►│ running  │──────────────────────────────┐
                 └────┬─────┘                              │
        onay gerekli │                                    │ hata/kanıtsızlık
                      ▼                                    ▼
              ┌────────────────┐                  ┌───────────────┐
              │ waiting_approval│                 │ needs_review  │
              └───────┬────────┘                  └───────────────┘
                      │ onay/red                         ▲
                      ▼                                  │ açık plan/test kanıtı
                 ┌──────────┐                            │
                 │ running  │────────────────────────────┘
                 └────┬─────┘
        ┌─────────────┼──────────────┬───────────────┐
        ▼             ▼              ▼               ▼
   ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐
   │completed│  │  failed  │  │  blocked  │  │ paused / │
   └─────────┘  └──────────┘  └───────────┘  │cancelled │
                                             └──────────┘
```

- `completed` yalnızca açık plan adımı, başarısız kontrol, eksik kabul testi ve güncel değişiklik kanıtı kalmadığında verilir.
- `needs_review`: gerçek iş var ama doğrulama/plan kapanmadı.
- `failed`: araç hatası/istenen dosya işlemi yapılamadı.
- `blocked`: bütçe/sınır nedeniyle güvenli durdurma.
- `paused`/`cancelled`: kullanıcı eylemi.

---

## 5. Sağlayıcı sözleşmesi (özet)

| Konu | Ollama | OpenAI uyumlu |
|---|---|---|
| Varsayılan | Evet (`qwen3:8b`) | Hayır |
| URL | loopback zorunlu | https; http yalnızca loopback |
| Akış | NDJSON `/api/chat` | SSE `/chat/completions` |
| Tool-call | Ollama `tool_calls` | Parçalı `delta.tool_calls` birleştirme |
| Model listesi | `/api/tags` | `GET /models` |
| Anahtar | Gerekmez | `ULTRON_OPENAI_API_KEY` veya `provider-secrets.json` |
| Hata | 429/5xx/boş yanıt sınıflandırma | 401/403/404/429/5xx + redaksiyon |
| Fallback | — | Otomatik değil (eksik) |

---

## 6. Durum: doğrulanan / doğrulanmayan / yapılmayan

### Doğrulandı (kanıtlı)

- 276/276 test; tip kontrolü temiz.
- Kurulu uygulamada sağlayıcı arayüzü, `/models`, sohbet akışı (`Merhaba dünya`), anahtarın yalnızca `provider-secrets.json`'da kalması.
- Kurulu sohbet ve geçmiş kalıcılığı smoke testleri.
- Paketleme + sessiz kurulum + asar içeriği (yeni dizeler).
- Demo #3/#4: gerçek modelle 6 dosya üretimi, 3/3 unittest; görev yönetimi kilitlenmesi kanıtlandı.

### Uygulandı, doğrulanmadı

- `git_branch` / `git_commit`: Git kurulu olmadığı için canlı test yok; birim testleri 3/3.
- `.github/workflows/ci.yml`: GitHub'da çalıştırılmadı.
- Genel `run_command` 3 dakika sınırı: kod + tip kontrolü var; yeni derlemeye/install'a dahil edilmedi.
- Gerçek bulut sağlayıcı: yalnızca yerel sahte sunucuyla test edildi.

### Yapılmadı / sonraki aşama

- MCP istemcisi.
- Uygulama içi Playwright `browser_check`.
- Ajan rol profilleri (planner/architect/coder/… ayrı profiller).
- Kendini geliştirme otomasyonu (ayrı dal + karşılaştırma + otomatik geri alma).
- Sağlayıcılar arası otomatik fallback.
- Bulut görev kuyruğu.
- `git_restore`, `update_task_step` kanıt kimliği.
- Bellek dışa/içe aktarma.

---

## 7. Bilinen sorunlar / riskler

1. **8B model plan kapatma:** `qwen3:8b` testler geçtikten sonra `update_task_step` çağırmıyor; plan 3 adım açık kalıyor. Boş-tur koruması görevi `needs_review` ile bitirir; `completed` garantisi yoktur.
2. **GUI/interaktif komut:** Demo #5'te `python .../main.py` 15 dakika bloke etti. Yeni 3 dakikalık sınır derlenip kurulunca tekrar test edilmeli.
3. **Git yok:** Dal/commit/geri dönüş canlı doğrulanamıyor; `.git` commit'siz.
4. **Demo #5 sonucu:** Bu belge yazılırken hâlâ `running/evaluating`; nihai rapor sonucu ayrıca işlenecek.
5. **Monolitik `main.ts`:** 400 KB; katmanlar modüllere ayrılmış olsa da IPC/araç dispatch'i tek dosyada. Orta vadede bölünmeli.
6. **Windows dosya izinleri:** POSIX `0600` semantiği birebir uygulanamaz; anahtar dosyası kullanıcı hesabıyla sınırlanır.
7. **Ücretsiz bulut kotaları:** Garanti yok; yerel/çevrimdışı çalışma korunur.

---

## 8. İlgili belgeler

- `docs/ARCHITECTURE-AUDIT-2026-10-19.md` — oturum öncesi denetim.
- `docs/INTEGRATION-PLAN-2026-10-19.md` — hedef mimari ve fazlar.
- `docs/FINAL-REPORT-2026-10-19.md` — 12 senaryo matrisi ve nihai rapor.
- `docs/research/github-projects-2026-10-19.json` — 26 proje/lisans araştırması.
- `docs/evidence/` — demo, sağlayıcı ve smoke ekran görüntüleri/JSON kanıtları.
