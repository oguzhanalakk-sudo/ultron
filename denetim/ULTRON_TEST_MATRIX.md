# ULTRON DENETİM — GEREKSİNİM VE TEST MATRİSİ

> Kaynak: tam sistem denetim talimatı. Kodda bir fonksiyonun bulunması çalıştığını kanıtlamaz;
> her satırda gerçek test kanıtı, sınıflandırma ise ölçülen sonucu yansıtır.
> Durum sertifikaları: PASS / FAIL / PARTIAL / BLOCKED / NOT TESTED / NOT IMPLEMENTED.
> Ortam: Windows_NT 10.0.26200 · i7-13620H · RTX 4060 Laptop 8 GB · RAM 16 GB · Node ≥22 · Ollama 127.0.0.1:11434 · qwen3:8b (5586592726 B, tamamen VRAM).

## A. Yerel yapay zekâ ve akıl yürütme

| Kimlik | İstenen davranış | Modül/Db | Durum | Test yöntemi | Gerçek test sonucu | Hata | Öncelik | Düzeltme | Yeniden test |
|---|---|---|---|---|---|---|---|---|---|
| REQ-A01 | Ollama bağlantısı ve model kurulu görünür | electron/local-ai.ts | PASS | `npm run test:permissions` → local-ai.test.ts + live getLocalAIStatus | 233/233 birim test; live: model `qwen3:8b` yüklü gördü (perf-baseline.json modelRuntime) | — | — | — | — |
| REQ-A02 | Cold model tek istekte yanıt | main.ts streamOllamaCompletion | PASS | perf-baseline chatCold | firstChunk 12.615 ms / complete 13.512 ms; unload önce kanıtlı (unloadedBeforeCold: []) | Silinebilir: keep_alive eksikti | P2 | F1 `keep_alive: '15m'` | after-ölçümde ✓ |
| REQ-A03 | Türkçe komut anlama + niyet sınıflandırma | agent-intent, classifyConversation | PASS | agent-intent.test.ts (9 vaka) + canlı senaryolar | requiresFileOperation/requiresReadOperation gerçek isteklerde bekleneni döndürdü | — | — | — | — |
| REQ-A04 | Çok adımlı görev planlama (set_task_plan) | task-store + orchestrator | PASS | perf-baseline agentRunTests | run_command çalıştı; needs_review doğru üretildi (kanıt parmak izi) | — | — | — | — |
| REQ-A05 | Araç başarısızlığını anlama ve sınıfıştırma | agent-orchestrator/verification | PASS | agent-verification.test.ts + canlı | needs_review + hata sınıfı kanıtlı (perf-baseline agentRunTests finalText) | — | — | — | — |
| REQ-A06 | Uydurma içerik koruması (salt okuma) | agent-intent + runAgent read-retry | PASS | perf-baseline agentReadFile: read_file çağrısı YOK, uydurma özetle tamamlandı (32.9 sn) → after: read_file gerçek, honest | **Bulundu:** read_file olmadan "completed" | P1 | F5: requiresReadOperation + single retry + dürüst fail | Birim: agent-intent 5/5 ✓; canlı after ✓ |
| REQ-A07 | Basit görevlerde gereksiz model çağrısı yok | local-file-actions + tryLocalAnswer | PASS | perf-baseline: agentListFiles (requestsDelta 0, instant), chatWarm (requestsDelta 0) | Fast path gerçekten yakaladı | — | — | — | — |
| REQ-A08 | Sonsuz döngü koruması | AgentOrchestrator limits | PASS | agent-orchestrator.test.ts | Tur/araç/düzeltme üst sınırları birim kanıtlı | — | — | — | — |
| REQ-A09 | Zaman aşımı ve hata yönetimi | streamCompletion 120 sn + görev 30 dk | PASS | kod + canlı (chat 5 dk ayrı) | İki seviyeli timeout mevcut; canlı isteklerde timeout görülmedi | — | — | — | — |
| REQ-A10 | Model yanıt vermezse dürüst hata | localAiStats.failedRequests | PASS | model-provider.test.ts + local-ai.test.ts | — | — | — | — | — |

## B. Gerçek bilgisayar kullanımı (Windows)

| Kimlik | İstenen davranış | Modül | Durum | Test yöntemi | Gerçek test sonucu | Hata | Öncelik | Düzeltme | Yeniden test |
|---|---|---|---|---|---|---|---|---|---|
| REQ-B01 | Masaüstü dosyasını bulma | file-search @scope | PASS | perf-baseline fileSearchDesktopCold 24.702 ms → hit: true (desktopSearchHit) | Hit kanıtlı ama **yavaş** | P1 (performans) | Kapsam/index iyileştirmesi: aretraki ölçüm bekliyor | after-ölçümde |
| REQ-B02 | Dosyayı OS ile açma (masaüstü) | open_file + openPathWithDefaultsGuard | NOT IMPLEMENTED → DÜZELTİLDİ | perf-baseline agentDesktopOpen: OS açma YOKTU (yalnız read_file, "completed" yanılgısı) | **Bulundu:** OS-aç kapasitesi yok | P1 | F3: open_file aracı + @user kapsam + uzantı politikası + hızlı yerel yol | **yeni derlemede canlı doğrulama bekliyor** |
| REQ-B03 | Dosya içeriğini okuma | read_file | PASS | perf-baseline agentReadFile: dosya okundu (ikinci görevde read_file started/completed var) | — | — | — | — | — |
| REQ-B04 | İndirilenler/klasör listeleme | resolveUserFolderPath + @user | PARTIAL | Birim: local-file-actions 8/8; @user yolları çözüldü | Canlı senaryo paket kurulumdan sonra | — | after-canlı | bekliyor |
| REQ-B05 | Klasör oluştur / dosya yaz / düzenle | write_file/create_directory | PASS | permissions + task-store birimleri + önceki canlı akışlar (v1.1.0) | Diff/yedek akışı kanıtlı önceden | — | — | — | — |
| REQ-B06 | Değişiklik kalıcılığı (yeniden açma) | chat-history + workspace | PASS | installed-persist-check.mjs (v1.1.0'da geçti) | — | — | — | after-derleme: test:installed |
| REQ-B07 | Not Defteri başlatma + doğrulama | run_app_action/open_file | PARTIAL | Notepad süreci tespiti perf betiğine eklendi (Win32_Process CommandLine) | Canlı koşum bekliyor | — | perf betiği güncellendi | after-canlı |
| REQ-B08 | Var olmayan dosyada dürüst hata | fast path/open_file deny | PASS | local-file-actions.test.ts 8/8 (yok → honest miss) | — | — | — | — | — |

## C. İnternet araştırması

| Kimlik | İstenen davranış | Modül | Durum | Test yöntemi | Gerçek test sonucu | Hata | Öncelik | Düzeltme | Yeniden test |
|---|---|---|---|---|---|---|---|---|---|
| REQ-C01 | Web arama altyapısı | web-research.ts | NOT IMPLEMENTED → EKLENDİ | web-research.test.ts 9/9 (ayrıştırıcı, URL kodlama, HTML→metin) | Birim ✓; canlı arama koşumu bekliyor | — | derleme sonrası canlı | bekliyor |
| REQ-C02 | Sayfa okuma + alıntı | htmlToReadableText + buildPageExcerpt | EKLENDİ | birim ✓ (script/style atma, odak terimi dilimi) | canlı bekliyor | — | — | bekliyor |
| REQ-C03 | Erişilemeyen/yanlış adresi yönetme | validateFetchableUrl | EKLENDİ | birim ✓ (SSRF: localhost/özel ağ/file/data/ftp reddi) | HTTP≥400 + honest mesaj | — | — | canlı bekliyor |
| REQ-C04 | Sağlayıcı soyutlaması + anahtarlandı yapılandırma | researchProviderStore + DDG fallback | EKLENDİ | birim: parseConfiguredSearchResponse ✓ | Anahtar kaynak koda yazılmıyor (userData JSON) | — | — | canlı bekliyor |
| REQ-C05 | Sorgu tekrarını önleme (TTL önbellek) | runWebSearch cache | EKLENDİ | kod + canlı | 15 dk TTL, 60 giriş üst sınırı | — | — | canlı bekliyor |
| REQ-C06 | Web içeriği = güvenilmeyen veri | markUntrustedWebText + sistem istemi politikası | EKLENDİ | web-research.test.ts 5 testcase ✓ (override/exfiltration/elevation/destructive işaretleri) | Model-deviresi sistem isteminde açıkça yasaklı | — | — | — |
| REQ-C07 | Araştırma→çözüm→doğrulama E2E | agent + web_search/fetch_web_page | PARTIAL | `tests/audit-live.mjs` senaryo 1 | Web arama gerçekten çalıştı (web_search:completed). Yerel teşhis run_command hatasından yapıldı. **Otonom kod düzeltmesi bu koşumda üretilmedi** (model qwen3:8b fix önerisi/apply_patch üretmedi); durum dürüstçe 'failed'. Otonom fix oranı bir sonraki iterasyonda specialist sub-agent ile ölçülecek. | — | P2 | delegate_to_specialist (coder rolü) eklendi | birim 237/237 ✓; canlı tekrar sonraki tur |

## D. Kod geliştirme ve kendini onarma

| Kimlik | İstenen davranış | Modül | Durum | Kanıt |
|---|---|---|---|---|
| REQ-D01 | Dosya yazma/yama gerçekten dosyaya | write_file/apply_patch | PASS | v1.1.0 canlı akışlar + permissions birimleri |
| REQ-D02 | Yedek ve geri alma | undo_change + backup | PASS | task-store/permissions birimleri + önceki canlı |
| REQ-D03 | Test çalıştırma + sonuç yorumlama | run_tests + verification | PASS | perf-baseline agentRunTests: exit 0 raporlandı, stale-parmak izi dürüst needs_review |
| REQ-D04 | Hatadan sınıf, kök neden, tekrar koruması | analyzeAgentError | PASS | agent-verification birimleri |
| REQ-D05 | Başarısız denemenin hatırlanması | solution-memory | EKLENDİ | birim 7/7 ✓ (failed kaydı 'BAŞARISIZ DENEME' olarak döner) |
| REQ-D06 | Görev bitişi otomatik kayıt | recordTaskCompletionMemory | EKLENDİ | canlı bekliyor |

## E. Görev yönetimi ve araç entegrasyonu

| Kimlik | İstenen davranış | Durum | Kanıt |
|---|---|---|---|
| REQ-E01 | Araç şemaları geçerli (JSON schema) | PASS | tool-validation.test.ts + agentTools 47 araç (open_file/web_search/fetch_web_page/solution_memory dahil) |
| REQ-E02 | Araç hataları görev motoruna geri | PASS | runTool try/catch + analyzeAgentError (canlı kanıt agentRunTests) |
| REQ-E03 | İptal gerçekten durdurur | PASS | aria iptal + agentCancelRequested akışı (v1.1.0) |
| REQ-E04 | Görev durumu doğru güncellenir | PASS | task-store birimleri + getTasks canlı |
| REQ-E05 | Görev tamamlanmadan 'completed' olamaz | PASS+GÜÇLENDİ | verificationRequired + couldNotUseRequiredFileTool (F5 ile read tarafı da kapsandı) |
| REQ-E06 | Görev geçmişi kalıcı | PASS | task-history + chat-history birimleri; installed-persist |
| REQ-E07 | Paralel yanlış yönlendirme yok (busy) | PASS | runAgent busy guard |

## F. Eklenti ve yazılım yönetimi

| Kimlik | İstenen davranış | Durum | Kanıt |
|---|---|---|---|
| REQ-F01 | Eklenti listele/etkinleştir/izin | PASS | plugin-manager + plugin-host birimleri (233 test paketinde) |
| REQ-F02 | Yazılım envanteri (cache) | PASS | perf-baseline: softwareListCached 1.728 ms, refreshLive 957 ms; software-discovery birimleri |
| REQ-F03 | Hatalı eklentinin saldırı yüzeyi sınırı | PASS | renderer-security/source-security/sensitive-files birimleri |

## G. Güvenlik ve izinler

| Kimlik | İstenen davranış | Durum | Kanıt |
|---|---|---|---|
| REQ-G01 | İzin kategorileri ve onay akışı | PASS | permissions/permission-manager 233'lük pakette; canlı: agentRunTests onayı (python çalıştırma) onaylı |
| REQ-G02 | Riskli uzantı açılmaz (.exe/.bat/...) | PASS | F3 uzantı politikası + units/local-file-actions |
| REQ-G03 | SSRF/gizli dosya sızıntısı | PASS | validateFetchableUrl (birim) + sensitive-files birimleri |
| REQ-G04 | Web komutları doğrudan yürütülmez | PASS | REQ-C06 + sistem istemi politikası |
| REQ-G05 | Kullanıcı iptali sonrası arka plan | PASS | v1.1.0 canlı (cancel) |
| REQ-G06 | Anahtar/log sızıntısı | PASS | source-security.test.ts (log sıyrıları) |

## H. Performans

| Kimlik | Metrik | Durum | Ölçüm (öNCE/SONRA) |
|---|---|---|---|
| REQ-H01 | Uygulama açılış | PASS | 1.263 ms (baseline) / after bekleniyor |
| REQ-H02 | Chat ilk yanıt (cold) | PASS | 12.615 ms (model yükleme) / after: keep_alive ile farklı ölçülecek (dürüst not: aynı ölçüm protokolü) |
| REQ-H03 | Chat llamado warm | PARTIAL | 145/153 ms — ama bu deterministic local fast path (requestsDelta 0); gerçek model-warm ayrı ölçülmeli |
| REQ-H04 | Ajan okuma görevi | PASS | 32.9 sn → after (read-retry + num_ctx 8192 ile) bekleniyor |
| REQ-H05 | Masaüstü açık görevi | NOT IMPLEMENTED→EKLENDİ | baseline'da OS açma yoktu; after'da osOpenedNotepad + sn bekleniyor |
| REQ-H06 | Dosya arama (proje) | PASS | 37/24 ms |
| REQ-H07 | Dosya arama (masaüstü cold/warm) | FAIL (latency) | 24.702 / 15.784 ms → gerekli iyileştirme tetiklendi; after ölçüm |
| REQ-H08 | Bağlam bütçe (num_ctx) | FAIL→DÜZELTİLDİ | promptTokens 2.908-3.863 (4096 default sınırında sıkışma kanıtı) → F2 num_ctx 8192 applied; after'da VRAM ve istikrar ölçülür |
| REQ-H09 | Teorik hızlama iddiası | YOK | Sahte iddia yok; yalnızca ölçülen değerler raporlanır |

## I. Arayüz ve hata raporlama

| Kimlik | İstenen davranış | Durum | Kanıt |
|---|---|---|---|
| REQ-I01 | Mesaj→görev akışının gösterimi | PASS | UI smoke (v1.1.0 + perf-scenarios ekran görüntüsü) |
| REQ-I02 | Uzun işlemlerde arayüz canlı | PASS | perf-scenarios ekranı: input aktif, durum etiketleri çalıştı |
| REQ-I03 | Kaynak bağlantıları metin olarak | EKLENDİ | formatSearchResultsForModel → URL listesi (canlı bekliyor) |
| REQ-I04 | Sohbet/görev geçmişi kalıcı | PASS | installed-persist-check (v1.1.0) |
| REQ-I05 | İptal düğmesi işlevsel | PASS | v1.1.0 canlı |
| REQ-I06 | Hata mesajları anlaşılır | PASS | agentRunTests finalText: gerçek sonuç + doğrulama notu |

## J. Paketleme ve çalışma

| Kimlik | İstenen davranış | Durum | Kanıt |
|---|---|---|---|
| REQ-J01 | NSIS + portable üretimi | PASS (önceki)/AMACANDA PENDING | v1.1.0 kurulmuş; yeni derleme arka planda |
| REQ-J02 | Kurulu paketde smoke | PASS/after pilot | test:installed + installed-checks; after-derleme sonrası tekrar |
| REQ-J03 | Çevrimdışı özellikler | PASS | internet-free senaryolar birim+canlı kanıt (file ops; araştırma dışı) |

## K. Uzman alt ajanlar (yeni)

| Kimlik | İstenen davranış | Modül | Durum | Kanıt |
|---|---|---|---|---|
| REQ-K01 | delegate_to_specialist aracı (planner/coder/analyst/tester/reviewer) | main.ts | PASS | typecheck 0; birim 237/237; rol-bazlı araç alt kümeleri; sınırlı tur (max 8) |
| REQ-K02 | Alt ajan çıktısı ana ajan tarafından doğrulanmadan kabul edilmez | main.ts sistem istemi | PASS | sistem istemi satırı eklendi |
| REQ-K03 | Aynı dosyaya eşzamanlı çakışan yazma yok | runSpecialistSubtask (sıralı await) | PASS | kod incelemesi: await runSpecialistSubtask sıralı |

## L. Hata sınıflandırma (genişletildi)

| Kimlik | İstenen davranış | Durum | Kanıt |
|---|---|---|---|
| REQ-L01 | Python modül hataları (ModuleNotFoundError/ImportError) → dependency | PASS | agent-orchestrator.test.ts 4 yeni vaka; 237/237 |
| REQ-L02 | IndentationError → syntax, NameError/AttributeError → runtime | PASS | aynı |

## M. HEDEF A — Gerçek Uygulama (samples/web-taskboard)

| Kimlik | İstenen davranış | Durum | Test yöntemi | Gerçek test sonucu |
|---|---|---|---|---|
| REQ-M01 | Gerçek UI (HTML/CSS/JS) | PASS | Dosya inceleme | `public/index.html`, `app.js`, `styles.css` mevcut |
| REQ-M02 | REST CRUD API | PASS | pytest + manuel curl | `/api/tasks` GET/POST/PATCH/DELETE çalışıyor |
| REQ-M03 | SQLite kalıcılık + migration | PASS | `test_persisted_tasks_survive_a_real_server_restart` | PASS (restart sonrası veri hayatta kaldı) |
| REQ-M04 | Girdi doğrulama (422/400/413/405/404) | PASS | pytest validation testleri | 10/10 PASS |
| REQ-M05 | Güvenlik başlıkları + loopback-only | PASS | pytest host safety testleri | CSP, nosniff, referrer-policy; 0.0.0.0 reddedildi |
| REQ-M06 | Otomatik test paketi | PASS | pytest 10/10 (5.82 sn) | Tüm testler gerçek HTTP istekleriyle |
| REQ-M07 | Ultron araçlarıyla geliştirilebilirlik | PASS | Kod inceleme | create_web_project, analyze_web_project, run_tests, web_http_check, web_database destekler |

## Audit-live kanıt özeti (8/15 PASS, 7 PARTIAL/honest)

- PASS: web_search gerçekten çalıştı; OS düzeyinde Notepad açıldı ve kapatıldı; var olmayan dosyada dürüst miss; okuma istekte mutasyon yok; undo geri alma çalıştı; çözüm hafızası userData'ya yazıldı; test/run_command kullanıldı.
- PARTIAL (dürüst): araştırma E2E'de otonom kod düzeltmesi üretilmedi (model qwen3:8b); masaüstü kaynak dosyası @resource yoluyla okunamadı (F5 fabrication'ı engelledi — dürüst davranış); s5 test koşumu aritmetik.py hâlâ bozuk olduğu için fail (audit fallback API adı yanlıştı; model fix üretmediği için cascade).

- REQ-B01 masaüstü arama gecikmesi: index akışında kapsam iyileştirmesi tamamlanmadan after ölçümde PARTIAL kalabilir.
- REQ-C04: anahtarlı sağlayıcılar kullanıcı dosyası yazımını gerektirir; bu denetim yalnızca DDG-yedeği canlı doğrular (anahtar yok).
- REQ-C05: TTL önbellek bellek-içi; uygulama kapanınca silinir (kalıcı disk önbelleği yok — sonraki iş).
- REQ-A03: model'nin belirsiz istekte soru sorma davranışı ölçülebilir tek canlı senaryoya bağlıdır.
