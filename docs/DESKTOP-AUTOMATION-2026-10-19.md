# ULTRON MASAÜSTÜ AJANI — UYGULAMA NOTU

Tarih: 19.10.2026 · Sürüm: 1.1.0 · Modül: `electron/desktop-control.ts` + `electron/main.ts` (araçlar/izinler) + `src/App.tsx` (arayüz)

Ultron, yalnızca dosya okuyan bir asistandan; kullanıcının Windows bilgisayarında **gerçek fare/klavye/ekran/pencere işlemleri** yapabilen bir masaüstü ajanına dönüştürüldü.

## 1. Yeni bağımlılık eklenmedi

Masaüstü kontrolü **Windows'un kendi PowerShell'i + .NET Framework** üzerinden çalışır:

- `System.Windows.Forms` — `SendKeys`/ekran sınırları
- `System.Drawing` — `Graphics.CopyFromScreen` ile ekran görüntüsü
- `UIAutomationClient` / `UIAutomationTypes` — arayüz öğesi tespiti
- `user32.dll` P/Invoke (C#) — fare, klavye, pencere yönetimi

`electron-builder` yalnız `out/**` ve `package.json` paketlediği için PowerShell betiği **çalışma anında `userData/desktop-control/ultron-desktop.ps1` olarak yazılır** (UTF-8 BOM ile; PowerShell 5.1 betiği BOM olmadan ANSI okur ve Türkçe metinler bozulur).

## 2. Yeni araçlar (15)

| Araç | İşlev | Kategori (izin) |
| --- | --- | --- |
| `desktop_state` | Ekran boyutu, fare konumu, odaklı pencere, pencere listesi, imlecin altındaki öğe | `screen-capture` |
| `desktop_screenshot` | Tam ekran görüntüsü (PNG) + pencere durumu | `screen-capture` |
| `desktop_ui_elements` | UI Automation ile düğme/metin/menü öğeleri + **metin kutusunun içeriği** | `screen-capture` |
| `desktop_preflight` | **Ortam teşhisi:** etkileşimli masaüstü oturumu var mı, ekran sınırları, UI Automation erişimi, fare okunabilirliği | `screen-capture` |
| `desktop_text_task` | **Deterministik akış:** uygulamayı aç → odaklan → metni yaz → isteğe bağlı kaydet → adım adım doğrula | `input-control` |
| `desktop_click_element` | **Deterministik tıklama:** UI Automation ile öğeyi bul, merkezine tıkla, odaklı pencereyi doğrula | `input-control` |
| `desktop_mouse_move` | Fareyi koordinata taşır | `input-control` |
| `desktop_mouse_click` | Tıklar / çift tıklar, sonrasında odak ve öğe doğrulanır | `input-control` |
| `desktop_type_text` | Klavyeden yazar (Türkçe karakterler dahil) | `input-control` |
| `desktop_press_keys` | `ctrl+s`, `alt+f4`, `enter`… kombinasyonları | `input-control` |
| `desktop_list_windows` | Açık pencereleri listeler | `screen-capture` |
| `desktop_focus_window` | Pencereye odaklanır (ALT kilidi açılır) | `screen-capture` |
| `desktop_close_window` | Pencereye WM_CLOSE gönderir (zarif kapanış) | `screen-capture` |
| `desktop_launch_app` | Uygulama başlatır + pencereyi doğrular | `app-launch` |
| `desktop_open_explorer` | Dosya Gezgini'ni klasörde açar | `app-launch` |

Araçlar `electron/tool-registry.ts` içindeki `desktop` yeteneğiyle eşleşir; yalnızca masaüstüyle ilgili isteklerde modele görünür (kural: `masaüstü|fare|tıkla|klavye|ekran|pencere|not defteri|dosya gezgini|görev çubuğu|başlat menüsü`).

## 2.1 Opt-in: masaüstü kontrolü varsayılan KAPALI

`PermissionProfile.allowDesktopControl` (varsayılan `false`). Kapalıyken:

- `selectToolsForTask(..., { desktopEnabled: false })` bu araçları **modele hiç göstermez** (sadece reddetmekle kalmaz, görünmezler).
- IPC/araç çağrısı doğrudan reddedilir: *"Masaüstü kontrolü kapalı. Ayarlar > Hafıza ve yetkiler bölümünden ... aç."*
- Arayüzde açma kapatma anahtarı: **Hafıza ve yetkiler > "Masaüstü kontrolünü etkinleştir"**.

Bu, masaüstüne erişimi kısıtlı ortamlarda (kilitli/RDP kopuk oturum, paylaşımlı bilgisayar, kurumsal kısıtlar) ajanın yanlış yere tıklamasını ve kullanıcıyı yormasını engeller.

## 2.2 Sınırlı erişim için teşhis

`desktop_preflight` şunları raporlar: oturum kimliği, explorer oturumları, **etkileşimli masaüstü var mı**, `UserInteractive`, UI Automation erişimi, fare okunabilirliği, ekran sınırları ve anlaşılır notlar. Arayüzdeki "Ortamı teşhis et" düğmesi bunu gösterir.

Örnek çıktı: `{"hasInteractiveDesktop":true,"uiAutomation":true,"cursorReadable":true,"screen":{"width":1920,"height":1080},"notes":["Masaüstü kontrolü için ortam uygun görünüyor."]}`

## 2.3 Bilgisayara dosya erişimi (kapsam keşfi + yetki isteme)

Daha önce kullanıcı klasör yetkilendirse bile **ajan bu kapsamları keşfedemiyordu**: kaynak kökler sistem isteminde yoktu ve modele "hangi @resource id hangi klasör?" diyen bir araç sunulmuyordu. Bu kapatıldı:

| Araç | İşlev |
| --- | --- |
| `list_scopes` | Erişilebilir tüm kapsamları listeler (proje kökü + yetkili ek klasörler, `@resource/<id>` adresleriyle) |
| `request_scope` | Kullanıcıdan yeni bir klasör erişimi ister: yol verilirse o klasör, verilmezse kullanıcı bir klasör seçer. **Yazma izni onay kartıyla** verilir. |

Ayrıca kullanıcının standart klasörleri **salt okunur** olarak doğrudan adreslenebilir hâle geldi:

- `@user/masaustu`, `@user/belgeler`, `@user/indirilenler`, `@user/resimler`, `@user/videolar`, `@user/muzikler`
- `read_file` bu yolları okur; `find_files` / `search_file_contents` / `file_index_refresh` bu kapsamlarda arar
- Yazma bu kapsamlarda **kapalıdır** — yazma için `request_scope` ile `read-write` yetkisi gerekir (onay kartıyla)

Sistem istemi bu yolları ve kapsam araçlarını açıkça anlatır; aksi halde model hiç denemez.

**Canlı kanıt:** ajan "Belgeler klasöründeki ultron-ajan-testi.txt dosyasını oku" isteyince `request_scope` → `list_scopes` → `find_files` → `read_file` çağrılarıyla dosyayı okuyup içeriği doğru döndürdü. İlk mutlak yol denemesi ise güvenlik koruması tarafından reddedildi ("İstenen mutlak yol seçili proje veya açıkça yetkilendirilmiş kaynak klasörlerinin dışında").

## 3. İzin sistemi (ayrı değerlendirilen kategoriler)

`PermissionCategory`'ye 6 yeni tür eklendi: `screen-capture`, `input-control`, `app-launch`, `file-read`, `file-create`, `file-edit`.

- Her eylem **kendi kategorisiyle** denetlenir; bir izin diğerlerine otomatik izin vermez.
- Kalıcı izin (scope: görev / proje / kategori) verildiğinde rutin işlemlerde onay tekrar sorulmaz.
- `input-control` (fare/klavye) **yalnızca görev veya proje kapsamında** hatırlanabilir; "tüm projeler" düzeyinde kalıcı fare/klavye izni verilemez (`permission-manager.ts`).
- Yıkıcı işlem, sistem betiği ve ağ taraması kategorileri değişmedi: kalıcı izin alamazlar.

## 4. Güvenlik ve güvenilirlik

| Önlem | Uygulama |
| --- | --- |
| Ultron'un kendi arayüzünü kilitlememe | Betik `-SelfProcessId`/`-SelfProcessNames` ile kendi penceresine fare/klavye göndermez, kendini kapatamaz, kendini başlatamaz |
| Yanlış pencereye işlem yapmama | Fare/klavye araçlarına `expect_title`; odak beklenen pencerede değilse eylem reddedilir |
| Döngü koruması | Aynı eylem 5 kez, aynı eylem türü 30 kez tekrar edilirse araç net bir mesajla durdurur |
| Durdurma mekanizması | Araç çubuğundaki düğme + görev iptali otomasyonu durdurur (`desktopControlPaused`) |
| Zaman aşımı | Her eylem ayrı, kısa ömürlü PowerShell sürecidir (60 sn üst sınır) |
| Hassas veri kaydı | Yazılan metin **kaydedilmez**; yalnız pencere/uzunluk bilgisi raporlanır |
| Yol/URL güvenliği | Karakter kümesi sınırlaması; uygulama adı PATH ve sistem klasöründe çözülür |
| Sürücü kökü / hassas dizin | Klasör hedefleri mevcut `isDriveRoot` ve `isSensitiveFilePath` kurallarına tabidir |

## 5. Doğrulama döngüsü

**Deterministik yol (önerilen):** `desktop_preflight` (ortam uygun mu) → `desktop_text_task` (yaz + kaydet, tek çağrı) → `desktop_click_element` (adı verilen öğeye tıkla) → `desktop_state` / `desktop_ui_elements` (sonucu doğrula).

**Granüler yol:** `desktop_state` → `desktop_launch_app` → `desktop_focus_window` → `desktop_type_text` / `desktop_press_keys` → `desktop_ui_elements` (metni oku) → `desktop_screenshot`. Her eylem odaklı pencereyi ve imlecin altındaki öğeyi döndürür; ajan sonucu kendisi doğrular.

Deterministik araçlar, modelin koordinat tahmini yapmadan gerçek işi tek çağrıda bitirdiği için zayıf modellerde de güvenilir sonuç verir.

## 6. Testler

- `tests/desktop-control.test.ts` — 21 birim testi (yük doğrulama, tuş eşleme, koruma kuralları, uygulama adı çözümleme, deterministik görev yükleri, betik içerik denetimi).
- `tests/tool-registry.test.ts` — 76 şema ↔ 76 yürütücü eşleşmesi, yetenek erişilebilirliği ve **masaüstü izni kapalıyken araçların gizlenmesi**.
- `tests/ui-smoke.mjs` — sağ panel daralt/genişlet akışı (dinamik sekme sayısı).
- Canlı senaryo betiği: 9 kontrol (aşağıdaki rapor).

## 7. Bilinen sınırlar

- Yalnızca Windows'ta çalışır (`process.platform !== 'win32'` → net hata).
- **Etkileşimli masaüstü oturumu şarttır.** Kilitli ekran, kopmuş RDP oturumu veya servis oturumunda fare/klavye komutları çalışmaz; `desktop_preflight` bunu tespit edip açıklar.
- JavaScript ile çizilen uygulamalarda (Electron/SVG) UI Automation öğe tespiti sınırlıdır; statik Win32 arayüzlerde tam çalışır.
- Kaydetme akışı, uygulamanın "Farklı kaydet" penceresinin **dosya adı alanının** UI Automation ile doldurulmasına dayanır; alan bulunamazsa yol körlemesine yazılır.
- Mağaza uygulamalarının (Not Defteri gibi) penceresi ayrı süreçte açıldığından doğrulama PID yerine süreç adı ve "yeni pencere" karşılaştırmasıyla yapılır.
- 8B yerel model masaüstü akışında okuma döngüsüne girebilir; çerçeve bunu sınırda durdurur ve yanlış başarı bildirmez. Deterministik araçlar bu riski azaltır.
