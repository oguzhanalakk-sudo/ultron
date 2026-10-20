# ULTRON — BULUNAN HATALAR VE UYGULANAN DÜZELTMELER

> Kanıt temelli: her hata için gerçek gözlem (ölçüm/log), kök neden, değişen dosyalar, düzeltme ve doğrulama durumu.
> "Doğrulandı" yalnızca ilgili test çalıştırılmışsa yazılır.

## BUG-01 (P1) — Salt-okuma görevinde uydurma içerik "completed" olarak işaretlendi
- Gözlem: `release/perf-baseline.json` → agentReadFile: 32.907 ms, settled, taskStatus=completed, toolEvents=[] (read_file çağrısı hiç çalışmadı), finalText uydurma içerik ("Kod kalitesi...") içeriyordu; gerçek not.txt içerik "ULTRON performans ölçüm kum havuzu..." idi.
- Kök neden: yalnızca kod-DEĞİŞİKLİK isteği için zorunlu araç tekrarı (requiresFileOperation) vardı; okuma/özet istekleri için read_file kanıtı zorunlu değildi; model bir_cevapta uydurdu.
- Değişen: `electron/agent-intent.ts` (requiresReadOperation + olumsuzluk filtresi), `electron/main.ts` (runAgent: requiredReadRetry/readFileToolUsed + ZORUNLU system nudge + couldNotUseRequiredFileTool genişletildi + read_file başarı işareti).
- Birim doğrulama: agent-intent.test.ts — 5/5 PASS (okuma istekleri işaretlendi; okul/içerik-yok vaziyetlerde false; olumsuzluklar false).
- Canlı doğrulama: yeni kurulumda pigyback senaryo (after ölçüm) bekliyor.

## BUG-02 (P1) — "Masaüstündeki dosyayı aç" OS düzeyinde hiç açmıyordu (kapasite yok)
- Gözlem: perf-baseline agentDesktopOpen: 15.410 ms, "completed", ama yalnız read_file + özet; OS açma yok (araç yoktu).
- Kök neden: OS-aç özellik güvenlik nedeniyle önceki sürümlerde yer almıyordu (yalnızca metin işlemleri).
- Değişen: `electron/local-file-actions.ts` (yeni saf modül: detectLocalFileFastPath, uzantı politikası), `electron/main.ts` (open_file aracı + @user kapsam çözümü + openPathWithDefaultsGuard + runAgent hızlı yerel yol; deliverLocalAnswer), `tests/local-file-actions.test.ts` (8/8 PASS).
- Kayıt: `.exe/.bat/.cmd/.ps1/.msi/.lnk/.js/.iso` vb. açıkça DENY; belge/medya/arşiv ALLOW.
- Canlı doğrulama: after ölçümde `osOpenedNotepad` alanı (Win32_Process CommandLine tespiti) bekliyor.

## BUG-03 (P1) — Masaüstü kapsamında dosya arama 24.7 sn (warm 15.8 sn)
- Gözlem: perf-baseline fileSearchDesktopCold/Warm 24.702 / 15.784 ms (kum havuzunda tek amaçlı klasörde bile).
- Kök neden: `runFileSearchFlow` her aramada tam özyinelemeli tarama yapıyor (indeks altyapısı var ama akış kullanmadı).
- Eylem: kapsam daraltma + indeks yolu entegrasyonu planı; after ölçümde sayısal kanıt alınacak. (Bu maddede düzeltme CANLI ölçümle kapanmadan PASS yazılmaz.)

## BUG-04 (P2) — Model bağlamı starvation (num_ctx default 4096)
- Gözlem: agent görevleri promptTokens 2.908-3.863 ( sınır üzerinde sıkışma; kısaltılmış bağlam riski).
- Değişen: `electron/main.ts` streamOllamaCompletion options.num_ctx=8192 + keep_alive '15m' (BUG-05 ile birleşik).
- Doğrulama: typecheck 0 error; ölçümde astarlı warm turn davranışı + Ollama /api/ps size_vram izleme (after).

## BUG-05 (P2) — Model her istekten sonra HIGH belleğe geri yüklendi/boşaliliyor (keep_alive eksik)
- Gözlem: chatCold firstChunk 12.6 s (model yüklemesi dahil); keep_alive unset = default kısa.ORIGINIAL cold her yeni istekte tekrar.
- Değişen: keep_alive: '15m'.
- Doğrulama: after ölçümde ikinci model çağrısı için keep_alive izleme (loadedModels.expiresAt).

## BUG-06 (P2) — Windows akışı istem belirsizliği (görel路径 + gereksiz onay sorusu)
- Gözlem: `release/agent-flow-demo.json` — model analyze_windows_project'e MUTLAK yolda düştü; create_windows_desktop_project'te onay sorarak durdu.
- Değişen: F4 sistem istemi netleştirmesi (görel yol kuralı; proje başlatıcının ek onay gerektirmediği; onay sorup beklememe).
- Doğrulama: sonraki canlı senaryoda.

## BUG-07 (P2) — İnternet araştırma altyapısı hiç yoktu
- Gözlem: grep\System (duckduckgo/web_search/fetch_...) — yoktur; yalnız localhost web_http_check vardı.
- Değişen: web-research.ts + main.ts glue + 3 araç + sistem istemi politikası.
- Birim: web-research.test.ts 9/9 PASS.
- Canlı: audit-live betiği bekliyor.

## BUG-08 (P3) — Tanılama yetersizlikleri/perf betik sabitleri
- perf-betik çıktı adları sabitti (baseline ezilir) → env-parametrik yapıldı; agentDesktopOpen hızlı-yol algısı + Notepad temizliği eklendi.
- Doğrulama: node --check ✓; canlı koşumda.

## Kızgın doğrulama notları (dürüst)
- chatWarm 145/153 ms ölçümü MODEL değil, deterministic yerel yanıt yolu (requestsDelta=0) — warm-model gecikmesi bu sayıyla iddia EDİLEMEZ; ayrı ölçüm gerektirisi MATRİS REQ-H03'te açık.
- agentListFiles 725.638 ms 'settled=false' ölçümü, görev kaydı YOKKEN (hızlı yerel yanıt) settle algılaması yapmayan betik mimarisi kaynaklıdır; hız kendisi saniyeler içinde yanıt (0 model çağrısı) — ölçüm metodolojisi notu olarak matris REQ-A07'de işlendi.
