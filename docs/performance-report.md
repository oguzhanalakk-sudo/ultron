# Performans raporu

Tarih: 2026-10-18

## Ölçüm ortamı

- Windows 11 x64, Intel Core i7-13620H, 16 GB RAM, 8 GB NVIDIA RTX 4060 Laptop GPU.
- Kurulu Ultron 1.1.0 (`%LOCALAPPDATA%\Programs\Ultron\Ultron.exe`), yerel model `qwen3:8b` (Ollama, loopback).
- Ölçümler geçici ve boş bir kullanıcı profiliyle, gerçek model üzerinden alındı.

## Yöntem

```powershell
npm run test:perf
```

Bu komut kurulu uygulamayı boş bir test profiliyle başlatır; süreç başlangıcından arayüzün hazır olmasına kadar geçen süreyi, gerçek modelle ilk sohbet yanıtının ilk parça ve tamamlanma gecikmesini, Ollama'nın gerçek `eval` metriklerini ve kontrollü bağlam bütçesinin temsili uzun geçmişte sağladığı kazancı ölçer. Sayılar yalnızca ölçülen değerlerdir; uydurulmaz. Ham çıktı `release/perf-last.log` dosyasındadır.

## Ölçülen sonuçlar (kurulu 1.1.0, son ölçüm oturumu — 18 Ekim 2026, sohbet kalıcılığı dahil)

| Ölçüm | Değer |
| --- | --- |
| Uygulama başlatma (süreç → arayüz hazır) | 1.998 ms |
| CDP bağlantısı → arayüz hazır | 40 ms |
| Sohbet ilk parça gecikmesi (gerçek model) | 654 ms |
| Sohbet tam yanıt gecikmesi (gerçek model) | 1.401 ms |
| Model içi süre (Ollama `eval`) | 1.325 ms · 42,59 token/sn · 32 token |
| Bellek (4 Electron işlemi toplam çalışma kümesi) | 429,5 MB |
| Birim test paketi | 147 test / ~2,5 sn (`npm run test:permissions`) |

## Kontrollü bağlam kazancı

Temsili 300 mesajlık uzun bir sohbet geçmişi için modele gönderilecek bağlam boyutu:

| Kural | Gönderilen bayt |
| --- | --- |
| Eski davranış (son 20 mesaj, bütçesiz) | 101.671 bayt |
| Yeni davranış (`trimConversationContext`: en fazla 20 mesaj / 24.000 karakter) | 20.335 bayt |

Bu senaryoda modele taşınan bağlam **%80 azaldı**; kısa sohbetlerde davranış değişmez ve en az son mesaj her koşulda gönderilir. Geçmiş her zaman bir kullanıcı mesajıyla başlar.

## Dürüstlük notları

- Başlatma ve sohbet gecikmesi; modelin bellekte yüklü olup olmamasına, disk ve GPU durumuna göre oturumdan oturuma değişir. Tablodaki değerler tek bir gerçek oturumun ölçümüdür; garanti edilen üst sınır değildir.
- Kontrollü bağlam değişikliği kısa sohbetlerin gecikmesini değiştirmez; kazanç, uzun geçmişlerde modele gönderilen veri hacmindedir ve yukarıdaki temsili senaryoyla ölçülmüştür.
- Ölçüm komutu tekrarlanabilir: `npm run test:perf` her çalıştırmada yeni bir boş profil kullanır ve ham sonucu loglar.
