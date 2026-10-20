# Ultron 1.1.6 — Hata ve Eksiklik Raporu

Tarih: 20.10.2026
İnceleme: kaynak `C:\Users\user\Desktop\codexx`, çalışan kopya `C:\Users\user\Desktop\Ultron` (1.1.6.0), kurulu kopya `%LOCALAPPDATA%\Programs\Ultron` (1.1.5.0)
İlgili genel inceleme: `docs/INCELEME-1.1.6-2026-10-20.md`

> Bu rapor "uygulama nerede hata yapıyor, nerede eksik" sorusuna odaklanır. Her bulgu **canlı test**, **paketli test** veya **kod incelemesi** olarak işaretlendi. API anahtarı yoksa anahtar gerektiren yol test edilmedi; hiçbir sır uydurulmadı.

---

## 1. Yönetici özeti

En önemli 5 sorun:

1. **Kurulu uygulama eski.** Başlat menüsü **1.1.5 (07:37)** çalıştırıyor; 1.1.6 yalnızca `Desktop\Ultron` kopyasında. Kullanıcı "yeni sürüm" sandığı eski kodu açabilir.
2. **Paketli smoke 2/2 kırmızı.** `npm run test:packaged`, iptal edilen komutun `lastBuild` kaydında (`ui-smoke.mjs:641`) düşüyor. Sürüm "paketli testler geçti" iddiasını taşıyamaz.
3. **SSRF canlı olarak kanıtlandı.** Doğrudan `127.0.0.1` isteği reddedilirken, genel bir URL'nin 302 yönlendirmesi `127.0.0.1:9581` üzerindeki gizli içeriği döndürdü (`INTERNAL_ONLY SSRF_SECRET_TOKEN_12345`).
4. **`web_download` onaysız yazıyor ve ikili dosyaları bozuyor.** Controlled/0 grant profilde, hiç onay olmadan `indirilenler/png` oluştu; 8.090 B PNG, 14.798 B olarak kaydedildi (SHA256 farklı).
5. **Sağlayıcı API anahtarları düz metin.** Brave anahtarı `safeStorage` ile şifreliyken OpenAI-uyumlu anahtar `provider-secrets.json` içinde okunabildi.

Kısa karar: **1.1.6 güçlü bir beta, üretim için hazır değil.** Özellikle web indirme ve SSRF, güvenlik/izin modelini fiilen delen hatalar.

---

## 2. Hata envanteri

| ID | Önem | Alan | Hata | Kanıt |
|---|---|---|---|---|
| H-01 | **Kritik** | Dağıtım | Kurulu sürüm 1.1.5; 1.1.6 kurulmadı | Sürüm/asar kontrolü |
| H-02 | **Kritik** | Test/kalite | Paketli smoke 2/2 başarısız | `ui-smoke.mjs:641` |
| H-03 | **Yüksek** | Güvenlik | Redirect ile SSRF; son URL doğrulanmıyor | Canlı test |
| H-04 | **Yüksek** | İzin modeli | `web_download` dosya yazma onayı sormuyor | Canlı test |
| H-05 | **Yüksek** | Fonksiyon | `web_download` ikili dosyaları bozuyor | Canlı test |
| H-06 | **Orta** | Güvenlik | Sağlayıcı anahtarları düz metin | Canlı test |
| H-07 | **Orta** | Güvenlik | `research:fetch`, izin kontrolünü uygulamıyor | Canlı test + kod |
| H-08 | **Orta** | Tutarlılık | İptal sonrası workspace eski build'i gösterebiliyor | Paketli test + kod |
| H-09 | **Düşük** | Kullanılabilirlik | İndirilen dosyanın uzantısı kayboluyor (`png`) | Canlı test |
| E-01 | **Orta** | Güvenlik | CSP ve izin handler'ları yok | Kod incelemesi |
| E-02 | **Orta** | Ajan | 99 araç + 8B model + dar bağlam | Metrik/kod |
| E-03 | **Orta** | Bakım | `main.ts` 6.701 satır; monolit | Metrik |
| E-04 | **Orta** | Doküman | README/docs sürüm ve özelliklerde eski | Kod/doküman |
| E-05 | **Orta** | Dağıtım | Installer imzasız | `NotSigned` |
| E-06 | **Düşük** | Bakım | Ölü `ultra-core.ts`, testsiz CLI modülleri | Referans taraması |
| E-07 | **Düşük** | Dağıtım | `bin/ultron.js` pakete girmiyor | electron-builder `files` |
| E-08 | **Düşük** | Depo | Git yok; 30+ tek seferlik script | Dizin taraması |
| E-09 | **Düşük** | Performans | 1.1.6 performansı ölçülmedi | Baseline yok |
| E-10 | **Düşük** | Yetenek | Tarayıcı otomasyonu, görsel doğrulama, PTY, Google yok | Tasarım/kod |

---

## 3. Hataların ayrıntısı

### H-01 — Kurulu sürüm güncel değil (Kritik)

**Belirti:** `%LOCALAPPDATA%\Programs\Ultron\Ultron.exe` → **1.1.5.0**, 20.10 07:37:46; `app.asar` 2.494.989 B. Güncel 1.1.6 asar'ı 2.529.853 B ve SHA256 `37B1E86A...`. `Desktop\Ultron` 1.1.6.0 (16:37) ve `release\win-unpacked` ile birebir aynı.

**Etki:** Başlat menüsü/kurulu uygulama; Brave araması, `safeStorage` anahtar deposu, `provider-secrets`, yeni izin/proje değişikliklerini içermiyor. Kullanıcı hangi sürümü çalıştırdığını ayırt edemiyor.

**Kök neden:** 1.1.6 installer'ı üretildi (16:37) ama kurulum çalıştırılmadı; yalnızca masaüstü kopyası güncellendi.

**Düzeltme/kanıt:** 1.1.7 paketle → sessiz kurulum → `ProductVersion 1.1.7.0`, asar hash ve yeni kod işaretlerini doğrula → `test:installed` çalıştır.

---

### H-02 — Paketli smoke 2/2 başarısız (Kritik)

**Belirti:**
```
AssertionError [ERR_ASSERTION]: İptal edilen işlem tamamlandı gibi kaydedilmemeli
1 !== -3
at tests/ui-smoke.mjs:641
```
İki ardışık `npm run test:packaged` koşusunda da aynı assert.

**Kök neden (kısmi):** `main.ts:1164` `command-status: cancelled` olayını yayınlıyor; `writeWorkspace({ lastBuild })` ise `1168-1169`'da, yani **sonra** tamamlanıyor. Test iptalden hemen sonra `getWorkspace().lastBuild` okuyor. Odaklı tekrar (önce başarısız komut, sonra iptal) `-3` kaydettiği için sorun büyük olasılıkla **olay sırası/yazma yarışı**; tam kök neden izole edilmedi.

**Etki:** Release kapısı güvenilmez; "paketli testler geçti" denemez. Kullanıcı arayüzünde kısa süre eski build sonucu görünebilir.

**Düzeltme:** `emit`'i `await writeWorkspace(...)` sonrasına al **veya** testi `build-result` (`exitCode === -3`) bekleyecek şekilde düzelt. Kabul: iki ardışık paketli koşu yeşil.

---

### H-03 — Redirect ile SSRF (Yüksek, canlı kanıt)

**Belirti:** `researchFetch` yalnızca ilk URL'yi doğruluyor; `fetch` varsayılan `redirect: 'follow'` ile 302'yi takip ediyor; `response.finalUrl` yeniden doğrulanmıyor.

**Canlı kanıt:**
- `researchFetch('http://127.0.0.1:9581/secret')` → `Özel ağ adresleri araştırılamaz (SSRF koruması)` (doğru).
- `researchFetch('https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%3A9581%2Fsecret')` → **`INTERNAL_ONLY SSRF_SECRET_TOKEN_12345`**, dönen URL `http://127.0.0.1:9581/secret`.

**Etki:** Genel bir link, yerel Ollama'ya (`11434`), geliştirme sunucularına, router/admin panellerine veya intranet servislerine yönlendirilebilir; içerik modele/kullanıcıya döner. `fetch_web_page`, `web_research`, `web_follow_link`, `web_download`, `prefetchWebPages` aynı istemciyi kullanıyor.

**Kök neden:** Statik URL filtresi + redirect takibi; her hop doğrulanmıyor; DNS rebinding kontrolü yok.

**Düzeltme:** `redirect: 'manual'` + her `Location` için `validateFetchableUrl`; DNS çözümle ve özel/bogon IP'leri reddet; test: doğrudan localhost, redirect-to-localhost, DNS rebinding, genel URL (izinli).

---

### H-04 — `web_download` onaysız yazıyor (Yüksek, canlı kanıt)

**Belirti:** `runWebDownload` (`main.ts:1499-1514`) yalnızca SSRF + yol doğrulaması yapıyor; `editMode`/`file-create` izni sormuyor. `prefetchWebPages` (`1445-1456`) mesajda URL + "indir/download" görürse `indirilenler/<dosya>` yoluna otomatik yazıyor.

**Canlı kanıt:** Profil `mode: controlled`, `commandMode: confirm`, `permissionGrants: 0`; mesaj: `Şu dosyayı indir: https://httpbin.org/image/png`. **0 `approval` olayı** ile `indirilenler/png` oluştu.

**Etki:** Kullanıcı onayı olmadan projeye dosya yazılır. "Araştırma araçları salt okunur" gerekçesi geçersiz; `research` yeteneği koşulsuz açık.

**Düzeltme:** İndirmeyi `file-create` kategorisine bağla; review modunda onay iste; prefetch'te otomatik indirme yapma; `research` capability yorumunu ve araç açıklamasını düzelt.

---

### H-05 — `web_download` ikili dosyaları bozuyor (Yüksek, canlı kanıt)

**Belirti:** `webFetchResearchClient` gövdeyi UTF-8 metne çeviriyor; `runWebDownload` `Buffer.from(response.body, 'utf8')` ile yazıyor (`main.ts:1510`). `maxBytes` kesimi karakter bazında.

**Canlı kanıt:** `https://httpbin.org/image/png`:
- Orijinal: **8.090 B**, SHA256 `541a1ef5...`
- Kaydedilen: **14.798 B**, SHA256 `2ba0411e...` — **hash farklı**.
- Aynı dönüşüm simülasyonu da 14.798 B / `2ba0411e...` verdi; yani kaydedilen dosya, kod yolunun birebir çıktısı.

**Etki:** PDF, ZIP, PNG, EXE gibi indirmeler kullanılamaz; kullanıcı "indirdim" sanır, dosya bozuktur.

**Düzeltme:** İndirme yolunda `Buffer`/`ArrayBuffer` taşı; bayt sınırı uygula; `Content-Type`/`Content-Disposition` ile uzantı belirle; gerçek PNG/PDF hash testi ekle.

---

### H-06 — Sağlayıcı anahtarları düz metin (Orta, canlı kanıt)

**Belirti:** `provider-secrets.ts:53-63` dosyayı `mode: 0o600` ile yazıyor; Windows'ta mod etkisiz. Brave anahtarı `safeStorage` şifreli; OpenAI-uyumlu/GitHub anahtarları düz metin.

**Canlı kanıt:** Temp profilde `saveSettings({ provider:'openai-compatible', apiKey:'sk-ultron-review-fake-1234567890' })` sonrası `provider-secrets.json`:
```json
{ "version": 1, "keys": { "openai-compatible": "sk-ultron-review-fake-1234567890" } }
```
Anahtar düz metin okunabildi. (Anahtar sahtedir.)

**Etki:** Aynı kullanıcıyla çalışan her süreç, yedek/AV taraması veya dosya erişimi olan bir araç anahtarı okuyabilir.

**Düzeltme:** Tüm sağlayıcı sırlarını `safeStorage` ile şifrele; mevcut dosyayı ilk açılışta taşı ve sil; log/redaction testlerini genişlet.

---

### H-07 — `research:fetch` izin kontrolünü uygulamıyor (Orta, canlı + kod)

**Belirti:** `research:permission-check` ayrı bir IPC; `research:fetch` (`main.ts:6299`) yalnızca `validateFetchableUrl` çağırıyor, `canAccessExternalUrl` sonucunu uygulamıyor. Grant verilmemiş temp profilde doğrudan `researchFetch` çalıştı.

**Etki:** Ana süreçte zorunlu izin yok; UI'daki kontrol advisory. CSP olmadığı için renderer'da bir XSS/compromise durumunda dış URL okuma ve SSRF zinciri için ek yüzey.

**Düzeltme:** `research:fetch` içinde `canAccessExternalUrl`/grant kontrolü zorunlu; UI ve ana süreç aynı politikayı kullansın; test ekle.

---

### H-08 — İptal sonrası workspace tutarlılığı (Orta)

**Belirti:** `command-status` yazımdan önce yayınlanıyor. Paketli smoke bunu yakalıyor; odaklı testte `-3` doğru kaydedildi. Yani hata her zaman değil, **zamanlama/büyük workspace** koşullarında görünüyor.

**Etki:** Test güvenilmezliği; kısa süreli eski build sonucu; otomasyonlarda yanlış okuma.

**Düzeltme:** Olay sırasını düzelt veya testi `build-result` bekleyecek şekilde güncelle; `lastBuild` yazımını idempotent yap.

---

### H-09 — İndirme dosya adı/uzantısı (Düşük)

**Belirti:** Prefetch dosya adını URL path'inin son parçasından alıyor: `https://httpbin.org/image/png` → `indirilenler/png` (uzantısız). `Content-Type`/`Content-Disposition` kullanılmıyor.

**Etki:** Kullanıcı dosyayı açamaz/ tanıyamaz; tarayıcıda "dosya" olarak görünür.

**Düzeltme:** `Content-Disposition` → `Content-Type` eşlemesi → güvenli varsayılan; uzantıyı doğrula.

---

## 4. Eksikler

### E-01 — CSP ve Electron izin handler'ları yok (Orta)

- `src/index.html` ve `out/renderer/index.html` içinde CSP yok; `onHeadersReceived` yok.
- `setPermissionRequestHandler` / `setPermissionCheckHandler` / `web-contents-created` yok.
- `ReactMarkdown` `dangerouslySetInnerHTML` kullanmıyor (iyi), ancak uzak görseller varsayılan `img` ile otomatik yüklenebilir (IP/takip).
- `sandbox`, `contextIsolation`, `nodeIntegration:false`, IPC sender doğrulaması doğru.

**Neden önemli:** CSP, XSS savunma derinliği; izin handler'ları kamera/mikrofon/bildirim gibi istekleri varsayılan reddetmek için. `research:fetch` gibi geniş IPC yüzeyiyle birlikte risk artıyor.

### E-02 — 99 araç + 8B model + dar bağlam (Orta)

- 99 araç yürütücüsü, 89 IPC; `qwen3:8b`, `num_ctx: 16384`, `maxContextChars: 24000`; araç şemaları ~6,8k token (kod yorumu).
- Önceki gözlem: 8B model granüler araç seçiminde zayıf; çerçeve zorlamaları/ön-getirme telafi ediyor.
- Yeni web araçları bu yükü artırıyor.

**Eksik:** Görev başına araç router'ı/gruplama; görünür araç sayısını küçültme; bağlam bütçesi ölçümü; modelin yanlış araç seçimini yakalayan testler.

### E-03 — Monolit (Orta)

`main.ts` 6.701 satır, 89 IPC, 99 araç; `App.tsx` 1.465 satır. Bakım/inceleme zor; bir hata tüm dosyayı etkiliyor.

**Eksik:** `ipc/`, `tools/`, `agent/`, `web/`, `desktop/` ayrımı; her modül için dar test.

### E-04 — Dokümantasyon kayması (Orta)

- `README.md:24`: "Bulut yapay zekâ, OpenAI API'si, API anahtarı ve telemetri yoktur" — 1.1.6'da OpenAI-uyumlu sağlayıcı ve Brave API anahtarı var.
- `README.md:161`: son paket **1.1.0**.
- `docs/AGENT-CAPABILITY-REPORT-2026-10-20.md`: **1.1.5**.
- 1.1.6 changelog'u yok.

### E-05 — İmzasız installer (Orta)

`Get-AuthenticodeSignature` → `NotSigned`. SmartScreen uyarır; kurumsal dağıtımda güven sorunu. Kod imzalama sertifikası/CI adımı yok.

### E-06 — Ölü kod ve testsiz modüller (Düşük)

- `electron/ultra-core.ts`: **0 referans**.
- `project-verifier`, `project-generator`, `project-template-registry`, `project-cli`: doğrudan test yok.
- `project-verifier` yalnızca CLI üretim hattında; Electron paketinde yok.

### E-07 — CLI paketlenmiyor (Düşük)

`package.json` `bin.ultron = ./bin/ultron.js`, ancak electron-builder `files` yalnızca `out/**/*` + `package.json`. Kurulu uygulamada `ultron` komutu yok; yalnızca kaynaktan çalışır.

### E-08 — Depo hijyeni / sürüm kontrolü (Düşük)

Kökte 30+ `apply_*.py`, `fix_*.py`, `final_fix.py`, geçici loglar; `.git` yok. Diff/commit/geri alma yok; hangi değişikliğin nereden geldiği izlenemiyor.

### E-09 — Performans ölçülmemiş (Düşük)

Son baseline 1.1.0: startup ~2,0 sn, ilk chunk ~654 ms. 1.1.6 için güncel ölçüm yok; 99 araç ve yeni modüllerle başlangıç/bağlam maliyeti bilinmiyor.

### E-10 — Yetenek boşlukları (Düşük/ürün kararı)

- **Tarayıcı otomasyonu yok:** tıklama, form doldurma, JS çalıştırma yok; yalnızca HTTP okuma/indirme/bağlantı takibi.
- **Görsel doğrulama yok:** `desktop_screenshot` PNG yolu döndürüyor; qwen3:8b görsel göremiyor.
- **Masaüstü kontrolü** etkileşimli oturum gerektiriyor; kilitli/RDP kopuk oturumda çalışmaz.
- **PTY yok:** terminal çıktısı satır bazlı.
- **Google araması yok:** anahtarsız DuckDuckGo/Stack Exchange/HN/Wikipedia zinciri.
- **Geniş dosya erişimi** önceki kullanıcı kararıyla kapsam dışı.

---

## 5. Nerede doğru yapıyor?

- Güvenlik temeli: sandbox + contextIsolation + nodeIntegration kapalı; IPC yalnızca doğrulanmış ana pencereden; dış URL allowlist; `will-navigate` engeli; proje dışı yol reddi; komut whitelist'i ve kabuk operatörü reddi.
- İzin modeli: modlar, grant/scope/resource-root, audit, onay UI'ı, broad-access zaman damgası.
- Dürüstlük: araç tekrar koruması, komut yürütme kanıtı, build kaydı, undo/yedek, sır maskeleme.
- Web: gerçek arama, SSRF statik filtresi (ilk URL), güvenilmeyen içerik işaretleme, sonuç önbelleğine almama; Brave anahtarı şifreli.
- Test: 370/370 birim testi, 53 dosya; typecheck 0; audit 0.

---

## 6. Öncelikli düzeltme planı

| Sıra | İş | Kabul kriteri |
|---|---|---|
| 1 | Paketli smoke sırası | `test:packaged` 2/2 yeşil; `lastBuild.exitCode === -3` doğrulanıyor |
| 2 | SSRF kapat | Doğrudan localhost + redirect-to-localhost + DNS rebinding reddediliyor; genel URL çalışıyor |
| 3 | İndirme düzelt | PNG/PDF indirme hash'i orijinalle aynı; `file-create` onayı var; prefetch otomatik indirmiyor |
| 4 | Sırlar | Tüm sağlayıcı anahtarları `safeStorage` şifreli; migrasyon testi |
| 5 | İzin zorlaması | `research:fetch` grant verilmemiş profilde reddediyor; UI ile ana süreç aynı politikada |
| 6 | CSP + handler | CSP header/meta; `setPermissionRequestHandler` varsayılan red |
| 7 | Sürüm/dağıtım | 1.1.7 bump + changelog; imzalı/unsigned kararı; sessiz kurulum; kurulu sürüm doğrulama |
| 8 | Bakım | `main.ts` böl; `ultra-core` kaldır; CLI testleri; kök temizliği + git init |

---

## 7. Ham kanıtlar

### 7.1 SSRF

```
direct localhost fetch: {"ok":false,"error":"... Özel ağ adresleri araştırılamaz (SSRF koruması)."}
redirect fetch: {"ok":true,"text":"INTERNAL_ONLY SSRF_SECRET_TOKEN_12345","url":"http://127.0.0.1:9581/secret"}
SSRF_PROVEN: true
```

### 7.2 Onaysız indirme + bozulma

```
saved path: ...\ultron-download-project-...\indirilenler\png
saved bytes: 14798 original bytes: 8090 same hash: false
saved sha256: 2ba0411e00ff37418b081d6fc3547ad07dce11158bdb818906b34a86090d1478
original sha256: 541a1ef5373be3dc49fc542fd9a65177b664aec01c8d8608f99e6ec95577d8c1
approval events: 0
workspace permissions: {"grants":0,"mode":"controlled","commandMode":"confirm"}
```

### 7.3 Sağlayıcı anahtarı

```json
{
  "version": 1,
  "keys": {
    "openai-compatible": "sk-ultron-review-fake-1234567890"
  }
}
```

### 7.4 Test/derleme

```
typecheck-exit=0
# tests 370
# pass 370
# fail 0
npm audit: info 0, low 0, moderate 0, high 0, critical 0, total 0
packaged-smoke-exit=1
AssertionError: İptal edilen işlem tamamlandı gibi kaydedilmemeli — 1 !== -3
```

### 7.5 Sürümler

```
Kurulu:        1.1.5.0, 20.10.2026 07:37:46, app.asar 2.494.989 B
Desktop:       1.1.6.0, 20.10.2026 16:37:20, app.asar SHA256 37B1E86A... (win-unpacked ile aynı)
Setup 1.1.6:   121.169.252 B, 16:37:24, SHA256 C52054D3..., NotSigned
Portable 1.1.6:120.926.114 B, 16:37:50, SHA256 B1F388C2...
```

---

## 8. Doğrulanamayanlar / sınırlar

- Brave Search API gerçek anahtarla test edilmedi (anahtar yok; uydurulmadı). Anahtarsız DuckDuckGo yolu canlı doğrulandı.
- DNS rebinding ve özel IP'ye çözülen hostname canlı test edilmedi; yalnızca HTTP redirect SSRF doğrulandı.
- Paketli smoke hatasının **tam** kök nedeni izole edilmedi; olay sırası/yazma yarışı en güçlü açıklama.
- 1.1.6 performansı ölçülmedi.
- Kurulu 1.1.5 üzerinde yeni özellikler test edilmedi (kurulu sürüm eski).
- Google araması ve geniş dosya erişimi kapsam dışı.

---

## 9. Sonuç

**Uygulama nerede hata yapıyor?** En net yerler: web indirme (onaysız yazma + bozuk ikili), web fetch (redirect SSRF), sır saklama (düz metin sağlayıcı anahtarı), dağıtım (kurulu 1.1.5) ve release testi (paketli smoke kırmızı).

**Nerede eksik?** CSP/izin sertleştirmesi, araç/bağlam yönetimi, monolit ayrıştırma, test kapsamı (CLI/indirme/redirect), dokümantasyon/sürüm disiplini, imzalama, depo hijyeni ve bazı ürün yetenekleri (tarayıcı otomasyonu, görsel doğrulama, PTY, Google).

Bunlar kapatılmadan 1.1.6 "tamamlandı" olarak işaretlenmemeli; ancak mimari temel ve test kültürü, düzeltmeler için sağlam bir zemin sunuyor.
