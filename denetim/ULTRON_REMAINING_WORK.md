# ULTRON KALAN İŞ VE ENGELLER

> Dürüst liste: bu denetim bitiminde ÇALIŞAN özellikler dışında kalan, çözülemeyen veya sonraki iş gerektiren maddeler.

## ✅ Bu turda tamamlanan (önceki 'Sonraki iş' listesinden)

- **Uzman alt ajanlar (Aşama 4/8/13):** `delegate_to_specialist` aracı + 5 rol (planner/coder/analyst/tester/reviewer) + rol-bazlı araç alt kümeleri + sınırlı tur (max 8) alt döngü `runSpecialistSubtask` eklendi; typecheck 0; build başarılı; kurulu pakette smoke test geçti.
- **Hata sınıflandırma genişletildi (Aşama 7/9):** Python/Node modül hataları (`ModuleNotFoundError`, `ImportError`, `module_not_found`) → `dependency`; `IndentationError` → `syntax`; `NameError`/`AttributeError`/`UnboundLocalError` → `runtime`. 4 yeni birim vaka; 237/237 PASS.
- **HEDEF A — Gerçek uygulama:** `samples/web-taskboard` (Kod Atölyesi Görev Alanı) zaten tam işlevsel; 10/10 test PASS; REST CRUD + SQLite + güvenlik başlıkları + loopback güvenliği. Ultron araçlarıyla geliştirilebilir durumda.
- **Audit-live 8 senaryo:** 8 PASS / 7 PARTIAL-honest (web arama, OS Notepad açma, var olmayan dosya dürüst miss, undo, çözüm hafızası kanıtlı; otonom fix bu koşumda üretilmedi — Model qwen3:8b, specialist sub-agent ile bir sonraki iterasyonda ölçülecek).

## Çözülemeyen / engelli

1. **Git yok** (makineye kurulu değil): dal/commit yönetimi yapılmıyor; geri dönüş = `codexx-backup-audit` (297 dosya tam kopya). kullanıcı sürüm yönetimi isterse git kurulup `git init + commit` yapılmalı (izin: sadece kurulum).
2. **Anahtarlı arama sağlayıcıları canlı doğrulanamadı**: kullanıcı API anahtarı verirse `userData/web-research-providers.json` ile yapılandırma hazır; denetim, anahtarsız DDG-yedeği doğruladı. Test kontrol: web_search sonucuna "sağlayıcı notu" alanı.
3. **Bu denetimde çevrimdışı testi yapılmadı**: gerçek kullanıcı bağlantısını kısmak riskli; çevrimdışı davranış tasarımı (yerel teşhis devam + dürüst not) kod düzeyinde mevcut; canlı doğrulama için kullanıcı onayı gerekir (ağ adapter kapatma). -> BLOCKED (izin).

## Sonraki iş (öncelikli)

1. **Masaüstü arama gecikmesi** (~9–14 sn → amaç <2 sn): arama akışını kapsam bilinçli indeks kullanımıyla hızlandırmak + kısmi tarama.
2. **Araştırma sonuçları kalıcı disk önbelleği**: TTL önbellek şu an bellek-içi; uygulama yeniden başlatınca silinir. json-store'a taşınabilir.
3. **Araştırma panel**: kullanıcıya 'Kaynak Gösterim' listesi (tıklanabilir link'ler) UI'de ayrı görünüm olarak; şu an sohbet metninde yer alıyor.
4. **Görev bitiminde çözüm hafızası UI**: kayıt görüntüleme/silme arayüzü; şu an tool + dosya katmanı.
5. **real-warm latency ölçüm senaryosu** (REQ-H03): model yükleyip doğrudan agent chat ölçüm senaryosu eklemek.
6. **Otonom kod düzeltme oranı**: specialist sub-agent (coder rolü) eklendi; bir sonraki iterasyonda audit-live senaryo 1'de ölçülecek.
7. **Ses entegrasyonu**: önceki talimatla 'detay yalnız tespit' — ses yeterli; tam entegrasyon istenirse ek iş.

## Kullanıcıdan beklenen izin/işlem

- API anahtarı (Brave/Tavily vb.) sağlarsa: `userData/web-research-providers.json` dosyasına kayıt (UI sonrasında ekstra; bugünün testi DDG yedeğiyle).
- Ağ çevrimdışı senaryo için ağ kapatma onayı.
- Git kurulum izni (sürüm yönetimsel rahatlar).