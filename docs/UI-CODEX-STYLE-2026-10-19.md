# Ultron — Codex Tarzı Arayüz Tasarımı

**Tarih:** 19.10.2026  
**Durum:** Tamamlandı; kaynak, Windows paketi ve kurulu uygulama güncellendi.  
**Kapsam:** `C:\Users\user\Desktop\codexx`

## 1. Sonuç

Ultron'un arayüzü, OpenAI Codex masaüstü uygulamasının **genel yerleşim ve çalışma dilinden** esinlenen açık bir temaya taşındı:

- Açık gri kenar çubuğu, beyaz ana panel ve ince ayırıcılar.
- Sade tipografi; küçük, nötr ikonlar; mor vurgu yerine siyah/beyaz hiyerarşi.
- Ana sayfada ortalanmış karşılama, dört başlangıç kartı ve geniş, yuvarlatılmış besteci.
- Sohbette düz asistan metni ve sağa yaslı, açık gri kullanıcı baloncukları.
- Görev listesi, dosya ağacı ve profil çipi aynı sol menüde.
- Profil menüsü; ayarlar, hafıza/yetkiler, proje değiştirme ve yeni görev kısayolları.
- Açık tema; ayarlar, onay/inceleme kartları, modaller ve sağ panel sekmeleri dahil.

OpenAI'nin logosu, ikon seti, marka görselleri veya birebir ekranı kullanılmadı. "Codex" adı ve markası ürüne taşınmadı; tüm metinler, ikonlar (Lucide) ve görsel varlıklar Ultron'a aittir. Amaç kopyalamak değil, aynı sakin ve düşük sürtünmeli masaüstü deneyimini özgün bir düzenle uyarlamaktır.

## 2. Uygulanan yüzeyler

| Yüzey | Yapılan |
|---|---|
| Ana sayfa | Ortalanmış karşılama, "Birlikte bir şeyler inşa edelim." başlığı, dört başlangıç kartı, geniş besteci |
| Sol menü | Ultron markası, "Yeni görev", Değişiklikler / İşlem geçmişi / Hafıza ve yetkiler / Yerel AI / Kişisel hafıza / Terminal; proje görev listesi; dosya ağacı; profil çipi |
| Üst başlık | Görev başlığı + proje adı + aşama; terminal, ayarlar ve panel düğmeleri |
| Sohbet | Düz asistan metni; sağa yaslı kullanıcı baloncukları; ince zaman/görev durumu satırları |
| Besteci | Model seçici, proje bağlamı, klasör kapsamı, gönder düğmesi ve yerel çalışma notu |
| Profil | Alt solda profil çipi; açılır menü: Ayarlar, Hafıza ve yetkiler, Proje klasörünü değiştir, Yeni görev |
| Ayarlar | Açık sağlayıcı kartları, model çipleri, bağlantı durumu, otomatik öğrenme ve kaydet çubuğu |
| Onay / inceleme | Açık kartlar, belirgin birincil eylem, yıkıcı eylemler için yumuşak kırmızı |
| Sağ panel | Değişiklikler, İşlemler, Android, Web, Windows, Yerel AI, Hafıza, Dosyalar, Yazılımlar, Eklentiler sekmelerinin tamamı açık yüzeylere geçirildi |
| Modaller | Ayarlar, çalışma alanı, dosya ve onay pencereleri aynı açık dilde |
| Terminal | Koyu konsol kimliği korundu; çevresi açık temaya uyarlandı |

## 3. Teknik uygulama

- **`src/codex-theme.css`** — Yeni, kapsamlı açık tema katmanı. En son yüklenir; eski `styles.css`, `settings.css` ve `local-ai.css` dosyaları silinmedi. Katman kaldırılırsa eski tema geri gelir; bu, geri alınabilir bir tasarım yoludur.
- **`src/App.tsx`** — Eski üst çubuk kaldırıldı; sol menü, ana araç çubuğu, besteci, profil çipi ve profil menüsü yeniden düzenlendi. Mevcut işlevler ve test sözleşmeleri korundu.
- **`src/main.tsx`** — Tema katmanı en son içe aktarılır.
- **`src/index.html`** — `theme-color` açık gri (`#f3f3f1`).
- **`electron/main.ts`** — Pencere arka planı `#f3f3f1`; yerel pencere çerçevesi korunur.
- **Yeni yardımcı:** Görev listesinde "şimdi / 44 dk / 2 sa" gibi göreli zamanlar.

Korunan test sözleşmeleri:

`.top-icon[title="Ayarlar"]`, `.right-tabs` sekme metinleri, `.settings-modal`, `#base-url`, `#model-name`, `#profile-name`, `#profile-instructions`, `.approval-card`, `.markdown-body`, `.memory-panel`, `.software-row`, `.localai-model`, `.localai-fit`, `.task-history`, `.task-status-badge`, `.proposal-card`.

Odak halkaları nötr griye çevrildi; mor odak/alt çizgi kalıntıları kaldırıldı. Profil menüsü `role="menu"`, dışarı tıklayınca kapanan şeffaf bir arka plan ve klavye odağı desteğiyle eklendi.

## 4. Final doğrulama

| Kontrol | Komut | Sonuç |
|---|---|---|
| Birim/entegrasyon testleri | `npm run test:permissions` | **278/278 geçti**, 0 başarısız |
| Tip kontrolü | `npm run typecheck` | Geçti (node + web) |
| Kaynak UI smoke | `npm run test:smoke` | Geçti |
| Paketli taşınabilir smoke | `npm run test:packaged` | Geçti |
| Windows paketi | `npm run dist` | Setup + portable üretildi |
| Sessiz kurulum | `Ultron Setup 1.1.0.exe /S` | Çıkış kodu 0 |
| Kurulu asar eşleşmesi | SHA-256 karşılaştırması | **Birebir aynı** |
| Kurulu uygulama smoke | `npm run test:installed` | İki oturum geçti: sohbet + yeniden açılışta kalıcılık |
| Görsel denetim | Kurulu uygulama, CDP ekran görüntüleri | Ana sayfa, profil menüsü, ayarlar, Yerel AI, Hafıza ve sağ panel sekmeleri açık temada doğrulandı |

Kurulu `resources/app.asar` SHA-256:

`672767FD78E9ED3122DFCEC4E6DF4353F74BEF83D2ABBF4C1A7D3F87FB88AD54`

## 5. Yayın dosyaları

`release/` içindeki son dosyalar:

| Dosya | SHA-256 |
|---|---|
| `Ultron Setup 1.1.0.exe` | `8BC5AD2B50803809738CC5FCC780AD7B9670302AC43C9DCD733450623DA7863E` |
| `Ultron 1.1.0.exe` (portable) | `B6B16C4A675FF11EEF41AB8A2F386CB5CB34E648821724B86AFA2364CBEAA2BE` |
| `win-unpacked\Ultron.exe` | `F0FE7B7B10C51868AEB546E60BB8D8F53C7331E0DE307B23676890AF819BF8FC` |

`release/SHA256SUMS.txt` bu değerlerle yeniden üretildi.

## 6. Ekran görüntüleri

- `release/installed-home-codex.png` — Kurulu uygulama, temiz profil ana sayfası.
- `release/installed-profile-codex.png` — Profil menüsü.
- `release/installed-settings-codex.png` — Ayarlar penceresi.
- `release/installed-yerel-ai-codex.png` — Kurulu uygulama, gerçek profil, Yerel AI paneli.
- `release/installed-hafiza-codex.png` — Kurulu uygulama, gerçek profil, Hafıza paneli.
- `release/installed-codex-final.png` — Kurulu uygulama, gerçek profil, sohbet çalışma alanı.
- `release/ui-smoke.png` — Final paketli UI smoke ekranı.
- `release/installed-smoke.png`, `release/installed-persist.png` — Kurulu uygulama smoke kanıtları.

## 7. Bilinen sınırlar

- Yükleyici **imzasızdır**; kod imzalama sertifikası yoktur.
- Açık tema varsayılandır; ayrı bir karanlık tema anahtarı henüz yoktur. Eski koyu CSS korunur, ancak arayüz geçişi eklenmedi.
- Bu çalışma **görsel/etkileşim katmanıdır**; ajanın izin, güvenlik veya yürütme politikasını değiştirmez. Daha önce reddedilen sınırsız/zararlı yetenek talepleri kapsam dışıdır.
- OpenCode uyarlamasının P0 izin kural motoru, adım bütçesi ve benzeri çekirdek işleri bu UI teslimine dahil değildir; ayrı kapsam beklemektedir.
- 8B yerel modelin çıktı kalitesi frontier modellerle eşit değildir; arayüz bunu vaat etmez.
