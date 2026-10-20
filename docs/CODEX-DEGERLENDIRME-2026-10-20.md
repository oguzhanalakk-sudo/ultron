# Codex Değerlendirmesi ve Ultron'a Uyarlama

Tarih: 2026-10-20
Kaynak: https://github.com/openai/codex (Apache License 2.0)

## 1. Ne incelendi

- Depo README'si ve lisans dosyası (doğrudan `raw.githubusercontent.com` üzerinden).
- Lisan: **Apache-2.0**. Bu çalışma için **hiçbir Codex kodu kopyalanmadı**; yalnızca
  mimari desenler ve davranış kuralları incelendi ve Ultron'un kendi koduna uyarlandı.

Codex CLI; yerel çalışan, terminal komutlarını ve dosya sistemini gerçekten
kullanan, "bir işi baştan sona bitiren" bir kodlama ajanıdır. Ultron'un hedefi
(gerçek araç çağıran masaüstü ajan) ile aynı ailede bir mimariyi paylaşır.

## 2. Codex'ten alınan ve Ultron'a uyarlanan desenler

| # | Codex deseni | Ultron'daki karşılığı | Durum |
|---|---|---|---|
| 1 | Araç şeması → yürütücü → izin katmanı ayrımı | `electron/tool-registry.ts` (şema↔yürütücü eşleşmesi), `electron/main.ts` `runTool` dispatch, `electron/permission-manager.ts` izin kapıları | Var (bu oturumda genişletildi) |
| 2 | Yetenek bazlı araç seçimi (her araç her istekte görünmez) | `selectToolsForTask(tools, request, { desktopEnabled })` | Var; **web araçları artık daima görünür** (aşağıda) |
| 3 | Model "yaptım" derse bile aracın gerçekten çağrıldığını doğrula | `requiredToolRetry` / `requiredReadRetry` / **yeni** `requiredWebRetry` + çerçeve seviyesinde ön getirme | Var (bu oturumda web için eklendi) |
| 4 | Döngü/tekrar koruması | `desktopRepeatGuard` (masaüstü), **yeni** `toolRepeatGuard` + `toolKindCounts` (tüm araçlar) | Var (bu oturumda eklendi) |
| 5 | Sandbox ve onay (approval) akışı, riskli işlemlerde kullanıcı onayı | `askApproval` + `PermissionGrant` (operation/task/project/category kapsamları) | Var |
| 6 | Komut yürütücüsünde risk sınıflandırma | `electron/permissions.ts` `canRunAutomatically`, `requiresApprovalForCommand` | Var |
| 7 | Görev/plan durumu kalıcılığı | `task-store`, `update_task_step`, kabul testleri | Var |

## 3. Bu oturumda Codex'ten türetilen somut değişiklikler

### 3.1 Yetenek kapısı gevşetildi (anahtar kelime bağımlılığı kaldırıldı)

Codex'te araç görünürlüğü her istekte "gürültü" yaratmamak için kısıtlanır; ancak
Ultron'da kısıt **çok dar** olduğu için ajan "web erişimim yok" diyordu.
`tool-registry.ts` içinde `research` yeteneği artık **her zaman etkin**:

```ts
capabilities.add('research')   // web_search, web_research, web_follow_link, web_download, fetch_web_page
```

Güvenlik azaltılmadı: bu araçlar salt okunurdur, SSRF filtresinden (`validateFetchableUrl`)
geçer ve yazma yapmaz.

### 3.2 "Araç gerçekten çalışmalı" kuralı çerçeveye taşındı

Codex'in yaklaşımı: modelin çıktısına güvenilmez, araç çağrısının **kaydı** kanıttır.
Ultron'da bu, `requiredWebRetry` ile uygulandı:

- İstekte `http(s)` adres varsa → `fetch_web_page` / `web_research` / `web_follow_link` / `web_download` **zorunlu**.
- "indir" varsa → indirme aracı zorunlu.
- "araştır/internette/güncel" varsa → herhangi bir web aracı zorunlu.

Ek olarak, model 8B ölçeğinde araç seçmekte zorlandığı için **çerçeve seviyesinde ön
getirme** eklendi (`prefetchWebPages`): istekteki adresler gerçekten okunur, sonuç sistem
mesajı olarak modele kanıt olarak verilir ve görev kaydına `fetch_web_page` olayı yazılır.

### 3.3 Döngü koruması tüm araçlara yayıldı

`toolRepeatGuard` (aynı araç + aynı argüman, görev başına en fazla 3) ve
`toolKindCounts` (aynı araç türü, görev başına en fazla 8). Aşılırsa görev "başarı" diye
değil, **dürüstçe durdurulur** ve engelin nedeni rapora yazılır.

### 3.4 Uygulama başlatma: izin listesi + gerçek çözümleme

- `electron/app-launcher.ts` yeni modül: `ALLOWED_APPLICATIONS` (14 uygulama; sistem
  araçları + Edge/Chrome/Firefox/Brave/Opera/Vivaldi), `normalizeAppName`, `validateAppName`.
- `electron/desktop-control.ts`: `Resolve-AppTarget` (PowerShell) artık uygulamayı
  PATH → System32 → Program Files → Başlat Menüsü sırasıyla gerçek dosyaya çözer.
- Güvenli modda **ham yol** ve **kabuk yürütücüleri** (cmd/powershell/wscript/...) reddedilir.

### 3.5 İzin politikası merkezileştirildi

`electron/permission-manager.ts` içindeki dört kapı artık gerçek akışlara bağlı
(önceden üçü ölü koddu):

| Kapı | Bağlandığı yer |
|---|---|
| `canUseDesktopAutomation` | `runDesktopHost` / `runDesktopTool` (masaüstü kapısı) |
| `canLaunchApplication` | `openTrustedApplication` (kontrollü profilde onay kartı) |
| `canReadOrWriteAnyPath` | `requestScopeAccess` (`read-write` kapsam) |
| `canAccessExternalUrl` | `research:permission-check` IPC (mevcut) |

## 4. Bilinçli olarak **alınmayan** kararlar

- **Codex kodu kopyalanmadı.** Apache-2.0 lisansı buna izin verse de, Ultron'un mimarisi
  farklı; kopyalamak yerine davranış kuralları uyarlandı.
- **Yeni npm bağımlılığı eklenmedi.** Codex Rust tabanlıdır; Ultron Electron/TypeScript
  tabanlıdır. Terminal yürütücüsü, görev yönetimi ve izin sistemi zaten mevcuttu.
- **Sandbox gevşetilmedi.** Geniş erişim (`broadAccessPermissions`) yalnız kullanıcının
  açık onayı ve zaman damgasıyla etkinleşir; `isBroadAccessEnabled` bu zaman damgasını
  doğrular (yalnız `allowBroadAccess` bayrağına bakmaz).
- **Kontrollü profilde dış ağ kapalı kaldı**; `canAccessExternalUrl` ayrıca özel ağ
  adreslerini (localhost/özel IP) her profilde engeller.

## 5. Codex'a göre kalan farklar (dürüst kayıt)

| Alan | Codex | Ultron (bugün) |
|---|---|---|
| Model | GPT-5 tabanlı, güçlü araç seçimi | Kullanıcının seçtiği model (testte qwen3:8b) — 8B model granüler araç seçiminde zayıf; çerçeve zorlamaları bunu telafi ediyor |
| Terminal yürütücüsü | Rust, PTY, canlı oturum | PowerShell + zaman aşımı/iptal (PTY yok) |
| Sandbox | Linux landlock/seccomp, macOS seatbelt | Windows işletim sistemi izinleri + uygulama içi onay akışı |
| Diff uygulama | Gerçek patch motoru | `apply_patch` / öneri (proposal) akışı |
| Web | Dahili tarayıcı/agent taraması | Araç düzeyinde arama + sayfa okuma + indirme (tarayıcı otomasyonu yok) |
| Paralel araç çağrısı | Var | Sıralı (8B model için daha güvenli) |
