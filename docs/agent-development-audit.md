# Ajan mimarisi, bulgular ve geliştirme planı

Tarih: 17 Ekim 2026. Bu rapor mevcut Electron/TypeScript/Ollama mimarisini koruyan ilk geliştirme dilimini kapsar; bütün ileri seviye ajan hedefinin tamamlandığı anlamına gelmez.

Bu rapor ilk dilimin tarihsel kaydıdır. Sonraki aşamada başarılı kontrollerin kaynak güncelliği, kalıcı kabul komutları, devam ve UI kapıları eklendi. Güncel davranış ve kalan sınırlar için [doğrulama güncelliği raporuna](verification-freshness.md) bakın; aşağıdaki 79 test sayısı önceki dilime aittir.

Güncelleme (18 Ekim 2026): Bu tarihten sonra atomik çok dosyalı işlem grubu ve toplu geri alma gerçekten uygulandı ve `npm run test:smoke` içinde gerçek `create_web_project` üretimi + tek `undoLast` çağrısıyla uçtan uca doğrulandı; aşağıdaki 7 numaralı satırdaki ve P1 satırındaki "Açık" durumu o dilimin tarihsel kaydıdır. Proje açık değilken sohbet geçmişi de kalıcı hâle getirildi ve yeniden başlatma testiyle doğrulandı. Kalan veri bütünlüğü işi çökme sonrası grup kurtarma (kalıcı işlem günlüğü), adım kanıtı ve bağımlılık grafiğidir.

## Mevcut mimari

- `electron/main.ts`: `runAgent` tek etkin görev için model/araç döngüsünü yürütür. `streamCompletion` yerel Ollama akışını toplar; `toolsForRequest` istek türüne göre araçları seçer. `runTool` JSON şemasını doğrular ve gerçek dosya/komut araçlarına yönlendirir.
- `electron/agent-orchestrator.ts`: süre, tur, araç/bağlam boyutu ve düzeltme bütçelerini uygular; hataları sınıflandırır. Araçlar sırayla çalışır, alt görev bağımlılık grafiği yoktur.
- `electron/task-store.ts`: görev/plan/olay yazmalarını sıralar, atomik JSON kaydeder, kesilmiş görevi sürdürülebilir tutar. Devam sırasında yeni model bağlamı üretilir; önceki kontrol sonuçları güncel kabul edilmemelidir.
- `electron/main.ts` dosya araçları ve `sensitive-files.ts`: proje ve ek kaynak kapsamı, gerçek yol/symlink ve hassas dosya kontrolleri. Düzenleme taslağı, yedekleme, uygulama ve tek değişiklik geri alma mevcut.
- `permissions.ts`, `permission-manager.ts`, `command-environment.ts`: komut sınıflandırma, izin kapsamları, kullanıcı onayı ve kimlik bilgisi ortam değişkenlerinin ayıklanması. `runSpawnedProcessChild` çıkış/iptal/zaman aşımını ve süreç ağacını yönetir.
- `src/App.tsx`: sohbet, diff, terminal, görev ve araç panelleri; ana süreç olaylarını gösterir. `preload.ts` sınırlı IPC köprüsüdür; renderer çağrıları kaynak denetiminden geçer.
- `tests/*`: izin, görev kaydı, bütçe, araç şeması ve platform yardımcıları için Node testleri; `ui-smoke.mjs` gerçek Ollama ve kontrollü HTTP model ucu üzerinden uygulamayı sınar. `package.json` Vite derlemesi ve electron-builder NSIS/portable dağıtımını tanımlar.

## İnceleme bulguları

| Konu | Dosyalar / neden / etki | Durum ve çözüm |
|---|---|---|
| 1. Alt görevler | `main.ts` içindeki `makeTaskPlan` düz adım listesi tutuyor. Adımlar arası bağımlılık ve kabul ölçütü türü yok. | Açık. Kararlı adım kimlikleri ve doğrulanan bağımlılıklar eklenmeli. |
| 2. Adım kanıtı | `updateTaskStep` modelin `done` beyanını kabul ediyor; `note` kanıt referansı değil. Model tüm adımları işaretleyebilir. | Açık. Adım kabul koşulu, dosya/komut kanıtı ve geçerlilik denetimi gerekli. Bu dilimde başarısız kontrol varken genel görev başarısı engellendi. |
| 3. Çok dosyalı tutarlılık | `createProposal`, `applyProposal`, `undoLast` dosya başına çalışıyor. İkinci yazma hatası ilk dosyayı otomatik geri almaz. | Açık. Toplu ön kontrol, yedekleme, işlemsel uygulama ve grup geri alma en önemli sonraki veri bütünlüğü işi. |
| 4. Düzeltme sonrası test | Eski `runAgent`, herhangi başarılı test komutuyla son `errorAnalysis` alanını temizliyordu. Başarısız test + ilgisiz başarılı test yanlış başarıya yol açabiliyordu. | Düzeltildi. Başarısız doğrulamalar çağrı kimliğiyle ayrı tutulur; aynı kontrolün başarılı tekrarı yalnız o kaydı kapatır. |
| 5. Araç sonucu | Eski akış bütün çıktılarda serbest metinle çıkış kodu arıyordu. HTTP `ok:false`, Windows `success:false`, Android eksik/bozuk çıktı ve bilinmeyen çıkış kodu kaçabiliyordu. Dosya gövdesi de komut hatası sanılabiliyordu. | Düzeltildi. `agent-verification.ts` yalnız bilinen yürütme araçlarının uygulama zarflarını değerlendirir. İç gövde talimat/statü kabul edilmez. |
| 6. Kesilme/devam | Görev kaydı kalıcıydı; tek son hata çoklu başarısız kontrolleri temsil etmiyordu. | Bu dilimde kontrol listesi kalıcı hale getirildi. Görev sürdürüldüğünde yeniden yüklenir. Eski kayıtlarda eksik liste boş kabul edilir, önceki hata korunur. |
| 7. Yedek/geri alma | Mevcut dosyayı önce okuma, içerik çakışması, yedek ve son değişiklik geri alma mevcut. | Korundu. Otomatik çok dosyalı işlem grubu ve çökme sonrası grup kurtarma hâlâ eksik. |
| 8. Döngü sınırları | Orchestrator 30 dakika, 24 model turu, 48 araç, 3 düzeltme ve boyut sınırları uygular. Başarısız çağrı imzası eskiden ham JSON sırasına/gerekçeye bağlıydı. | Sınırlar korundu. İmza artık kanonik alanlardan hash edilir; alan sırası veya gerekçe değiştirmek aynı hatanın sayacını sıfırlamaz. Devam ettirme yeni oturum bütçesi açar; ömür boyu görev bütçesi ayrı geliştirmedir. |
| 9. Güvenlik | Dosya kapsamı ve onaylar mevcut; terminal Windows hesabıyla çalışıyor. İsim tabanlı hassas dosya/ortam filtresi her kod içi sırrı tespit etmez. | İzinler zayıflatılmadı. Yeni kayıt ham araç argümanları yerine SHA-256 kimliği saklar; hata açıklamaları mevcut maskeden geçer. Sistem istemine araç içeriğinin güvenilmeyen veri olduğu eklendi. Bu bir model talimatıdır, işletim sistemi izolasyonu sağlamaz. |
| 10. Gerçek UI durumu | Önceki dilimde duraklatma sonucunun tamamlandı görünmesi, eski göreve manuel terminal bağlanması ve görünmez devam paneli düzeltildi. | Korundu. Bu dilimde açık doğrulama sayısı gösterilir ve model başarı iddia etse de sohbet kaydına uygulamanın başarısız/doğrulama bekleyen sonucu eklenir. |

Aynı işi yapan/çelişen bileşenler: `main.ts` ve platform yardımcılarında farklı sonuç biçimleri vardı; yeni merkezi değerlendirici bunları tek başarı kararına bağlar. `AgentStage`/`AgentErrorAnalysis` tanımları `shared.ts` ve `agent-orchestrator.ts` içinde tekrarlanıyor; bu tiplerin ortak kaynağa taşınması düşük riskli ayrı bakım işidir. Büyük `main.ts` dosyası ayrı orkestrasyon/araç servislerine ayrılabilir; bu dilimde gereksiz yeniden yazım yapılmadı.

## Öncelikli plan

| Öncelik / sorun | Önce → hedef | Dosyalar | Test / güvenlik / tamamlanma ölçütü |
|---|---|---|---|
| P1 Yanlış başarı | Tek metin regexi ve son hata → araç zarfı + ayrı kalıcı kontrol kayıtları | `agent-verification.ts`, `main.ts`, `task-store.ts`, `shared.ts`, `App.tsx` | Yapılandırılmış hata, iptal, eksik sonuç, ilgisiz başarı, aynı başarılı tekrar, kesilme/devam ve merkezî başarı kapısı. İzinler korunur, ham argüman saklanmaz. Başarısız test ve ilgisiz başarılı testten sonra görev kesinlikle başarısız kalmalı. Bu dilimde uygulandı. |
| P1 Atomik dosya grubu | Tek dosya uygulama/undo → tutarlı çoklu dosya işlemi | Yeni işlem servisi, `main.ts`, IPC/UI | İkinci yazmada hata, dış değişiklik, symlink, çökme kurtarma, yeni dosya ve toplu geri alma. Tüm eski içerikler korunmalı; kısmî başarı tamamlandı sayılamaz. Açık. |
| P1 Adım kanıtı | Model `done` beyanı → kabul koşulu ve gerçek kanıt bağlantısı | Plan şeması, `task-store.ts`, `main.ts`, UI | Çalıştırılmamış test, eski kanıt, sonraki kod değişikliği, bağımlı adım. Model kendi beyanıyla kontrol kapısını aşamamalı. Açık. |
| P2 Bağımlı alt görevler | Düz plan → kimlikli bağımlılık grafiği | Plan servisi ve UI | Döngüsel bağımlılık, engellenen adım, yeniden planlama ve devam. Tek ajan yürütmesi korunabilir. Açık. |
| P2 Akış ve gizlilik | Ana süreçte çok sayıda sorumluluk, genel maskeleme → ayrı servisler ve sınır duyarlı çıktı filtresi | `main.ts`, model/terminal servisleri | Bölünmüş akış parçasındaki sırlar, model 5xx/timeout, bozuk SSE, süreç yaşam döngüsü. Dosya/komut kapsamını genişletmemeli. Açık. |

Kontrol kimliği araç adı ve kanonik argümanlarla belirlenir; gerekçe, not ve zaman aşımı kimliğe dahil değildir. Farklı komut/URL/proje hedefi önceki hatayı kapatmaz. Eşdeğer ama farklı yazılmış komutları veya başka bir testle ikame edilen kontrolü otomatik eşdeğer kabul etmiyoruz; bu durum açık doğrulama olarak kalır. Mevcut sürüm bütün projelere özgü kabul ölçütlerini otomatik ispatlamaz.

48 açık doğrulama kaydı sınırında eski hatalar atılarak yeni kontrol başlatılmaz. Ajan bu durumda yeni kontroller için engellenir; mevcut başarısız kontrolleri yeniden çalıştırabilir ve düzeltme için dosya araçlarını kullanabilir. Sınır davranışı deterministik testle doğrulanmıştır.

## Değişen dosyalar ve doğrulama

- Yeni `electron/agent-verification.ts`: sonuç değerlendirme, kontrol kimliği ve açık kontrol defteri.
- `electron/main.ts`: gerçek döngü entegrasyonu, yeniden yükleme, başarı kapısı, Android bilinmeyen çıkış hatası, başarılı dosya aracı sayacı ve güvenilmeyen veri talimatı.
- `electron/task-store.ts`, `shared.ts`: kalıcı doğrulama kayıtları, maskeleme ve açık hata varken tamamlanmayı engelleyen kayıt kapısı.
- `src/App.tsx`: açık doğrulama sayısı.
- `tests/agent-verification.test.ts`: 8 deterministik birim/kalıcılık testi; `package.json` test listesine eklendi.
- `tests/ui-smoke.mjs`: kontrollü modelle gerçek başarısız komut, ilgisiz başarılı komut, yanlış model başarı iddiası, başarısız görevi sürdürme, gerçek dosya düzeltmesi, aynı kontrolü tekrar çalıştırma ve geri alma senaryosu.
- `package.json`, `tests/run-ui-smoke.ps1`, `README.md`: temiz kurulumda Electron çalıştırıcısının eksik kaldığı görüldü. Resmi paketin checksum denetleyen idempotent kurucusu `setup:electron` ve proje `postinstall` adımına bağlandı; duman testi eksik çalıştırıcı için açık hata verir. Bu kurulum/paketleme sorunu ajan testinden ayrı raporlanır.
- `package-lock.json`: proje kurulum scripti metadatası güncellendi; yeni üretim bağımlılığı eklenmedi. `.audit-current.json` ve `release/SHA256SUMS.txt` güncel denetim/paket çıktılarıdır.

Model bağlantı hatası sonrasında eski genel hata, başarılı yeni model çağrısıyla temizlenir; başarısız araç kontrol kayıtları bundan etkilenmez. Kontrollü model ucu 503 hata ve yeniden bağlanma senaryosunu ayrıca sınar.

Bu raporda birim testi, kontrollü model entegrasyonu ve gerçek yerel model testi birbirinin yerine sayılmaz.

| Çalıştırılan kontrol | Sonuç ve kapsam |
|---|---|
| Temiz `npm ci` | Başarılı; proje postinstall adımı Electron çalıştırıcısını da hazırladı. İlk duman testi eksik çalıştırıcı nedeniyle başlatılamamıştı; kurulum düzeltildikten sonra yeniden çalıştırıldı. |
| `npm run typecheck` | Başarılı; ana süreç ve renderer. |
| `npm run test:permissions` | 79/79 başarılı; 8 yeni deterministik doğrulama/kalıcılık testi dahil. |
| `npm run test:smoke` | Başarılı; gerçek Qwen dosya oku/taslak/uygula/geri al ve kontrollü modelle başarısız test → ilgisiz başarı → görev başarısız; sürdür → gerçek dosya düzeltmesi → aynı kontrol başarılı → görev tamamlandı. Model 503 hatası ve başarılı yeni model çağrısıyla toparlanma da doğrulandı. |
| `npm audit` | Geliştirme bağımlılıkları dahil 0 bulgu. Yeni bir güvenlik açığı bulunmadığını tüm kaynak kodu için kanıtlamaz. |
| `git diff --no-index` | Değişiklik öncesi kopyalarla ana döngü, görev kaydı, ortak tip ve npm script farkları incelendi; yeni modül/test için whitespace kontrolü yapıldı. Çıktıdaki LF/CRLF bildirimleri Git çalışma ağacı ayarıdır. |

Son `npm run dist` başarılı oldu; güncel NSIS kurulum dosyası ve portable EXE üretildi. İki dosyanın MZ/PE başlığı doğrulandı, SHA-256 değerleri `release/SHA256SUMS.txt` dosyasına yazıldı. Son `npm run test:packaged` bu portable EXE üzerinde başarılı oldu; gerçek Qwen ve kontrollü model senaryolarını tekrar doğruladı. Bir önceki paketli test koşusu başlangıç Ollama durum sorgusu çevrimdışı döndüğü için başarısızdı. Yerel `/api/tags` ve `/v1/models` uçları ayrıca doğrulandı; test başlangıcına 15 saniyelik sınırlı gerçek servis hazır olma beklemesi eklendi ve son koşu geçti. Bağlantı kontrolü veya gerçek model testi atlanmadı. Ekran görüntüsü `release/ui-smoke.png` dosyasındadır.

## Kalan riskler ve doğrulanmamış kapsam

- İşletim sistemi sandbox'ı yoktur; onaylı proje betikleri kullanıcının dosya/ağ yetkilerine sahiptir. Dosya kapsamı kontrolleri bunun yerine geçmez.
- Güvenilmeyen içerik talimatı modele rehberlik eder; prompt injection'a karşı matematiksel garanti değildir. İzin ve araç şeması kontrolleri bağımsız kalır.
- Hassas dosya/ortam adı ve token maskelemesi sınırlıdır; kaynak içindeki her sır veya akış parçalarına bölünen her gizli değer için eksiksiz sızıntı önleme iddiası yoktur.
- Plan adımlarını gerçek kanıta bağlama, sonraki kod değişikliğinde başarılı test kanıtını geçersiz sayma, bağımlılık grafiği ve atomik çok dosyalı işlem henüz eklenmedi. Bu nedenle bütün kullanıcı gereksinimlerinin sağlandığı otomatik ispatlanmaz.
- Kontrol kimliği hassas argümanları saklamadığı için devam eden görevin hangi komutu tekrar çalıştıracağını mevcut proje/görev bağlamından bulması gerekir. Farklı ama eşdeğer bir kontrolle otomatik kapatma desteklenmez; kayıt ihtiyatlı biçimde açık kalır.
- Bu dilimde gerçek Android cihaz/emülatör testi, yeni Android APK derlemesi ve bütün Windows teknoloji yığınları tekrar çalıştırılmadı. Yeni platform sonuç sınıflandırması birim testleriyle doğrulandı.
- Uygulama kurulum paketi dijital imzalı değildir; kurulum sihirbazıyla kullanıcı kurulumunun uçtan uca doğrulanması ayrı iştir.
- Sonraki en önemli geliştirme çok dosyalı değişikliklerin ön kontrol, yedek, hata durumunda geri dönüş ve toplu geri alma ile tek işlem grubuna bağlanmasıdır. Ardından plan adımlarına ölçülebilir kanıt referansları eklenmelidir.

Depoda henüz commit/HEAD yok; mevcut kaynakların tamamı untracked. Bu nedenle normal `git diff` boş sonuç veriyor. Değişiklik öncesi alınan geçici kaynak kopyalarıyla `git diff --no-index` kullanılarak ana döngü ve kayıt değişiklikleri incelendi; kullanıcı kaynaklarına başlangıç commit'i oluşturulmadı.
