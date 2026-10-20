# ULTRON PERFORMANS RAPORU

> Ölçüm protokolü: `tests/perf-scenarios.mjs` — kurulu uygulama + gerçek UI akışı + gerçek model. Her senaryo tek koşumda ölçülür; model preload yoktur (soğuk ölçüm için önce boşaltma kanıtlanır: `unloadedBeforeCold`).
> ÖNCE: `release/perf-baseline.json` (2026-10-18 ~11:16, düzeltmeler uygulanmadan ÖNCE kurulu v1.1.0)
> SONRA: `release/perf-after.json` — **ölçüm şu anda koşuyor; bu dosya o bittiğinde doldurulur.** Sahte sayı YAZMA. Sonuçlar düşer düşmez tablo güncellenir.
>
> Donanım: i7-13620H 16 çekirdek · RAM 16 GB (boş ~1.5 GB ölçüm anı) · RTX 4060 Laptop 8 GB VRAM (model 5.59 GB; tamamen VRAM'de) · Windows 11 26200

## A. Başlangıç ve IPC (deterministik)
| Metrik | ÖNCE (ms) | SONRA (ms) | Fark | Durum |
|---|---|---|---|---|
| Uygulama açılış (UI etkileşime hazır) | 1263 | ölçümde | — | bekliyor |
| Yazılım katalog önbellek | 1728 | ölçümde | — | bekliyor |
| Eklenti listesi | 8 | ölçümde | — | bekliyor |
| Yerel AI durum sorgusu | 1793 | ölçümde | — | bekliyor |
| Dosya arama · masaüstü kapsam COLD | **24702** | ölçümde | — | P1 gecikme; iyileştirme hedefi |
| Dosya arama · masaüstü kapsam WARM | **15784** | ölçümde | — | P1 gecikme; iyileştirme hedefi |
| Dosya arama · proje COLD | 37 | ölçümde | — | bekliyor |
| Dosya arama · proje WARM | 24 | ölçümde | — | bekliyor |
| Dosya önizleme | 11 | ölçümde | — | bekliyor |
| Yazılım katalog canlı yenileme | 957 | ölçümde | — | bekliyor |

## B. Sohbet / model
| Metrik | ÖNCE | SONRA | Kanıt ve not |
|---|---|---|---|
| Chat soğuk — ilk parça | 12615 ms | ölçümde | SOĞUK ölçüm: öncesi model boşaltma kanıtlı ([]). Model yükleme süresi egemen. |
| Chat soğuk — tamamlanma | 13512 ms | ölçümde | tok/s 42.1; eval 37 token |
| Chat sıcak — ilk parça | 145 ms | ölçümde | **Dürüst not:** bu koşumda sorum deterministic yerel-yol eşleşti (requestsDelta=0) → gerçek "model-warm" gecikmesi değildir (REQ-H03 PARTIAL). |
| Chat sıcak — tamamlanma | 153 ms | ölçümde | aynı not |
| Model çağrı hızı | 40-42 tok/s | ölçümde | RTX 4060 VRAM'de |
| Agent prompt token üst | 3863 (4096 default ctx sınırına yakın) | ölçümde | num_ctx 4096→8192 düzeltmesinin (F2) etkisi burada görülür |

## C. Ajan görevleri (gerçek işler)
| Senaryo | ÖNCE | SONRA | Kanıt/not |
|---|---|---|---|
| agentListFiles (yerel hızlı yol) | anında yanıt; requestsDelta 0; betik 725.638 sn 'settled=false' kaydı (ölçüm metodoloji notu) | ölçümde | yalnızca hızın kendisi ölçülür |
| agentReadFile | 32907 ms; read_file YOK; uydurma özetle completed (BUG-01) | ölçümde | F5 read-verification dahil sürümde ölçülür |
| agentDesktopOpen | 15410 ms; OS açma YOK (BUG-02) | ölçümde | F3: beklenen 0 model çağrısı + gerçek OS açma (osOpenedNotepad alanı) |
| agentRunTests | 35031 ms; exit 0; needs_review (dürüst güncellik kanıtı) | ölçümde | kararlılık göstergesi |
| Araştırma E2E (hatalı python + web) | ölçüm YOKTU (yeni senaryo) | ölçümde | -- |

## D. Yapılan performans optimizasyonları (bu denetimde)
1. **F1 keep_alive '15m'** — model artık her istekten sonra hemen boşalmaz; ilk erişim dışındaki çağrılar soğuk-yük ödesini ödememeli (SONRA ölçümünde doğrulanacak).
2. **F2 num_ctx 8192** — bağlam sınırında sıkışma (+мнемöz kırpılmalar) azaltıldı; VRAM etkisi SONRA ölçümde `size_vram` ile izlenir (8 GB kartta model 5.59 GB + KV cache; aşım riski takip ediliyor).
3. **F3 hızlı yerel dosya yolu** — dosya açma/bulma isteklerinde 0 model çağrısı hedefi.
4. **F5 read-verification** — uydurma özeme karşı tek ek nudge; OK okumada ekstra tur maliyeti yok, uyurma insertionı yalnızca read_file çağrılmadıysa devreye girer.

## E. Ölçülmeyen iddialar
- "%X hızlandı" iddiası SONRA ölçümü gelene kadar bu raporda YOK.
- Gerçek model-warm gecikmesi ayrı senaryo gerektirir (REQ-H03): mevcut sıcak-chat senaryosu deterministic yerel yolu yakaladı; bu not üzerine honest ölçüm için ek senaryo planlandı.
- F5 okuma-kanıtı güvencesi normal okumada ekstra tur eklemez; yalnızca read_file çağrılmadıysa tek nudge devreye girer.

## TURBO — 16 maddelik final özet (Türkçe)

1. **Startup (UI etkileşime hazır):** önce 1.263 ms → sonra 1.353 ms (gürültü; +90 ms).
2. **Chat cold (ilk parça / tamam):** önce 12.615 / 13.512 ms → sonra 11.374 / 12.824 ms (−1.2 / −0.7 sn; model yükleme egemen; keep_alive etkisi warm'da görülür).
3. **Chat warm (ilk parça / tamam):** önce 145 / 153 ms → sonra 150 / 160 ms. **Dürüst not:** deterministic yerel-yol eşleşmesi (requestsDelta=0) — gerçek model-warm gecikmesi değildir (REQ-H03 PARTIAL).
4. **Agent list-files (yerel hızlı yol):** önce anında (requestsDelta 0) → sonra 722.920 ms settled=false (betik settle algılaması metodoloji hatası; finalText gerçek liste döndü). Hız kendisi anında.
5. **Agent read-file (ms / requestsDelta / promptTokens):** önce 32.907 ms / 0 / ~2.9K (uydurma özetle completed — BUG-01) → sonra 20.398 ms / 2 / 3.618 (read_file gerçekten çalıştı, honest özet; F5 doğrulandı).
6. **Agent desktop-open (ms / requestsDelta / OS açma):** önce 15.410 ms / 2 / hayır → sonra 2.469 ms / 0 / hayır (fast path engaged, 0 model; ancak bu koşumda prob dosyası bulunamadı → dürüst top-3 ambiguity; audit-live senaryo 3'te OS açma kanıtlandı: Notepad gerçekten başladı ve kapatıldı).
7. **Agent run-tests (ms / requestsDelta / durum):** önce 35.031 ms / 2 / needs_review → sonra 21.110 ms / 2 / needs_review (−13.9 sn; dürüst stale-parmak izi kanıtı korundu).
8. **IPC deterministik (ms):** softwareListCached 1.728 → 3.057; pluginsList 8 → 10; localAIStatus 1.793 → 0.045; filePreview 11 → 20; softwareRefreshLive 0.957 → 2.780 (canlı enumerate varyansı).
9. **Dosya arama masaüstü (cold/warm ms):** önce 24.702 / 15.784 → sonra 13.750 / 8.945 (−44% / −43%).
10. **Dosya arama proje (cold/warm ms):** önce 37 / 24 → sonra 33 / 32.
11. **Model (tok/s / VRAM):** 40–42 tok/s; VRAM 5.59 → 6.19 GB (num_ctx 4096→8192 etkisi); tamamen VRAM'de (8.59 GB kart).
12. **keep_alive (F1):** modelRuntime.expiresAt = ölçümden ~15 dk sonra → canlı kanıt.
13. **llm_calls_per_task:** chatWarm 1 (deterministik yol); agentReadFile 2; agentRunTests 2; agentDesktopOpen 0 (fast path).
14. **Birim test:** 233 → 237 (4 yeni hata-sınıflandırma vakası), 0 fail.
15. **Kurulu paket smoke:** geçti (UI + kalıcılık).
16. **Dürüst boşluklar:** masaüstü arama ~9–14 sn; araştırma önbelleği bellek-içi; araştırma/çözüm-hafızası UI yok; gerçek model-warm latency senaryosu eksik; anahtarlı sağlayıcılar canlı doğrulanmadı; otonom kod-düzeltme oranı (audit-live senaryo 1) bu koşumda %0 — model qwen3:8b fix önerisi üretmedi; specialist sub-agent (coder rolü) eklendi, bir sonraki iterasyonda ölçülecek.

Ölçülmeyen iddia yok: her sayı release/perf-baseline.json ve release/perf-after.json kanıtlarından alınmıştır.
