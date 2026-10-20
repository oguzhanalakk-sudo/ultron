# Ultron Copilot Talimatları

## Proje bağlamı

- Ultron, Windows üzerinde çalışan Electron + TypeScript masaüstü kodlama ajanıdır.
- Ana süreç kodu `electron/`, renderer kodu `src/`, testler `tests/` altındadır.
- Uygulama yerel model sağlayıcılarını ve kontrollü araç yürütücülerini destekler.

## Geliştirme kuralları

1. Mevcut mimariyi koru; büyük bir yeniden yazım önermeden önce ilgili modülleri ve testleri incele.
2. Araç eklerken şema, parametre doğrulaması, izin kontrolü, gerçek yürütücü, hata biçimi ve sonuç doğrulamasını birlikte güncelle.
3. Renderer’dan keyfî işletim sistemi komutu çalıştırma. İşletim sistemi işlemlerini Electron ana sürecinde veya doğrulanmış IPC kanallarında yürüt.
4. `contextIsolation` ve güvenli preload sınırlarını devre dışı bırakma; `nodeIntegration` açma.
5. Dosya ve terminal işlemlerinde proje kapsamını, yol güvenliğini, zaman aşımını, iptali ve kullanıcı izinlerini koru.
6. Gizli anahtarları, token’ları veya kullanıcı verilerini kaynak koda, loglara, test çıktısına ya da commit’e yazma.
7. Git işlemlerinde kullanıcı değişikliklerini ezme, zorla push yapma ve ana dala doğrudan gönderimi varsayma. Geri döndürülemez işlemler için açık onay iste.
8. Bir işlemi başarılı olarak bildirmeden gerçek yürütme sonucunu ve mümkünse sistem durumunu doğrula.
9. Yeni davranış için önce birim testi ekle. Değişiklikten sonra `npm run typecheck` ve ilgili testleri çalıştır; çalıştırılmamış testleri başarılı gösterme.
10. Windows’a özel özellikleri başka işletim sistemlerinde çalışıyormuş gibi sunma; desteklenmeyen durumları açıkça raporla.

## Kod stili

- TypeScript strict ayarlarını ve mevcut biçimlendirmeyi koru.
- Hataları kullanıcıya anlamlı, kısa ve gerçek hata mesajıyla döndür.
- Gereksiz bağımlılık ekleme.
- Değişiklik özetinde etkilenen dosyaları, testleri ve kalan sınırlamaları belirt.

## Commit ve inceleme

- Küçük ve açıklayıcı commit’ler kullan.
- Güvenlik, izin ve araç yürütme değişikliklerini ayrı ve incelenebilir tut.
- Pull request açıklamasında riskleri, doğrulama adımlarını ve geriye dönük etkileri yaz.

## Tam depo inceleme ve geliştirme görevi

Copilot’tan genel bir öneri istendiğinde yalnızca açık olan dosyaya bakma. Aşağıdaki sırayı izle:

1. `README.md`, `package.json`, `electron/`, `src/`, `tests/`, `docs/`, `samples/` ve `.github/` klasörlerini incele.
2. Araç şemalarını gerçek yürütücülerle, IPC kanallarını preload API’leriyle ve renderer çağrılarını ana süreç işleyicileriyle karşılaştır.
3. Çalışmayan, erişilemeyen, yalnızca tanımlanmış veya test edilmemiş özellikleri kanıtlarıyla listele.
4. Güvenlik, veri kaybı, yanlış başarı bildirimi, zaman aşımı ve performans sorunlarını önem sırasına koy.
5. Her düzeltmeyi mevcut mimariye uygun, küçük ve geri alınabilir bir değişiklik olarak uygula; gereksiz yeniden yazımdan kaçın.
6. Her değişiklik için ilgili birim veya entegrasyon testini ekle ya da güncelle.
7. En az `npm run typecheck` ve değişen alanın testlerini çalıştır. Uygun olduğunda tam test paketini de çalıştır.
8. Sonuçta değişen dosyaları, tespit edilen sorunları, test komutlarını ve kalan eksikleri açıkça raporla.

Bir dosyanın amacını veya bir özelliğin çalışma durumunu varsayma; kaynak kodu ve test çıktısıyla doğrula. Kullanıcı “tamamını geliştir” dediğinde bu inceleme ve doğrulama döngüsünü depo genelinde uygula.
