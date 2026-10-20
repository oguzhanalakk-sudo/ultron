# Güncel kaynak üzerinde doğrulama

Tarih: 17 Ekim 2026. Bu aşama, mevcut ajan mimarisine doğrulama güncelliği ve kalıcı kabul komutları ekler.

## Düzeltilen davranış

Önce başarılı kontroller saklanmıyordu. Test başarılı olduktan sonra kaynak değişse, model planı `done` yapıp görevi tamamlayabiliyordu. Kabul kontrolleri yalnız son workspace planında bulunduğundan başka bir görev açıldıktan sonra kaybolabiliyordu.

Şimdi:

- Başarılı çalıştırmanın araç/argüman kimliği, kaynak parmak izi, zamanı ve test/derleme/çalıştırma türü kaydedilir. Ham argümanlar bu makbuza yazılmaz.
- Her gerçek kontrol öncesi ve sonrasında kaynak parmak izi alınır. Kontrol sırasında kaynak değişirse başarı güncel kanıt sayılmaz. Son görev kararından önce kaynak tekrar karşılaştırılır.
- Uygulamanın gerçek dosya yazma/geri alma işlemi ayrıca yerel değişiklik sayacını artırır; parmak izinde hariç tutulan yola bilerek yazılması da eski kanıtı geçersiz kılar. SQLite migration da yazmadan önce doğrulama gereksinimini kalıcılaştırır.
- Değişen veya doğrulanamayan kaynak önceki başarılı kontrolleri `stale` yapar. Bu, testin gerçekten başarısız olmasıyla karıştırılmaz; görev `needs_review` olur.
- Devam ettirmede bütün önceki başarılar yeniden kontrol bekler. Kaynak aynı kalsa bile ortam, bağımlılıklar, cihaz veya localhost servisi değişmiş olabilir.
- Planın `tests` listesi artık `run_tests.command` ile bire bir çalıştırılacak komutları içerir. Her biri için güncel başarı gerekir. Başlık/not veya `done` beyanı bu koşulu karşılamaz.
- Kabul listesi ve tamamlanan adım konumları görev kaydında saklanır. Başka görevden sonra eski görev açılabilir. Aynı başlıklı iki adım birbirini tamamlamaz; yeniden planlama önceki tamamlanmayı sıfırlar. Eski kimliksiz kayıtlar ihtiyatlı biçimde açık adımlarla yüklenir.
- Gerçek dosya yazımı/geri alma/silme/yeniden adlandırmadan önce test gereksinimi kalıcı kaydedilir. Kesilmiş bir mutasyon aracı kaydı da devamda doğrulama gerektirir. İnceleme için hazırlanan taslak gerçek değişiklik sayılmaz.
- Kaynak değişmişse güncel test veya derleme kaydı gerekir. `node --version`, Android `tasks/projects` listelemesi, salt proje analizi, CMake configure veya eski bir EXE'yi başlatmak bu gereksinimi karşılamaz.
- Şema/yol gibi yürütme öncesi hatalar operasyonel hata olarak tutulur; düzeltilmiş aynı aracın başarılı kullanımıyla kapanabilir. Gerçek başarısız kontrol zarfları ayrı kontrol kimliğiyle açık kalır.
- Son kullanıcı olayı kalıcı `TaskStore.finish` sonucundan üretilir. Kaydetme başarısızsa “tamamlandı” olayı üretilmez.
- UI başarısız ve eski kontrolleri planın tamamlanma işaretinden önce gösterir. Plan adımları ilerleme beyanıdır; semantik doğrulanmış gereksinim olarak etiketlenmez.

## Dosyalar

| Dosya | Değişiklik |
|---|---|
| `electron/project-fingerprint.ts` | Kapsam içindeki kaynakların SHA-256 özeti; sınırlı okuma, link ve erişim hatasında kanıt üretmeme |
| `electron/agent-verification.ts` | Başarı makbuzları, stale durum, kabul komutu kimliği, kontrol türü, 48 kimlik sınırı |
| `electron/main.ts` | Öncesi/sonrası/sonlandırma entegrasyonu; devamda araç kapsamı; kalıcı mutasyon niyeti; gerçek son durum |
| `electron/shared.ts`, `electron/task-store.ts` | Yeni alanlar, maskeleme/sınırlar/eski kayıt uyumu ve merkezî tamamlanma kapısı |
| `src/App.tsx`, `src/styles.css` | Görev durumu önceliği, yeniden doğrulama uyarıları, doğru başarı rozeti |
| `tests/agent-verification.test.ts` | 5 yeni güncellik, tekrar, sınır, platform türü ve kalıcılık testi |
| `tests/project-fingerprint.test.ts` | 11 yeni gerçek dosya sistemi testi; CLI `bin` kaynağı ve Windows junction dahil |
| `tests/task-store.test.ts` | 9 yeni kabul komutu, devam, yeniden planlama, tür ve merkezî kapı testi |
| `tests/ui-smoke.mjs`, `package.json` | Yeni test listesi ve gerçek Electron içinde kontrollü model senaryoları |

## Kapsam ve sınırlar

Parmak izi proje ve kullanıcının yetkilendirdiği ek kaynak köklerini kapsar; recursive olmayan kaynakta yalnız doğrudan dosyalar okunur. `.env` dahil yerel yapılandırma yalnız özet hesabına katılır; içeriği bu API ile modele veya makbuza verilmez. Hash alma yeni bir model dosya okuma yetkisi oluşturmaz.

Çıktı/bağımlılık klasörleri hariçtir: `.git`, `.codex-local`, `node_modules`, `.gradle`, `.idea`, `.vscode`, `build`, `dist`, `release`, `out`, `target`, `.next`, `coverage`, `.pytest_cache`, `__pycache__`, `test-results`, `playwright-report`, `.cache`, `.venv`, `venv`, `obj`. Bunlara kaynak koyan projelerde dış düzenlemeler için tam kaynak kapsamı iddiası yoktur. Uygulamanın kendi yazması ayrıca sayılır. CLI projelerinin `bin` klasörü kaynak olarak dahildir. Lockfile'lar dahildir; kurulu bağımlılık içeriği, SDK sürümleri, dış servis durumu veya kapsam dışı dosyalar parmak izine katılmaz.

Sınırlar: 15.000 dosya, 15.000 klasör, 80 alt klasör derinliği, tek dosyada 20.000.000 bayt ve toplam 150.000.000 bayt. Kapsam içi sembolik bağlantı/junction, okunamayan kaynak veya sınır aşımı varsa işlem çalıştırılabilir ama güncel kanıt üretilemez. Dosya okuması ayrılan tamponla sınırlıdır. Aynı kontrolü tekrar çalıştırmak ancak güvenilir kaynak özeti alınabiliyorsa durumu kapatır.

Bu, dosya sistemi anlık görüntüsü veya işletim sistemi sandbox'ı değildir. Eşzamanlı dış süreç değişiklikleri ve yol yarışlarına karşı tam atomiklik sağlamaz; hariç klasörlerdeki değişiklikleri izlemez. Terminal betikleri Windows hesabının yetkileriyle çalışır. Kaynak özeti bir doğruluk/zararsızlık garantisi veya imzalı kanıt zinciri değildir.

Plan test komutunu model belirler. Komutun bütün kullanıcı gereksinimlerini kapsadığını veya gerçekten test içerdiğini bu katman semantik olarak ispatlamaz. Adım başına kanıt referansı ve bağımlılık grafiği hâlâ ayrı iştir. 48 kontrol kimliği sınırında yeni kontrol başlatılmaz; eski sonuçlar sessizce düşürülmez.

## Sonraki en önemli iş

Geri alırken dosyanın ajanın yazdığı son içerikle hâlâ eşleşmesini denetlemek. Mevcut `undoLast` dışarıdan yapılan sonraki düzenlemeyi ezebilir. Ardından çok dosyalı uygulama için bütün hedefleri önceden doğrulama, kalıcı işlem günlüğü, kısmi hata geri dönüşü ve grup geri alma eklenmeli. Eski projeye ait taslakların başka proje üzerinde kullanılmasını engelleyen proje kimliği de aynı çalışmaya dahil edilmeli.

Güncelleme (18 Ekim 2026): Bu maddelerin büyük bölümü artık uygulanmıştır. Tek dosya geri alma, ajanın yazdığı son içerikle eşleşmeyi denetler ve dışarıdan değişmiş dosyayı ezmez; taslaklar proje kimliğiyle bağlanır; otomatik başlangıç üretimi (web/Android/Windows) çok dosyalı işlem grubunda toplanır, grup içindeki dosyalar önceden doğrulanır ve tek geri alma çağrısı grubun tamamını geri alır. Bu davranışlar `tests/ui-smoke.mjs` içinde gerçek dosyalarla uçtan uca doğrulanmaktadır. Hâlâ açık olan kısım çökme sonrası kurtarmadır: grup oluşturma sırasında uygulama çökerse kalıcı bir grup günlüğü bulunmadığından yarım kalan dosyalar geri alma kaydı olmadan kalabilir. Adım başına kanıt referansı ve bağımlılık grafiği de ayrı açık işlerdir.

Android cihaz/emülatör çalıştırması ve bütün Windows teknoloji yığınları bu aşamada yeniden denenmedi. Kurulum paketi imzasızdır; kurulum sihirbazı testi ayrı kapsamdır.
