# Sağ Panel Daraltma / Genişletme

Ultron ana sayfasındaki sağ inceleme paneli artık üç durum arasında geçiş yapabilir.

## Durumlar

| Durum | Genişlik | Görünüm |
| --- | --- | --- |
| Kapalı | 0 | Panel hiç render edilmez (mevcut davranış korundu) |
| Daraltılmış | 46 px | Yalnızca dikey ikon şeridi; aktif sekme vurgulu |
| Geniş | 332 px | Tam sekme çubuğu + panel içeriği |

## Nasıl kullanılır

- **Daralt:** Geniş panelin sekme çubuğundaki `»` düğmesi.
- **Genişlet:** Daraltılmış şeridin en üstündeki `»` düğmesi.
- **Sekme değiştir (daraltılmış hâlde):** Şeritteki ikona tıklanınca panel ilgili sekmeyle açılır.
- **Aç / kapat:** Sohbet üst çubuğundaki sağ panel düğmesi sırasıyla: kapalı → açık, daraltılmış → geniş, geniş → kapalı.

## Kalıcılık

Daraltma tercihi `localStorage` içinde `ultron.rightPanelCollapsed` anahtarıyla saklanır ve uygulama yeniden açıldığında korunur.

## Davranış kuralları

- Sol kenar menüsünden bir bölüm seçildiğinde (Değişiklikler, İşlem geçmişi, Yerel AI, Hafıza) panel her zaman geniş açılır — daraltılmış şerit içeriği göstermediği için yanlışlıkla boş bir panel gösterilmez.
- Bir onay (approval) istendiğinde panel otomatik genişler; onay kartı gizli kalmaz.
- Terminal çekmecesi, panel genişliğinden gelen `--ultron-right-width` değişkenini kullanır; daraltılmış durumda çekmece de panelin yanına kadar uzanır.

## Dosyalar

- `src/App.tsx` — `rightCollapsed` durumu, `SIDE_TABS` tek kaynağı, `selectSideTab` / `sideTabBadge`, daraltma düğmesi, dikey şerit.
- `src/codex-theme.css` — aktif (açık) tema için `.right-sidebar.collapsed`, `.right-rail`, `.rail-tab`, `.right-collapse` kuralları.
- `src/styles.css` — eski koyu tema için aynı kurallar.
- `tests/ui-smoke.mjs` — daraltma, şeritten seçim, genişletme ve kalıcılık için regresyon testi.
