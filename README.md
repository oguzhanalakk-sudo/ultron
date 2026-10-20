# Ultron

## Git ve GitHub

Ultron, yerel Git için `git_status`, `git_diff`, `git_log`, `git_branch`,
`git_commit`, `git_revert_commit` ve `git_push_branch` araçlarını kullanır.
Dal oluşturma, commit, geri alma ve uzak depoya gönderme kullanıcı onayıyla
çalışır. Ana dal (`main`/`master`) için doğrudan push, force push, reset,
rebase, amend ve geçmişi yeniden yazma araçları yoktur. Geri alma, yalnızca
yeni bir `git revert` commit'i oluşturarak yapılır.

GitHub REST araçları: `github_status`, `github_repos`, `github_repo`,
`github_read_file`, `github_issues`, `github_pull_requests`,
`github_create_issue` ve `github_create_pull_request`.

GitHub erişimi için Windows kullanıcı ortamına veya Ultron'u başlatan sürece
`ULTRON_GITHUB_TOKEN` tanımlayın. Klasik token kullanılıyorsa yalnız gerekli
depo erişimini; fine-grained token kullanılıyorsa hedef depoyu ve sadece
gerekli izinleri seçin: okuma için **Contents/Issues/Pull requests: Read**,
issue açmak için **Issues: Read and write**, PR açmak için **Pull requests:
Read and write**. Token kaynak koda, görev kaydına veya işlem günlüğüne
yazılmaz. Yazma yapan GitHub araçları her seferinde ayrı onay ister.

Windows masaüstünde çalışan, yalnızca yerel Ollama modeliyle çalışan kişisel yapay zekâ sohbet ve kodlama çalışma alanı. Bulut yapay zekâ, OpenAI API'si, API anahtarı ve telemetri yoktur.

## Gereksinimler

- Windows 10/11 x64
- Geliştirme/paketleme için Node.js 22.12.0 veya üzeri
- Ollama (önerilen yerel sağlayıcı) ve indirilmiş bir sohbet modeli
- Android derlemesi için ayrıca JDK ve Android SDK

Bu bilgisayarda Windows 11, Intel Core i7-13620H, 16 GB RAM ve 8 GB NVIDIA RTX 4060 Laptop GPU var. Kurulu Ollama modeli `qwen3:8b`; ilk açılış bu modeli seçer. Yalnızca bu bilgisayardaki Ollama kataloğu kullanılır; uzak, OpenAI uyumlu ve bulut uç noktaları reddedilir.

## Ajan yetenekleri

Güncel geliştirme: [kaynak güncelliğine bağlı doğrulama ve kalan sınırlar](docs/verification-freshness.md).

- Kodlama ajanı araç çağrısı döngüsüyle gerçek dosya okuma/yazma, arama, diff, Git durumu/farkı, test, hata tanılama, terminal komutu, proje hafızası ve görev planı araçlarını kullanır.
- Proje sohbeti, hafıza, izinler, görev planı, son derleme çıktısı ve son 2.000 yapılandırılmış işlem `.codex-local/` altında kalıcıdır. Kullanıcı genelindeki kategori izinleri uygulamanın kullanıcı veri klasöründe tutulur. İşlem günlüğü JSON olarak dışa aktarılabilir.
- Her ajan isteği için ayrıca `.codex-local/tasks.json` görev kaydı tutulur: istek, plan, adımlar, ajan aşaması, geçerli araç, araç/düzeltme sayaçları, hata sınıfı, araç sonuçları, onay kararları ve durum. Açılışta yarım kalan görevler işaretlenir; İşlemler panelinden güncel dosya ve izinler yeniden kontrol edilerek sürdürülebilir. Duraklatma ve durdurma farklı davranışlardır. Görev günlüklerindeki anahtar/token örüntüleri maskelenir.
- Terminal paneline elle yazılan komutlar bağımsız işlemlerdir; önceki ajan görevinin durumunu değiştirmez ve görev süresince verilen iznini kullanmaz. Ajan bittiğinde arayüz tamamlandı, duraklatıldı, engellendi, iptal edildi veya doğrulama bekliyor sonucunu ayrı gösterir. Çözümlenen onay kartları ana süreçten gelen olayla kaldırılır.
- Ajan yürütmesi 30 dakika, 96 model turu, yanıt başına 8 araç çağrısı, görev başına 256 araç çağrısı, 160 KB araç parametresi/yanıtı, araç başına 12.000 karakter çıktı ve 480.000 karakter bağlam bütçesiyle çalışır. Hata düzeltme sayacı görünür durum bilgisidir; tek başına görevi durdurmaz. Araç sonucu hata sınıfına göre analiz edilir.
- Başarısız komut/test/Android/Windows/HTTP kontrolleri ayrı kimliklerle görev günlüğünde tutulur. İlgisiz başarılı kontrol bunları temizlemez; aynı kontrolün başarılı tekrarı gerekir. Kayıtlar kesilme/devam sırasında korunur; açık doğrulama hatası varken modelin başarı iddiası görevi tamamlandı yapamaz ve sohbet kaydına uygulamanın gerçek sonucu eklenir. Kontrol kimlikleri ham parametre yerine hash olarak saklanır. Bu mekanizma, projeye özgü bütün kabul koşullarının otomatik kanıtlandığı anlamına gelmez.
- Başarılı kontroller kaynak parmak iziyle saklanır. Kaynak değişirse veya görev sürdürülürse eski sonuç yeniden çalıştırma bekler. Planın kabul komutları her görevde korunur; `run_tests.command` ile bire bir başarılı çalıştırılmadan görev tamamlanmaz. Gerçek değişiklik için güncel test/derleme gerekir; salt analiz veya eski EXE'yi başlatmak bu koşulu karşılamaz. Ayrıntılı sınırlar güncellik raporundadır.
- Üç proje izin profili vardır: kontrollü (dosya ve komut onayı), gelişmiş (yedekli otomatik düzenleme ve güvenli geliştirme komutları), kişisel (bu kişisel bilgisayarda tüm komutları ve paket işlemlerini onaysız çalıştırır). Windows hesabının kendi yetkileri yine geçerlidir.
- Derleme/test sonuçları, hata satırları ve bulunan APK, EXE, MSI, JAR, ZIP gibi çıktılar görev panelinde görünür.
- `security_audit` sezgisel kaynak kodu kurallarını tarar ve proje manifestine göre npm, pip-audit, cargo-audit veya dotnet bağımlılık denetimi başlatır. Bağımlılık aracının indirme/ağ gerektiren çalışması onay ister.
- `analyze_logs` açık dosya kapsamındaki metin günlüklerini salt okunur tarar. `network_inventory` yalnızca onaylanan özel IPv4 CIDR içinde (en çok 16 adres ve 24 TCP port) açık port envanteri çıkarır; tarama her seferinde onaylanır.

## Yerel AI kontrol paneli

Sağ paneldeki **Yerel AI** sekmesi:

- Ollama bağlantısını, sürümünü, seçili modeli ve yüklü modelleri gerçek `/api/version`, `/api/tags` ve `/api/ps` yanıtlarından gösterir.
- CPU, mantıksal çekirdek, toplam/boş RAM, GPU/VRAM ve C: boş alanını yerel işletim sistemi araçlarından ölçer. Değer okunamazsa "bilinmiyor" der; sahte değer üretmez.
- Her model için dosya boyutu, parametre sayısı, nicemleme ve donanım uyum tahminini (GPU / kısmi GPU / CPU / çok büyük) gösterir.
- Modeli belleğe yükler, bellekten boşaltır, test eder, seçer, siler ve isteğe bağlı olarak indirir. İndirme ilerlemesi akış olarak gösterilir; indirme yalnızca kullanıcı başlattığında çalışır.
- Son model yanıt süresini ve Ollama'nın `eval_count`/`eval_duration` alanlarından hesaplanan token/sn değerini gösterir. Ölçüm yoksa tahmin göstermez.

## Akıllı işlem motoru

Model gerektirmeyen işlemler yerel kodla yanıtlanır: dört işlem/parantez/kuvvet hesapları güvenli bir çözümleyiciyle (`eval` yok), JSON doğrulama/biçimlendirme, proje kökü dosya listesi, sistem/donanım özeti ve yerel saat/tarih. Bu istekler model çağrısı yapmadan yanıtlanır ve sohbet geçmişine kaydedilir. Diğer tüm kodlama ve akıl yürütme istekleri seçili yerel modele gider.

## Doğal sohbet modu

Yerel modelle proje açmadan da doğal Türkçe sohbet edilebilir. Sohbet istekleri araç çağırmaz, görev kaydı oluşturmaz ve `.codex-local/tasks.json` geçmişini kirletmez; yanıtlar üretildikçe akış halinde gösterilir. Proje açıksa konuşma geçmişi çalışma alanına kaydedilir ve sonraki mesajlarda bağlam olarak kullanılır. Proje açık değilken de konuşma geçmişi kullanıcı veri klasöründeki `chat-history.json` dosyasında kalıcı tutulur (son 200 mesaj) ve uygulama yeniden açıldığında arayüze geri yüklenir; **Yeni görev** düğmesi bu geçmişi temizler. Uzun sohbetlerde geçmiş, mesaj sayısı ve toplam karakter bütçesiyle (en fazla 20 mesaj / 24.000 karakter) kontrollü biçimde modele aktarılır; en yeni mesajlar korunur ve geçmiş her zaman kullanıcı mesajıyla başlar.

Basit karşılama, hâl hatır, kimlik/yetenek, teşekkür ve düzeltme mesajları hızlı sohbet yolundan yanıtlanır; dosya, kod, proje, test, komut veya eylem bildiren istekler mevcut planlama/araç yürütme akışına gider. Sohbet modeli gerçek donanım, seçili model ve son model ölçümüyle beslenir; ölçmediği bir değeri veya yapmadığı işlemi iddia etmemesi için sistem isteminde açıkça sınırlandırılır. Sohbet yanıtı beş dakikalık süre sınırına ve kullanıcı durdurma/duraklatma denetimine tabidir.

## Kişisel hafıza ve geri bildirim

Sağ paneldeki **Hafıza** sekmesi yerel, kullanıcı onaylı hafızayı gösterir:

- Kategoriler: tercihler, bilgiler, geri bildirimler ve konuşma/görev özetleri. En fazla 400 kayıt; her kayıt 2.000 karaktere kadar.
- Sohbette "şunu hatırla: …", "not al: …" veya "hafızaya kaydet: …" açık istekleri her zaman kaydedilir; "bunu unut: …" eşleşen kayıtları siler.
- Aynı kategori ve kapsamdaki benzer kayıtlar birleştirilir; olumsuzluk/karşıt anlam taşıyan yeni bilgi öncekiyle **çelişki** olarak işaretlenir, sessizce silinmez.
- Kayıtları panelden ekleyebilir, düzenleyebilir, tek tek silebilir veya tümünü temizleyebilirsin. Hafıza kullanıcı veri klasöründeki `memory.json` dosyasında tutulur ve cihazdan çıkmaz.
- **Otomatik öğrenme** ayarı varsayılan olarak kapalıdır. Açıkken düzeltme/geri bildirim mesajları ve tamamlanan görevlerin kısa özetleri yerel hafızaya eklenir; kapalıyken yalnızca açık istekler kaydedilir. Bu mekanizma model ağırlıklarını değiştirmez; öğrenme yalnızca yerel hafıza ve görev kayıtları üzerinden gerçekleşir.
- Hafızanın yalnızca sorguyla ilgili ve güncel kısmı ajan/sohbet sistem istemine eklenir; hafızada olmayan bir anı varmış gibi davranılmaz.

## Ses araçları

**Yerel AI** panelindeki ses araçları bölümü, bu bilgisayarda `whisper.cpp` (`whisper-cli`) ve `Piper` komut satırı araçlarının PATH üzerinde bulunup bulunmadığını gerçek `where.exe` sorgusuyla denetler. Araç yoksa "bulunamadı" olarak raporlanır; yazılı sohbet etkilenmez. Hiçbir bulut ses servisi kullanılmaz. Bu sürümde araç varlığı raporlanır; sesli dikte/yanıt entegrasyonu ve mikrofon izni akışı henüz etkin değildir.

## Kişisel profil

Ayarlar'da isteğe bağlı **Kişisel ad** ve **Kalıcı kişisel talimatlar** alanları vardır. En fazla 60 + 2.000 karakter, yalnızca yerel `settings.json` dosyasında saklanır ve ajanın sistem bağlamına eklenir. Ad, karşılama ekranında ve kullanıcı avatarında görünür. Bu alanlar hiçbir sunucuya gönderilmez.

## Çevrimdışı çalışma

Uygulama açılışı, sohbet, proje analizi, görev yönetimi, hafıza, test/derleme, Android/Web/Windows panelleri ve yerel model çağrıları internet olmadan çalışır. Tek ağ bağımlılığı `127.0.0.1:11434` üzerindeki Ollama servisidir. Model indirme ve bağımlılık denetimi (`npm audit`, `pip-audit` vb.) internet gerektirir ve kullanıcı onayı ister; bunlar olmadan temel işlevler bozulmaz. `tests/offline-inventory.test.ts` kaynakta harici yapay zekâ uç noktası, bulut SDK'sı ve telemetri paketi bulunmadığını; ana süreçteki sabit HTTP hedeflerinin yalnızca loopback olduğunu doğrular.

## Güvenlik ve çalışma akışı

- Dosya araçları proje köküyle ve Ayarlar'da ayrıca seçtiğin kaynak klasörleriyle sınırlıdır. Her ek klasör salt okunur veya okuma-yazma ve doğrudan içerik veya alt klasörleriyle birlikte tanımlanır. Kapsam dışı mutlak yollar, kapsamı aşan sembolik bağlantılar, sürücü kökü ve `.git`, `node_modules`, derleme/yedek klasörleri reddedilir. Ek kaynak yolları görev istemlerinde `@resource/<id>/...` biçiminde kullanılır.
- `.env` dosyaları, kimlik bilgisi depoları, bulut/SSH klasörleri ve özel anahtar biçimleri yapay zekâya ve ajan dosya listesine açılmaz; `.env.example`, `.env.sample` ve `.env.template` güvenli örnek dosyaları okunabilir.
- Ajan mevcut dosyayı okumadan değiştiremez. Kontrollü profilde diff taslağı gösterilir; uygulama öncesi eski içerik `.codex-local/backups/` altında saklanır. Otomatik profillerde de yedek alınır. Geri Al en son dosya değişikliğini geri döndürür.
- Komutlar seçilen proje dizininde başlar. Kontrollü ve gelişmiş profillerde komut satırı kabuk ayraçları/genişletmeleri ve risk sınıfları denetlenir; ilgili durumlarda onay tek işlem, geçerli görev, açık proje kapsamı veya kategori için kaydedilebilir. Kişisel profil, kullanıcının açık tercihiyle bu uygulama denetimlerini atlar ve Windows hesabının izin verdiği komutları doğrudan çalıştırır.
- Modelin araç argümanları aracı çalıştırmadan önce ilan edilen JSON şemasına göre kontrol edilir; yanlış tür, eksik/ekstra alan, enum ve sınır ihlali reddedilir. Model istekleri 120 saniyede zaman aşımına uğrar; geçici ağ/5xx hatalarında bir kez denenir. Görevi duraklat ve Görevi durdur kontrolleri vardır; çalışan alt süreç Windows'ta ağaç olarak sonlandırılır. Açık plan adımı veya çözümlenmemiş hata varsa yanıt görevi tamamlandı diye işaretlenmez.
- Kontrollü ve gelişmiş profillerde PowerShell için otomatik çalışma dar salt okunur sorgu listesine açıktır. Kişisel profilde PowerShell ve diğer komutlar onay kartı olmadan çalışır.
- Ajanın başlattığı komut, web hizmeti, Gradle/SDK, SQLite ve uygulama doğrulama alt süreçleri standart Windows geliştirme değişkenlerini (PATH, USERPROFILE, JAVA_HOME, ANDROID_HOME gibi) alır; adında API anahtarı, token, parola, gizli anahtar veya kimlik bilgisi belirten değişkenler ve kullanıcı bilgisi gömülü URL değerleri alt sürece aktarılmaz. Bu filtre, proje betiklerinin Windows hesabının erişebildiği dosyalara veya ağa erişmesini engelleyen bir işletim sistemi sandbox'ı değildir; hassas dosya içeriğine veya başka kimlik bilgisi kaynaklarına erişimi yalıtmaz.
- Onaylanan proje betikleri Windows hesabının erişebildiği dosyalara ve ağa erişebilir. Risk, komut, çalışma yolu, geri alma ve doğrulama bilgisi onay kartında gösterilir.
- IPC çağrıları yalnızca doğrulanmış ana pencerenin ana frame'inden kabul edilir. Paketli uygulama yalnız kendi renderer dosyasını yükler; geliştirme renderer adresi paketlenmemiş modda loopback ile sınırlıdır. Yeni pencere açmak yerine HTTP/HTTPS ve posta bağlantıları varsayılan tarayıcıya aktarılır.
- İşletim sistemi sandbox'ı yoktur. Ek klasör izinleri uygulamanın kendi dosya araçlarını kapsar; kullanıcı onayıyla başlatılan proje betiklerinin dış dosyalara veya ağa erişimini Windows hesabı seviyesinde yalıtmaz. Sistem yöneticisi yetkisi otomatik yükseltilmez.
- Kod güvenlik sonuçları sezgisel statik bulgulardır; EVTX olay günlükleri ve kapsamlı/uzman güvenlik tarayıcıları bu sürümde desteklenmez. Ağ envanteri TCP bağlantı kontrolüyle sınırlıdır; paket/banner veya zafiyet testi yapmaz.
- Yapay zekâ tamamen yereldir. Ollama yalnızca loopback adresine (`127.0.0.1`, `localhost`, `::1`) bağlanır; uzak/bulut adresleri ve `openai` sağlayıcısı kod ve IPC düzeyinde reddedilir. API anahtarı alanı, bulut SDK'sı ve telemetri yoktur. Sohbet, proje kodu ve model yanıtları bilgisayardan dışarı gönderilmez. Tek istisna, kullanıcının açıkça başlattığı model indirmedir; indirme Ollama'nın kendi mekanizmasıyla yapılır ve model yerel kataloğa eklenir.

## Android APK

Sağ paneldeki **Android** sekmesi JDK, SDK platformları/build-tools, lisanslar, Gradle Wrapper, SDK Manager, ADB ve emulator durumunu; bağlı cihazları ve seçili proje analizini gösterir. Ajan `android_environment`, `analyze_android_project`, `android_devices` ve `find_android_artifacts` araçlarını kullanabilir.

Yeni proje isteğinde Kod Atölyesi proje klasörünüzün altında `android-projects/<ad>` içine Java/XML tabanlı, sayaç ekranı ve birim test içeren çalışabilir bir başlangıç projesi oluşturur. Var olan klasörün üstüne yazmaz; metin dosyalarını proje düzenleme izni ve diff/backup akışına sokar. Gradle Wrapper JAR kopyası için ayrıca onay ister. Ajan, bu başlangıç üzerine kullanıcının tarif ettiği gerçek özellikleri uygular. Alt klasördeki proje `build_android` çağrısında `project_path` ile derlenebilir.

`build_android` allowlist içindeki debug/release APK, AAB, unit-test, connected-test, lint ve check görevlerini proje Gradle Wrapper'ıyla yürütür. Gradle wrapper veya bağımlılık indirmeleri paket onayı gerektirir. Derleme kaydında görev, süre, çıkış kodu, test durumu, APK/AAB yolu ve boyutu, ZIP yapısı doğrulaması, son hata sınıfı ve Gradle hata satırları tutulur. Release imzalama bilgileri kullanıcıya aittir; uygulama anahtar üretmez veya değiştirmez. `android_install` ve `android_launch` sadece seçilen bağlı cihaz için her seferinde kullanıcı onayıyla çalışır. Cihaz bağlı değilse cihazda test yapılmış sayılmaz.

Bu bilgisayarda Windows 11, JDK 17, SDK platformları Android 33/36, Build Tools 35/36, ADB, SDK Manager ve Gradle 9.8.1 var. Android projeleri kendi Gradle Wrapper'ını öncelikli kullanır; emulator testleri için Android Studio SDK Manager'dan emulator ve AVD kurmak gerekir.

## Windows masaüstü uygulamaları

Sağ panelin **Windows** sekmesi gerçek Windows sürümünü, mimariyi, CPU/RAM'i ve Python, .NET SDK, C# derleyicisi, Visual Studio Build Tools/MSBuild, Node/npm/pnpm/Yarn/Bun, Git, PowerShell, CMake/Ninja, Maven, Go, PyInstaller, Inno Setup ve Rust/Tauri araçlarını sürüm sorgularıyla denetler. Python sanal ortamlarını da seçili proje çevresinde arar.

`analyze_windows_project`, `create_windows_desktop_project` ve `windows_build` ajan araçları Python (Tkinter/PySide/PyQt), C#/.NET (WinForms/WPF/WinUI), Electron, Tauri ve CMake projelerini inceler. Var olan teknoloji korunur. Yeni masaüstü proje isteği için başlangıç şablonu yeniden boyutlandırılabilir Tkinter arayüzü, SQLite ile kalıcı görev verisi ve unittest içerir; ajan bu başlangıcı gerçek iş gereksinimlerine göre geliştirmelidir.

`windows_build` proje türüne göre test, Python bytecode derlemesi, PyInstaller onefile/onedir EXE, .NET publish, Electron dağıtımı, Tauri/CMake derlemesi veya projedeki mevcut Inno Setup betiğini çalıştırabilir. Komut ve proje dizini kaydedilir; terminal işlemi her seferinde PermissionManager onayına tabidir. Çıkış kodu ve yeni üretilmiş çıktı kaydı tutulur; EXE için PE imzası, MSI için dosya imzası doğrulanır. `verify_start` sadece kapsam içindeki EXE sürecini kısa süre çalıştırır; pencerenin görsel görünümünü veya uygulamanın bütün işlevlerini doğruladığını iddia etmez.

Bu makinede Python, Node/npm/pnpm/Yarn/Bun, Git, Rust/Cargo, Go, .NET SDK, PyInstaller, Inno Setup, CMake/Ninja, Apache Maven ve Gradle mevcut. Visual Studio Build Tools/MSBuild, Tauri CLI ve Android Emulator bulunmuyor. İşletim sistemi seviyesinde sandbox bulunmadığından kişisel profilde çalıştırılan proje betikleri Windows hesabının eriştiği dosya ve ağı kullanabilir.

## Web uygulaması geliştirme

Sağ paneldeki **Web** sekmesi seçili projeyi yerel dosyalardan tarayıp algılanan ön yüz, arka uç, veritabanı, ORM, API/rota dosyaları, migration'lar, test/derleme betikleri ve önerileri gösterir. `packageManager` alanı ve yaygın veritabanı sürücüleri lockfile olmasa da algılanır; build/lint komutları test sonucu olarak sayılmaz. Ajan web isteğinde yalnız ilgili web araçlarını görür; mevcut teknoloji yığınını korumalı, gerçek ön yüz/API/kalıcılık ve hata yolları eklemeli, uygun test ve üretim derlemesini çalıştırmalıdır.

Yeni web projesinde `create_web_project`, Python standart kitaplığı + SQLite ile çalışan bir tam yığın başlangıç üretir: responsive görev panosu, gerçek JSON CRUD API, doğrulanmış girişler, migration, yerel HTTP sunucusu ve entegrasyon testleri. Bu şablon son ürün değildir; ajanın kullanıcı gereksinimlerini bu iskeletin üzerine uygulaması gerekir. `web_start_service` yalnızca proje içindeki yönetilen geliştirme süreçlerini başlatır; her zaman web ağırlık kontrolü ile gerçek localhost HTTP yanıtını doğrulayın. `web_http_check` yalnızca loopback GET isteği yapar, dış URL ve yönlendirmeleri izlemez.

`web_database` bu sürümde proje kapsamındaki SQLite dosyalarını inceler ve yalnız SELECT/WITH sorgularını çalıştırır; sorgu sonuçlarında satır değerleri görev günlüklerine yazılmaması için gizlenir. Projedeki `.sql` migration uygulanmadan önce dosya `read_file` ile incelenir, mevcut veritabanı SQLite snapshot API'si ile yedeklenir ve işlem kullanıcı onayı ister. Drop/delete gibi yıkıcı ifadeler özel yüksek risk onayı alır. PostgreSQL/MySQL/MSSQL bağlantı ve migration işleri ilgili proje ORM/CLI aracı, test veritabanı ve mevcut izin akışı üzerinden yapılır; uygulama bu sunucu veritabanlarını kendiliğinden kurmaz.

Örnek proje: [`samples/web-taskboard`](samples/web-taskboard). Python standart kitaplığı dışında bağımlılık istemez, 127.0.0.1'e bağlanır ve health, gerçek API CRUD, SQLite kalıcılığı, giriş doğrulaması ve güvenlik başlıkları için HTTP entegrasyon testleri içerir. Erişim günlükleri yalnızca tanınan rota adlarını yazar; sorgu dizeleri, keyfî URL yolları ve istek gövdeleri loglanmaz. Desteklenmeyen HTTP yöntemleri JSON 405 döndürür. Web güvenlik taraması kaynak kodu için sınırlı sezgisel kurallar ve mevcut ekosistem CLI denetimleri sunar; kapsamlı güvenlik denetiminin yerine geçmez.

## Bilinen sınırlar

- Ses araçları yalnızca denetlenir; bu sürümde sesli dikte veya sesli yanıt akışı etkin değildir. Araçlar kurulu değilse metin sohbet aynen çalışır.
- Sohbet geçmişi cihazda kalıcıdır ancak sınırlıdır: proje açık değilken son 200 mesaj, proje çalışma alanında son 100 mesaj saklanır; mesaj içeriği 40.000 karaktere kırpılır. Daha eski mesajlar sessizce atılır. Kişisel hafıza kayıtları proje gerekmeden kalıcıdır.
- Paralel alt ajan/alt görev yürütmesi yoktur; aynı proje için tek etkin görev çalışır.
- Görsel/çok kipli giriş, web araması ve PDF/RAG dizini yoktur.
- Kod imzalama yoktur; Windows SmartScreen paketleri çalıştırırken uyarabilir.

## Dosya keşif, yazılım envanteri ve eklentiler (bu sürüm)

Sağ panelde üç yeni sekme vardır: **Dosyalar**, **Yazılımlar**, **Eklentiler**.

**Dosyalar** — Türkçe doğal istekle gerçek dosya araması yapar: ad/içerik eşleşmesi, tür filtresi (pdf, docx, excel…), boyut ve tarih filtreleri, kopya dosya bulma, indeks yenileme ve arama geçmişi. Kapsam yalnızca açık proje ve açıkça yetkilendirilmiş kaynak klasörleridir; "bilgisayarın tamamını tara" gibi kapsam dışı istekler sahte sonuç üretmeden yönlendirilir. Kalıcı depolar kullanıcı veri klasöründedir: `file-index.json` (arama indeksi), `file-search-history.json` (arama geçmişi), `software-catalog.json` (yazılım kataloğu) ve `plugins.json` (eklenti durumu) aynı klasörde yazılır (`storeFileName` eşlemesi `electron/json-store.ts` içindedir).

**Yazılımlar** — Kayıt defteri (HKCU/HKLM kaldırma kayıtları), PATH ve Başlat menüsü kısayollarından gerçek yazılım envanteri üretir; sürüm testi (ör. `git --version`) çalıştırabilir, onaylı başlatma yapabilir. "PDF açamıyorum" gibi gereksinim cümleleri bilinen kapasite kataloğuyla sınanır; eksik araç için öneri adı/indirme adresi verilir, kurulum kullanıcıya bırakılır. Uygulama adaptörleri (git, VS Code, Node, Python, Rust/Cargo, Windows araçları) yalnızca envanterden doğrulanmış yollarla komut üretir; model komut üretmez.

**Eklentiler (v1)** — Yerel klasör veya `.zip` (kökünde `manifest.json`) kaynağından kurulur; çevrimiçi mağaza/MCP bu sürümde desteklenmez ve hiçbir yerde sahte liste üretilmez. Her eklenti ayrı alt süreçte (`resources/plugin-host.cjs`) çalışır; araçlar `plugin_<id>_<araç>` adıyla modele açılır, yalnızca doğrulanmış manifestteki izinler (storage/clipboard) verilir; ağ izni isteyen paketler bu sürümde etkinleştirilirken açıkça reddedilir. Güncellemede eski sürüm otomatik yedeğe alınır, geri alma ve tam kaldırma desteklenir. Depo: `plugins.json` (sürümlü), eklenti verileri `<userData>\plugin-data\<id>-storage.json`.

Bu üç motorun doğrulaması: `tests/file-search.test.ts`, `tests/software-discovery.test.ts`, `tests/app-adapters.test.ts`, `tests/plugin-manager.test.ts` (12), `tests/plugin-host.test.ts` (gerçek fork uçtan uca), `tests/integration-file-search.ts` ve `tests/integration-software-live.ts` (canlı tarama kanıtı) ile kurulu uygulamada `npm run test:smoke:installed:features`.

## Kurulum

Son paket `release/Ultron Setup 1.1.0.exe` (kurulum sihirbazı) ve `release/Ultron 1.1.0.exe` (taşınabilir) olarak üretilir. Sessiz kurulum:

```powershell
.\release\Ultron Setup 1.1.0.exe /S
```

Kurulum varsayılan olarak `%LOCALAPPDATA%\Programs\Ultron` altına yapılır ve masaüstüne **Ultron** kısayolu oluşturur. Kaldırma için Windows Ayarlar > Uygulamalar veya kurulum klasöründeki kaldırıcı kullanılabilir. Uygulama ilk açılışta kurulu Ollama modelini (`qwen3:8b`) seçer; model yoksa **Yerel AI** panelinde açık bir eksik-model mesajı gösterilir.

## Geliştirme ve paketleme

```powershell
npm ci
npm run dev
npm run typecheck
npm run build
npm run dist
```

`npm ci` sonundaki proje `postinstall` adımı, seçili Electron sürümünün masaüstü çalıştırıcısını resmi paket kurucusu ve checksum doğrulamasıyla hazırlar. Scriptler atlanarak kurulum yapıldıysa geliştirme/test öncesi `npm run setup:electron` çalıştırın; kurucu uygun çalıştırıcı zaten varsa tekrar indirmez.

Paketleme zincirindeki eski `@electron/get` sürümünün getirdiği `global-agent → roarr → sprintf-js` bağımlılıklarını ve [GHSA-hp3w-g68c-fv3c uyarısını](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) kaldırmak için `@electron/get` 5.1.0 sürümüne npm override uygulanır. Electron 44 de aynı sürümü kullanır. Bu sürüm Node.js 22.12.0 veya üzerini gerektirir. Override değiştirildiğinde kilit dosyasıyla temiz kurulum, `npm audit`, Windows paketleme ve paketli uygulama testi yeniden doğrulanmalıdır. Son denetimde geliştirme bağımlılıkları dahil `npm audit` 0 bulgu verdi; bu sonuç kaynak kodunun veya gelecekteki bağımlılık sürümlerinin bütünüyle güvenli olduğunu kanıtlamaz.

Kurulum sihirbazı ve taşınabilir `.exe` `release/` klasörüne yazılır. Yetki/path, hata analizi, bütçe, Android/Web yardımcıları, SQLite migration, görev günlüğü, hafıza deposu (benzerlik/çelişki/temizleme), sohbet sınıflandırması, kontrollü bağlam bütçesi ve kalıcı sohbet geçmişi doğrulaması (rol/içerik süzme, mesaj ve karakter sınırları, bozuk girdide boş liste) kuralları `npm run test:permissions` ile; arayüz, Ollama protokolü üzerinden gerçek dosya araç döngüsü, yerel model bağlantı hatası/geri bağlanma, kontrollü yavaş model ucu ile duraklatma, kapsam ekleme/iptali, onay, kategori izni, reddetme, iptal, başarısız komut, geri alma, otomatik çok dosyalı grup üretimi ve tek geri almayla toplu geri alma, Yerel AI paneli, kişisel profil, gerçek modelle sohbet modu (görev kaydı oluşturmadan), kişisel hafıza CRUD, "hatırla" komutu, otomatik öğrenme geri bildirimi, hafıza paneli ve ses aracı durumu `npm run test:smoke` ile doğrulanır. Paketli uygulama doğrulaması `npm run test:packaged` yerel Ollama modelini gerektirir ve gerçek modelin `read_file` ile dosyayı okuyup `propose_file_edit` taslağı hazırlamasını, onayla uygulamayı, değişikliği geri almayı, Yerel AI panelinin gerçek model/donanım verilerini göstermesini, kişisel profilin yerel ayarlarda kalmasını ve aynı sohbet/hafıza/ses denetimlerini paketli sürümde doğrular. `npm run test:installed` kurulu uygulamayı proje açmadan iki aşamada doğrular: ilk oturumda sohbet, "hatırla", hafıza paneli, ses durumu ve işaretli bir mesaj; ikinci oturumda uygulama aynı profil ve kullanıcı veri klasörüyle yeniden başlatılarak sohbet geçmişinin arayüze geri yüklendiği kontrol edilir; `npm run test:perf` kurulu uygulamada başlatma ve sohbet gecikmesini ölçüp ham sonucu `release/perf-last.log` dosyasına yazar ([performans raporu](docs/performance-report.md)). Birim testleri model, donanım uyumu, akıllı işlem motoru, hafıza benzerliği/çelişkisi, sohbet sınıflandırması, kontrollü bağlam bütçesi, kalıcı sohbet geçmişi, çevrimdışı kaynak envanteri ve güvenlik sınırlarını kapsar.
