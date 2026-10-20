# ULTRON — ARAÇ SİSTEMİ DENETİMİ VE DÜZELTME RAPORU

Tarih: 19.10.2026 · Sürüm: 1.1.0 · Kapsam: `electron/main.ts` (araç şemaları + `runTool` yürütücüleri), `electron/tool-registry.ts`, `electron/tool-validation.ts`, `electron/project-scaffold.ts`

## 1. Bulgular (denetim sonucu)

| # | Bulgu | Durum | Kanıt |
| --- | --- | --- | --- |
| 1 | `runTool` yürütücüleri ile `agentTools` şemaları karşılaştırıldı | 73 şema ↔ 73 yürütücü, **fark yok** | `tests/tool-registry.test.ts` (test 1) |
| 2 | Şeması olup yürütücüsü olmayan / yürütücüsü olup şeması olmayan araç | `project_scaffold` ve `list_project_templates` daha önce **erişilemez** durumdaydı; bu oturumda şemaları eklendi ve doğrulandı | canlı koşu: `list_project_templates` + `project_scaffold` gerçekten çağrıldı |
| 3 | `project_scaffold` boş dosya üretiyordu | **Düzeltildi** — 15 boş dosya + `success:true` yerine içerikli minimal iskelet + uyarı | `evidence/scaffold-live.json`, `tests/project-scaffold.test.ts` |
| 4 | `project_scaffold` / `create_directory` "gerçek dosya değişikliği" sayılmıyordu → görev haksız yere `failed` | **Düzeltildi** | canlı koşu: `failed` → `needs_review` |
| 5 | `toolsForRequest` anahtar kelime zincirine bağlıydı | Merkezi yetenek kaydına (`tool-registry.ts`) taşındı; 1.1.0 ile karşılaştırıldı | `evidence/old-toolsForRequest-1.1.0.js` + karşılaştırma çıktısı |
| 6 | `analyze_logs` yalnız "log analizi" gibi dar ifadelerle açılıyordu | **Düzeltildi** (yalnızca ekleme) | `tests/tool-registry.test.ts` (test 7) |
| 7 | Argüman doğrulama ve hata yönetimi | **Korundu** — `validateToolArguments` hem `runTool` başında hem çağrı yerinde çalışıyor | `electron/tool-validation.ts`, `tests/tool-validation.test.ts` |
| 8 | Kullanılmayan/erişilemeyen araçlar | 36 araç her zaman görünür, 37 araç yeteneğe bağlı; **hiçbiri erişilemez değil** | `tests/tool-registry.test.ts` (test 7) |

## 2. Değiştirilen dosyalar

| Dosya | Değişiklik |
| --- | --- |
| `electron/project-scaffold.ts` | `renderTemplate` eksik şablon dosyasında sessizce boş içerik döndürmek yerine hata fırlatıyor; `templateFilesAvailable`/`missingTemplateFiles` eklendi; eksik şablonda minimal iskelet + `warnings`; `listTemplates()` her şablon için `available` döndürüyor; sonuca `templateName` eklendi; yapı dosyasındaki eksik şablon referansı atlanıyor. |
| `electron/main.ts` | `project_scaffold` ve `list_project_templates` şema açıklamaları gerçek davranışı anlatıyor; `list_project_templates` çıktısına `availableCount`/`note`; `project_scaffold` çıktısı `warnings` ve `templateName` içeriyor; `project_scaffold` ve `create_directory` "gerçek dosya değişikliği" listesine, `project_scaffold` `mutationTools` listesine eklendi. |
| `electron/tool-registry.ts` | `toolsByCapability` dışa aktarıldı (test edilebilirlik); `logs` yeteneğine doğal ifadeler eklendi. |
| `tests/tool-registry.test.ts` | 5 yeni test: yinelenen ad yokluğu, yardımcı kayıtların şema doğrulaması, şema biçim doğrulaması, yetenek kapsamı tutarlılığı, erişilebilirlik, dosya oluşturan araç sayımı. |
| `tests/project-scaffold.test.ts` | 3 yeni test: boş dosya oluşmaması + uyarı, şablon kullanılabilirlik bildirimi, eksik şablona bağlı dosyanın atlanması. |

## 3. Çalıştırılan testler ve sonuçları

| Test | Sonuç |
| --- | --- |
| `npm run test:permissions` (birim paketi) | **295/295 geçti**, 0 başarısız (denetim öncesi 286) |
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0** |
| `npm run test:smoke` (UI) | **geçti** (exit 0) |
| `tests/tool-registry.test.ts` | 8/8 |
| `tests/project-scaffold.test.ts` | 5/5 |
| `tests/tool-validation.test.ts` | 4/4 |
| Mutasyon testi (4 yapay bozulma) | 4/4 bozulma **yakalandı** |
| Canlı uygulama: `project_scaffold` + `list_project_templates` | araçlar çağrıldı, boş dosya yok, görev `needs_review` |

## 4. Davranış karşılaştırması (kurulu 1.1.0 ↔ yeni)

25 temsilî istek kurulu 1.1.0 paketinin gerçek `toolsForRequest` koduyla karşılaştırıldı:

- **71 aracın görünürlüğü birebir korunmuş** (hiçbir araç görünmez olmadı).
- Fark 1: `project_scaffold` ve `list_project_templates` artık "şablon/iskelet" niyeti ararken görünür (kaynak sürümde şemaları hiç yoktu, yani erişilemezlerdi).
- Fark 2: `analyze_logs` artık "log dosyasını incele" gibi doğal ifadelerde de açılır (yalnızca ekleme yapıldı).

## 5. Yapılmayanlar

- Hiçbir araç silinmedi.
- Yeni bağımlılık eklenmedi.
- Güvenlik kontrolleri (yol kaçışı engeli, onay akışı, hassas dosya kuralları) değiştirilmedi.
- Google araştırması / geniş kapsamlı dosya erişimi özellikleri uygulanmadı.
- `templates/projects` şablon dosyaları üretilmedi; bunun yerine araç eksik şablonu dürüstçe bildirip minimal iskelet üretiyor.
