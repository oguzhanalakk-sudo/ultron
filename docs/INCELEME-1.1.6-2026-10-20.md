# Ultron 1.1.6 — Son Sürüm İncelemesi

Tarih: 20.10.2026
İnceleme aralığı: ~16:35–17:00 (yerel saat)
Kaynak: `C:\Users\user\Desktop\codexx`
Paket sürümü: **1.1.6** (`package.json`)
İnceleme yöntemi: statik kod incelemesi + typecheck + birim testleri + paketli uçtan uca smoke + canlı web araması + canlı SSRF/indirme/sır testleri + imza/derleme doğrulaması.

> Bu raporda **gerçekten çalıştırılan** kontroller "doğrulandı", yalnızca kod okumasına dayananlar "kod incelemesi", çalıştırılamayanlar "doğrulanamadı" olarak ayrılmıştır. API anahtarı yoksa anahtar gerektiren yol test edilmedi.

**Hata ve eksik odaklı envanter:** `docs/HATA-VE-EKSIKLER-1.1.6-2026-10-20.md`

---

## 1. Kısa sonuç

1.1.6, önceki sürüme göre **gerçek işlevsel ilerleme** içeriyor: Brave Search API entegrasyonu, anahtarın işletim sistemi `safeStorage` şifrelemesiyle saklanması, sağlayıcı durumu/kaydetme/silme UI'ı, sağlayıcı anahtarı modülü ve 11 yeni birim testi.

Güvenlik temelleri iyi: `sandbox`, `contextIsolation`, `nodeIntegration: false`, IPC gönderen doğrulaması, dış URL allowlist'i, komut whitelist'i ve proje dışına çıkan yolların reddi.

Ancak **"son sürüm tamam" demek için beş P1 ve bir P2 açık var**:

- **P1:** Kurulu uygulama (`%LOCALAPPDATA%\Programs\Ultron`) hâlâ **1.1.5 (07:37 derlemesi)**; 1.1.6 yalnızca masaüstündeki `Desktop\Ultron` kopyasında çalışıyor. Başlat menüsünden açılan Ultron eski kodu çalıştırır.
- **P1:** 1.1.6 paketli smoke testi **2/2 aynı assertte düşüyor** (`ui-smoke.mjs:641`, iptal edilen komutun `lastBuild` kaydı). Sürüm bu haliyle "paketli testler geçti" iddiasını taşıyamaz.
- **P1:** Web fetch istemcisi **redirect'leri takip ediyor ve son URL'yi yeniden doğrulamıyor** → SSRF (localhost/özel ağ) **canlı olarak doğrulandı**: doğrudan localhost reddedilirken, genel bir 302 yönlendirmesi `127.0.0.1` üzerindeki gizli içeriği döndürdü.
- **P1:** `web_download` **ikili dosyaları bozuyor** (gövde UTF-8 metne çevrilip yeniden yazılıyor); canlı testte 8.090 B PNG, 14.798 B olarak kaydedildi (hash farklı).
- **P1:** `web_download` **dosya yazma onayı/edit-mode denetimi olmadan** projeye yazıyor; canlı testte controlled/0 grant profilde **hiç onay olayı olmadan** `indirilenler/png` oluşturuldu. `prefetchWebPages` mesajda URL + "indir" varsa bunu otomatik yapıyor. "Araştırma araçları salt okunur" varsayımı artık geçerli değil.
- **P2:** OpenAI-uyumlu sağlayıcı ve GitHub anahtarları **düz metin** `provider-secrets.json` içinde; Brave anahtarı ise şifreli. Tutarsız ve daha zayıf.

---

## 2. Sürüm ve dağıtım durumu

Aynı anda **üç farklı Ultron kopyası** var:

| Konum | Sürüm | Zaman | Durum |
|---|---|---|---|
| `%LOCALAPPDATA%\Programs\Ultron` (kurulu) | **1.1.5.0** | 20.10 07:37:46 | **Eski**; Brave/secure store/provider-secrets/agent-memory yok |
| `C:\Users\user\Desktop\Ultron` (çalışan) | **1.1.6.0** | 20.10 16:37:20 | Güncel; 16:38:35'ten beri çalışıyor |
| `release\win-unpacked` / installer'lar | **1.1.6** | 20.10 16:36–16:37 | Güncel üretim çıktısı; kurulmadı |

- `Desktop\Ultron\resources\app.asar` ile `release\win-unpacked\resources\app.asar` **birebir aynı**: SHA256 `37B1E86AF5EC58F2AECB4CFBC7923D6D838FAEEBEFEC04F13AEFA304601B571B`.
- Kurulu `app.asar`: 2.494.989 B, 07:37:46 — güncel 1.1.6 asar'ı 2.529.853 B.
- `release\Ultron Setup 1.1.6.exe`: 121.169.252 B, 16:37:24, SHA256 `C52054D3923253666E71BF40B60494F57DA6A8E98D43DC926F4A47D940BAF8E3`.
- `release\Ultron 1.1.6.exe`: 120.926.114 B, 16:37:50, SHA256 `B1F388C2D7D3E62893750F6B2D16A0D16C2AA6E78CE0FC32D823D908F47B3A78`.
- Her iki installer da **imzasız**: `Get-AuthenticodeSignature` → `NotSigned`. SmartScreen uyarabilir.

**Sonuç:** Kullanıcı şu anda masaüstündeki 1.1.6'yı çalıştırıyor; ancak kurulum/başlat menüsü 1.1.5'te kaldı. Sürüm kimliği karışık: aynı `1.1.5` etiketi altında 07:37 ve 16:23 olmak üzere iki farklı derleme, ayrıca 16:37'de 1.1.6 var.

---

## 3. Mimari ve envanter

- **Yığın:** Electron + React/Vite + TypeScript. Üretimde `node_modules` taşınmıyor; renderer bağımlılıkları bundle içinde.
- **Boyut:** `electron/*.ts` toplam **19.087** satır; `electron/main.ts` **6.701**; `src/App.tsx` **1.465**.
- **IPC:** **89** `registerIpcHandler`, preload'da **89** `ipcRenderer.invoke` — yüzeyler eşleşiyor.
- **Araçlar:** **99** araç yürütücü case'i. Aileler: dosya/arama, git/GitHub, terminal, Android/Web/Windows proje üretimi, masaüstü otomasyonu, web araştırması, hafıza/planlama, eklentiler, güvenlik/ağ envanteri.
- **Test:** **53** test dosyası, **4.980** test satırı; `npm run test:permissions` **370/370 pass**.
- **Model:** varsayılan Ollama `qwen3:8b` (`num_ctx: 16384`); isteğe bağlı OpenAI-uyumlu sağlayıcı.
- **Web zinciri:** Brave (anahtar varsa) → yapılandırılmış sağlayıcılar → DuckDuckGo HTML → anahtarsız Stack Exchange / Hacker News / Wikipedia.
- **İzin modeli:** `controlled` / `advanced` / `personal`; `editMode` review/automatic; `commandMode` confirm/automatic; scope/grant/resource-root; audit kaydı.
- **Sırlar:** Brave anahtarı `safeStorage` ile şifreli (`brave-search-key.json`); sağlayıcı anahtarları düz metin (`provider-secrets.json`).

---

## 4. Doğrulanan sonuçlar

| Kontrol | Sonuç | Kanıt |
|---|---|---|
| `npm run typecheck` | **exit 0** | 1.1.6 ağacı |
| `npm run test:permissions` | **370/370 pass**, 0 fail, ~6,1 sn | 53 dosya |
| `npm audit` | **0 vulnerability** (info/low/moderate/high/critical = 0) | 439 bağımlılık |
| 1.1.6 derlemesi | `win-unpacked` sürüm **1.1.6.0**; asar'da Brave/secure-store/provider-secrets işaretleri var | 16:36–16:37 |
| Canlı web araması (1.1.6) | Sağlayıcı durumu dürüst: `configured:false`, `ULTRON_BRAVE_SEARCH_API_KEY`; DuckDuckGo ile **gerçek 3 sonuç** (`python.org`, `docs.python.org`) | çalışan 1.1.6, temp profil |
| SSRF redirect (canlı) | **AÇIK** — doğrudan `127.0.0.1` reddedildi; `https://httpbin.org/redirect-to?...127.0.0.1...` → `INTERNAL_ONLY SSRF_SECRET_TOKEN_12345` | 1.1.6, temp profil |
| Onaysız indirme + ikili bozulma (canlı) | **AÇIK** — controlled/0 grant/0 onay; `indirilenler/png` 14.798 B (orijinal 8.090 B), SHA256 farklı | 1.1.6, temp profil |
| Sağlayıcı anahtarı (canlı) | **DÜZ METİN** — fake anahtar `provider-secrets.json` içinde okundu | 1.1.6, temp profil |
| Ollama | `qwen3:8b` yüklü ve erişilebilir | `/api/tags` |
| Paketli smoke (`npm run test:packaged`) | **BAŞARISIZ — 2/2** | `ui-smoke.mjs:641` |
| Odaklı iptal testi | Aynı komut dizisi tek başına `lastBuild.exitCode = -3` kaydediyor | temp profil, 1.1.6 |
| Kurulu sürüm | **1.1.5.0**, 07:37 — güncel değil | `%LOCALAPPDATA%` |
| İmza | **NotSigned** | 1.1.6 setup |

**Paketli smoke hatası:** `AssertionError: İptal edilen işlem tamamlandı gibi kaydedilmemeli — 1 !== -3`. Test, iptalden hemen sonra `getWorkspace().lastBuild` okuyor. Uygulama `command-status: cancelled` olayını (`main.ts:1164`) `writeWorkspace({ lastBuild })` tamamlanmadan (`main.ts:1168-1169`) yayınlıyor. Odaklı tekrar aynı komutta `-3` yazdığı için ana neden **büyük olasılıkla olay sırası / yazma yarışı**; tam kök neden izole edilmedi. Test `build-result` olayını beklemeli veya durum yazımdan sonra yayınlanmalı.

---

## 5. Bulgular

### P1 — Kurulu sürüm güncel değil

Kurulu 1.1.5 (07:37), 14:49'daki izin/proje değişikliklerini ve 16:21+ 1.1.6 değişikliklerini içermiyor. `Desktop\Ultron` 1.1.6 çalışıyor ama başlat menüsü/kurulu uygulama eski. Bu, "kurulu sürüm yeni kodu kullanıyor" doğrulamasını geçersiz kılar.

**Öneri:** Smoke düzeltildikten sonra 1.1.7 (veya düzeltilmiş 1.1.6) paketlenip sessiz kurulumla güncellenmeli; kurulu `app.asar` hash'i ve sürümü yeniden doğrulanmalı.

### P1 — Paketli smoke 2/2 kırmızı

Yukarıda ayrıntılı. Üretim paketi bu haliyle "tüm paketli testler geçti" iddiasını taşıyamaz. Ayrıca testin kendisi deterministik değilse release kapısı güvenilmez.

**Öneri:** `command-status` yayınını `await writeWorkspace(...)` sonrasına al veya testi `build-result` (`exitCode === -3`) bekleyecek şekilde düzelt; iki ardışık paketli koşu yeşil olmadan yayınlama.

### P1 — SSRF: redirect sonrası URL doğrulanmıyor

`webFetchResearchClient` (`main.ts:3796-3821`) `fetch` çağrısında `redirect` ayarı vermiyor; Node `follow` varsayılanıyla 302/301 zincirini takip ediyor. `validateFetchableUrl` (`web-research.ts:354`) yalnızca **ilk** URL'yi denetliyor; `response.finalUrl` yeniden doğrulanmıyor. Bu yol `fetch_web_page`, `web_research`, `web_follow_link`, `web_download` ve `prefetchWebPages` tarafından kullanılıyor. Genel bir URL, `http://127.0.0.1:...` veya özel ağa yönlendirilirse gövde modele dönebilir. Ayrıca hostname'in DNS ile özel IP'ye çözülmesi (rebinding) engellenmiyor.

**Canlı kanıt (20.10.2026):** `researchFetch('http://127.0.0.1:9581/secret')` → `Özel ağ adresleri araştırılamaz (SSRF koruması)`. Aynı içerik `researchFetch('https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%3A9581%2Fsecret')` ile **`INTERNAL_ONLY SSRF_SECRET_TOKEN_12345`** olarak döndü. Yani filtre yalnızca ilk URL'de çalışıyor; 302 sonrası hedef doğrulanmıyor.

`research:fetch` ayrıca `research:permission-check` sonucunu uygulamıyor; grant verilmemiş temp profilde doğrudan çalıştı.

**Öneri:** `redirect: 'manual'` + her hop'ta `Location` doğrulaması veya `finalUrl`'yi yeniden `validateFetchableUrl` ile kontrol et; DNS çözümlemesini de özel/bogon IP'lere karşı denetle.

### P1 — `web_download` ikili dosyaları bozuyor

`runWebDownload` (`main.ts:1499-1514`) istemciden gelen gövdeyi metin olarak alıyor ve `Buffer.from(response.body, 'utf8')` ile yazıyor (satır 1510). PDF/ZIP/PNG gibi ikili içerik UTF-8 çöz/ kodla bozulur; `maxBytes` kesimi de karakter bazında. Önceki canlı kanıt yalnızca 577 B HTML indirmesiydi; ikili indirme test edilmemişti.

**Canlı kanıt (20.10.2026):** controlled/confirm profilde, 0 grant ve 0 onay olayıyla `Şu dosyayı indir: https://httpbin.org/image/png` mesajı `indirilenler/png` dosyasını oluşturdu. Dosya **14.798 B**, orijinal **8.090 B**; `saved sha256 = 2ba0411e...`, `original sha256 = 541a1ef5...` — **hash farklı**. Ayrıca URL sonu dosya adı değilse uzantı kayboluyor (`png`).

**Öneri:** İndirme yolunda gövdeyi `Buffer`/`ArrayBuffer` olarak taşı (research istemcisine `responseType` ekle) ve bayt sınırı uygula. Gerçek bir PNG/PDF ile uçtan uca test ekle; dosya adı/uzantısını `Content-Type` veya `Content-Disposition` ile belirle.

### P1 — `web_download` onaysız yazıyor; "salt okunur araştırma" varsayımı bozuk

`runWebDownload` yalnızca SSRF ve yol doğrulaması yapıyor; `editMode`/dosya oluşturma izni sormuyor. `prefetchWebPages` (`main.ts:1445-1456`) mesajda URL ve "indir/download" görürse `indirilenler/<dosya>` yoluna **otomatik** yazıyor. `tool-registry.ts` ise araştırma araçlarını "salt okunur ve SSRF korumalı" diye tanımlayıp `research` yeteneğini koşulsuz açıyor; `web_download` bu grupta. Yani web erişimini açmak için kullanılan "salt okunur" gerekçesi artık geçerli değil.

**Canlı kanıt (20.10.2026):** controlled/confirm modda, `permissionGrants: 0` iken mesaj gönderildi; **hiç `approval` olayı yayınlanmadan** `indirilenler/png` oluşturuldu. Dosya sistemi yazımı, izin modelinin `file-create` onayından geçmedi.

**Öneri:** İndirmeyi `file-create` kategorisine bağla; review modunda onay iste; prefetch'te otomatik indirme yapma (yalnızca sayfa oku). Araç açıklamasını ve capability yorumunu güncelle.

### P2 — Sağlayıcı anahtarları düz metin

`provider-secrets.ts:53-63` `provider-secrets.json` dosyasını `mode: 0o600` ile yazıyor; Windows'ta bu mod etkisizdir. Brave anahtarı `secure-secret-store.ts` ile `safeStorage` şifreli saklanırken OpenAI-uyumlu ve GitHub anahtarları düz metin. Kullanıcı profili ACL'i bir miktar koruma sağlasa da aynı kullanıcıyla çalışan her süreç okuyabilir.

**Canlı kanıt (20.10.2026):** temp profilde `saveSettings({ provider:'openai-compatible', apiKey:'sk-ultron-review-fake-1234567890' })` çağrısı sonrası `provider-secrets.json` içeriği:

```json
{ "version": 1, "keys": { "openai-compatible": "sk-ultron-review-fake-1234567890" } }
```

Anahtar düz metin okunabildi; dosya şifreli değil. (Anahtar sahtedir, gerçek sır kullanılmadı.)

**Öneri:** Tüm sağlayıcı sırlarını `safeStorage` ile şifrele; mevcut düz metin dosyasını ilk açılışta taşı ve sil. UI metninde "şifreli" iddiası varsa buna uy.

### P3 — CSP ve Electron sertleştirmeleri eksik

- `src/index.html` ve üretilen `out/renderer/index.html` içinde **CSP yok**; `onHeadersReceived` ile de eklenmiyor.
- `setPermissionRequestHandler` / `setPermissionCheckHandler` / `web-contents-created` yok.
- Markdown `ReactMarkdown` ile render ediliyor; `dangerouslySetInnerHTML` yok (iyi), ancak uzak görseller varsayılan `img` ile otomatik yüklenebilir (IP/takip sızıntısı).

`sandbox`, `contextIsolation`, `nodeIntegration:false`, IPC gönderen doğrulaması ve gezinme engelleri doğru. CSP, XSS savunma derinliği ve IPC yüzeyi için önerilir.

### P3 — Monolit ve 99 araç / bağlam baskısı

`main.ts` 6.701 satır, 89 IPC, 99 araç; `App.tsx` 1.465 satır. `num_ctx: 16384`, `maxContextChars: 24000`; araç şemaları ~6,8k token (kod yorumu). 8B modelde 99 araç + uzun açıklamalar + web ön-getirme bağlamı seçim kalitesini düşürüyor; önceki oturumda qwen3:8b'nin granüler araç seçiminde zayıf olduğu zaten gözlenmişti. Yeni araçlar bu baskıyı artırıyor.

**Öneri:** `main.ts`'i araç yürütücü / IPC / ajan döngüsü / web / masaüstü olarak böl; görev başına görünür araç sayısını küçük tut (router veya capability grupları); bağlam bütçesini ölç ve test et.

### P3 — Ölü/kapsanmayan modüller ve paketlenmeyen CLI

- `electron/ultra-core.ts` **0 referans** (ölü kod).
- `project-verifier`, `project-generator`, `project-template-registry`, `project-cli` için doğrudan test yok.
- `bin/ultron.js` `package.json` `bin` alanında, ancak electron-builder `files` yalnızca `out/**/*` + `package.json` alıyor; **kurulu uygulamada CLI yok**, yalnızca kaynaktan çalışır.

### P3 — Dokümantasyon kayması

- `README.md:24`: "Bulut yapay zekâ, OpenAI API'si, API anahtarı ve telemetri yoktur" — 1.1.6'da OpenAI-uyumlu sağlayıcı ve Brave API anahtarı var.
- `README.md:161`: son paket olarak **1.1.0** yazıyor.
- `docs/AGENT-CAPABILITY-REPORT-2026-10-20.md` sürüm **1.1.5**.
- 1.1.6 için changelog yok.

### P3 — Depo hijyeni ve sürüm kontrolü

Kök dizinde 30+ tek seferlik `apply_*.py`, `fix_*.py`, `final_fix.py`, geçici loglar ve eski release görselleri var. Depo **git değil**; commit/diff/geri alma yok. Bu, inceleme ve hata ayıklamayı zorlaştırıyor.

### P4 — Diğer sınırlar

- Installer imzasız → SmartScreen.
- `desktop_screenshot` yalnızca PNG yolu döndürüyor; qwen3:8b görsel göremiyor (model için görsel doğrulama yok).
- Tarayıcı otomasyonu yok: tıklama/form doldurma/JS çalıştırma yok; yalnızca HTTP okuma/indirme/bağlantı takibi.
- Masaüstü kontrolü etkileşimli oturum gerektiriyor; kilitli/RDP kopuk oturumda çalışmaz.
- PTY yok; terminal çıktısı satır bazlı.
- 1.1.6 performansı ölçülmedi; son baseline 1.1.0 (startup ~2,0 sn, ilk chunk ~654 ms). Güncel ölçüm önerilir.
- Google araması ve geniş kapsamlı dosya erişimi (önceki kullanıcı kararıyla) kapsam dışı.

---

## 6. Güçlü yönler

- **Güvenlik temeli:** sandbox + contextIsolation + nodeIntegration kapalı; IPC yalnızca doğrulanmış ana pencereden; dış URL allowlist'i; `will-navigate` engeli; proje dışı yol reddi; komut whitelist'i ve kabuk operatörü reddi.
- **İzin modeli:** modlar, grant/scope/resource-root, audit, onay UI'ı; broad access zaman damgası doğrulaması.
- **Dürüstlük mekanizmaları:** araç tekrar koruması, komut yürütme kanıtı, build kaydı, undo/yedek, hata mesajlarında sır maskeleme.
- **Web:** gerçek arama, SSRF statik filtresi, güvenilmeyen içerik işaretleme, sonuç önbelleğine almama; Brave anahtarı şifreli.
- **Test kültürü:** 370 birim testi, 53 dosya, paketli smoke, kurulu sürüm testleri, audit kanıtları.
- **Paketleme:** tekrarlanabilir electron-builder çıktısı, sürümlü installer, sessiz kurulum.

---

## 7. Öncelikli düzeltme sırası

1. **Paketli smoke'u yeşile al:** `command-status` yayınını yazma sonrasına taşı veya testi `build-result` bekleyecek şekilde düzelt; 2/2 yeşil doğrula.
2. **Web indirmeyi düzelt:** bayt bazlı gövde + `file-create` onayı + prefetch'te otomatik indirmeyi kaldır.
3. **Redirect SSRF'yi kapat:** `redirect:'manual'` / her hop doğrulaması + DNS/IP kontrolü; test ekle.
4. **Tüm sırları şifrele:** provider-secrets'i `safeStorage`'a taşı; migrasyon ve test.
5. **CSP + izin handler'ları:** renderer CSP, `setPermissionRequestHandler` (varsayılan red), uzak görsel politikası.
6. **Sürüm/dağıtım:** 1.1.7 bump + changelog; paketle; sessiz kurulum; kurulu `app.asar` hash ve sürüm doğrula; README/docs güncelle.
7. **Bakım:** `main.ts` böl, ölü `ultra-core` kaldır, CLI modüllerine test ekle, kök temizliği + git init, kod imzalama.

---

## 8. Doğrulanamayanlar

- Brave Search API gerçek anahtarla test edilmedi (anahtar yok; uydurulmadı). Anahtarsız DuckDuckGo yolu canlı doğrulandı.
- DNS rebinding / özel IP'ye çözülen hostname canlı test edilmedi; yalnızca HTTP redirect SSRF doğrulandı.
- 1.1.6 performans/başlangıç süresi ölçülmedi.
- Kurulu 1.1.5 üzerinde yeni özellikler test edilmedi (kurulu sürüm zaten eski).
- Google araması ve geniş dosya erişimi kapsam dışı olduğu için değerlendirilmedi.

---

## 9. Karar

**1.1.6 güçlü bir beta:** mimari ve güvenlik temelleri sağlam, web araması gerçekten çalışıyor, yeni sır saklama yaklaşımı doğru yönde. Ancak üretim için **P1'ler (kurulu sürüm, paketli smoke, canlı doğrulanan SSRF, onaysız/bozuk indirme) ve P2'ler (düz metin anahtar, CSP, ...)** kapatılmadan "tamamlandı" denmemeli. Özellikle kurulu uygulamanın hâlâ 1.1.5 olması, kullanıcı deneyiminde "yeni sürüm" ile "eski sürüm"ün karışmasına yol açıyor.
