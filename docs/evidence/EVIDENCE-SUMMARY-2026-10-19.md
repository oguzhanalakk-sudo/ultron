# Ultron Audit Evidence — 2026-10-19

Bu dosya, denetim raporundaki iddiaların komut ve çıktı kanıtlarını toplar. Kaynak kod değiştirilmemiştir.

## 1. Tip kontrolü

Komut:

```powershell
cmd /c "npm run typecheck"
```

Sonuç: **başarılı**, çıkış kodu 0. `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json` hatasız tamamlandı.

## 2. Üretim derlemesi

Komut:

```powershell
cmd /c "npm run build"
```

Sonuç: **başarılı**, çıkış kodu 0.

- `out/main/main.js` — 697.54 kB
- `out/preload/preload.cjs` — 5.63 kB
- `out/renderer/assets/index-80_RQRJ4.js` — 1,398.47 kB
- `out/renderer/assets/index-BDWf9vAV.css` — 65.67 kB

## 3. Birim/entegrasyon test paketi

Komut:

```powershell
cmd /c "npm run test:permissions"
```

Sonuç (2026-10-19, bu denetimde yeniden çalıştırıldı):

```text
# tests 276
# suites 0
# pass 276
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 5896.3203
```

Tam çıktı: `docs/evidence/unit-tests-2026-10-19.txt`.

Not: Bu paket `main.ts`, `runAgent`, IPC güvenlik doğrulaması, yedek/geri alma ve canlı Git akışını doğrudan kapsamaz.

## 4. UI smoke — BAŞARISIZ

Komut:

```powershell
cmd /c "npm run test:smoke"
```

Sonuç: **başarısız**, çıkış kodu 1. Build başarılı oldu; `tests/ui-smoke.mjs` şu iddiada düştü:

```text
AssertionError [ERR_ASSERTION]: Yerel Qwen görevi tamamlanmalı
+ actual - expected
+ 'failed'
- 'completed'
```

Görev:

- Proje: `tests/.codex-smoke-df55602c56e24bfc8191c0d67da41f22/demo`
- Durum: `failed`
- Aşama: `failed`
- Araçlar: `read_file`, `propose_file_edit`
- Plan: 3 adım, tamamlanan 0, bekleyen 3
- Hata: `Model yanıtı üst üste 3 turda araç çağrısı içermedi; 3 plan adımı açık. Gerçek dosya ve test işi korunuyor; görev doğrulama bekliyor olarak sonlandırılıyor.`
- `errorAnalysis.category`: `unknown`
- `toolCalls`: 2

Kök neden (statik):

- `main.ts:4327-4328` boş tur sınırında `throw` ediyor.
- `main.ts:4504` yakalama yolunda durumu doğrudan `failed` yapıyor.
- `main.ts:4489` tamamlanmış iş listesinde `propose_file_edit` yok; yalnızca `read_file`/`propose_file_edit` kullanan taslak görevi "gerçek iş" sayılmıyor.
- `agent-orchestrator.ts:148-151` yorumu `needs_review` diyor; uygulama ise hata fırlatıp `failed` üretiyor.

Tam çıktı: `docs/evidence/ui-smoke-failure-2026-10-19.txt`.

Not: Bu testteki “Yerel Qwen” adı test etiketidir; test gerçek Ollama/Qwen yerine `smoke-agent-model` adlı yerel mock sunucuyu kullanır. Gerçek modelle yapılan ayrı kanıt Demo #5’tir ve o da başarısızdır.

## 5. Canlı ajan demosu (Demo #5) — BAŞARISIZ

Proje: `%TEMP%\opencode\ultron-demo-notepad-mvfb9j6s`
Görev kimliği: `a250d5b9-1d4d-42b6-90e5-e59b08db9c23`

Sonuç: **failed**.

- Başlangıç: `2026-10-19T13:49:36.377Z`
- Bitiş: `2026-10-19T14:15:26.260Z`
- Toplam: yaklaşık 25 dk 50 sn
- Araç çağrısı: 6
- Plan: 3 adım hâlâ `pending`
- Düzeltme denemesi: 0
- Unit test: 3/3 geçti (`Ran 3 tests ... OK`)
- Buna rağmen görev tamamlanmadı.

Arıza zinciri:

1. Ajan `run_command` ile `python windows-projects/not-defteri/main.py` çalıştırdı.
2. Kurulu build'de `run_command` 15 dakikalık zaman aşımına sahipti; GUI süreci çıkmadı ve komut zaman aşımına uğradı.
3. Kurulu build'in dönen çıktısı yalnızca `Komut çıkış kodu: -2` içeriyordu; `[zaman aşımı]` işareti yalnızca UI olayına yazılıyordu. `analyzeAgentError` bu metni `resources` değil `unknown` sınıfına aldı.
4. Başarısız `run_command` doğrulama defterinde kalıcı bir başarısızlık kaydı oluşturdu.
5. Aynı komutun yeniden başarılı çalıştırılması dışında bu kayıt temizlenmiyor; başarılı `run_tests` farklı anahtar olduğu için eski hatayı temizlemedi.
6. Son model çağrısı 3 × 120 sn denemeyle zaman aşımına uğradı; hata `resources` olarak sınıflandı ve görev `failed` oldu.

Kanıt dosyaları:

- `docs/evidence/agent-flow-demo-2026-10-19.json`
- `docs/evidence/agent-flow-demo-2026-10-19.png`
- `docs/evidence/agent-flow-demo-2026-10-19-tasks.json`

Not: Demo #5, `run_tests` 3/3 geçmesine rağmen tamamlanmadı; bu, testlerin varlığının tek başına tamamlanma kanıtı sayılmadığını gösteren gerçek bir başarısızlık kanıtıdır. Demo başarılı E2E doğrulaması olarak sayılmamalıdır.

### 5.1 Hesap makinesi görevi (gerçek kurulu uygulama)

Proje: `C:\Users\user\Desktop\Yeni klasör`  
Görev kimliği: `b9a9ed70-3bb5-497a-80c8-944506002a1c`  
İstek: `bir hesap makinesi  uygulaması yapalım`  
Sonuç: **failed**.

- Başlangıç: `2026-10-19T14:06:45.265Z`
- Bitiş: `2026-10-19T14:15:40.133Z` (yaklaşık 8 dk 55 sn)
- Plan: 3 adım (klasör, `calculator.ts`, `main.ts`); tamamlanan 0, bekleyen 3
- Araç çağrısı: 3
- Araçlar: `list_files:completed` (mevcut VPN/Android ağacı), `read_file:completed` (`AndroidManifest.xml`), `read_file:failed` (olmayan `...\mobileconnectionapp\MainActivity.java`)
- `write_file`, `apply_patch`, `propose_file_edit`, `create_directory`, `create_*_project` veya `run_tests`: **hiç çağrılmadı**
- Son hata: `resources: The operation was aborted due to timeout` (aşama `evaluating`)

Gözlenen nedenler:

1. Aynı çalışma alanındaki `workspace.json` mesajlarında önceki VPN/MainActivity görevi duruyordu; hesap makinesi isteği bu eski bağlamla birlikte modele gitti. Model kendi planındaki `calculator.ts`/`main.ts` yerine eski Android dosyalarını okumaya başladı.
2. Plan adımları araç çağrılarına bağlanmıyor; model `list_files`/`read_file` ile ilerlemeyi “çalışma” sayabiliyor. Görevde hiç dosya yazma aracı çağrılmadı.
3. Yerel model isteği 3 × 120 sn denemeyle zaman aşımına uğradı (`streamCompletion`, `main.ts:3463-3489`); son araçtan sonra yaklaşık 6 dk 23 sn model yanıtı beklenmiş görünüyor.
4. `read_file` ENOENT hatası `network` olarak sınıflandırıldı; modelin doğru dosyaya dönmesi için yanlış kurtarma sinyali üretildi.

Bu vaka, “8B model hesap makinesi yazamıyor” değil, “ajan kod yazma adımına hiç geçmedi” vakasıdır. Kanıt: aynı projedeki `tasks.json` ve `workspace.json`.

## 6. Kurulu build ile kaynak farkı

- Kurulu uygulama: `%LOCALAPPDATA%\Programs\Ultron\Ultron.exe`
- Kurulu `app.asar`: 16:33:34 (yerel saat), 19.10.2026
- Kurulu asar içindeki `run_command` dağıtımı, yeni 3 dakikalık sınırı ve yeni açıklamayı içermiyor; eski 15 dakikalık davranışı kullanıyor.
- Kaynakta `main.ts:3669-3674` yeni 3 dakikalık sınırı içeriyor.
- Demo #5 kurulu build ile çalıştırıldığı için yeni sınırı test etmedi.

## 7. Git ve CI

- `git` bu ortamda PATH'te yok; `.git/HEAD` `master` işaret ediyor, ref sayısı 0, commit yok.
- Bu nedenle canlı `git_branch`/`git_commit` doğrulanamadı.
- `.github/workflows/ci.yml` var; GitHub üzerinde çalıştırılmadı. Yerel olarak yalnızca tip kontrolü, build ve test paketi çalıştırıldı.
- `git_commit` uygulaması `git add -A` kullanıyor; test/derleme ve dal doğrulaması yapmıyor.

## 8. Kurulu uygulamada sağlayıcı kontrolü

Komut:

```powershell
node tests/installed-provider-check.mjs
```

Sonuç (19.10.2026, bu denetimde yeniden çalıştırıldı):

```text
SAGLAYICI-KONTROL: GECTI
MODELS-ISTEGI: 2
CHAT-ISTEGI: 1
DELTA: Merhaba dünya
```

Bu test, kurulu uygulamayı yerel bir sahte OpenAI uyumlu sunucuya bağlar; gerçek bir bulut sağlayıcısına ağ çağrısı yapmaz. Sağlayıcı seçimi, `/models`, sohbet akışı ve API anahtarının ayarlar dosyasına sızmaması doğrulanmıştır. Gerçek bulut sağlayıcısı ve gerçek API anahtarı bu denetimde test edilmemiştir.

## 9. Hassas dosya arama runtime kanıtı

Komut:

```powershell
node --experimental-strip-types docs/evidence/file-search-sensitive-audit.mjs
```

Sonuç (19.10.2026, bu denetimde çalıştırıldı):

```text
{
  "queryText": "içinde FAKE_AUDIT_SECRET geçen dosyalar",
  "hits": [
    {
      "relativePath": ".env",
      "snippets": [
        "API_TOKEN=FAKE_AUDIT_SECRET"
      ]
    }
  ]
}
{
  "queryText": "içinde TASK_INTERNAL_SECRET geçen dosyalar",
  "hits": [
    {
      "relativePath": ".codex-local/tasks.json",
      "snippets": [
        "{\"note\":\"TASK_INTERNAL_SECRET\"}"
      ]
    }
  ]
}
```

Bu, `scanDirectoryForQuery` / `runFileSearchFlow` / `search_file_contents` / `find_files` yolunun `.env` ve `.codex-local` içeriğini döndürebildiğini kanıtlar. Test yalnızca sahte değerler kullanır; gerçek secret yoktur. `read_file` ve `files:preview` için mevcut `validateRelativePath`/`excludedDirectories` koruması ayrıca statik olarak incelenmiştir; bu script onları test etmez.

Kanıt dosyaları: `docs/evidence/file-search-sensitive-audit.mjs`, `docs/evidence/file-search-sensitive-audit-output.txt`.

## 10. Test kapsamı boşlukları

- `main.ts` / `runAgent` için doğrudan test yok.
- IPC `assertTrustedIpcSender` için test yok.
- Yedek/geri alma (`undoLast`, `.codex-local/undo.json`) için test yok.
- Canlı Git için test yok.
- Kurulu build'in yeni 3 dakikalık `run_command` davranışı için test yok.
- `search_file_contents` / `files:search` / `files:preview` için otomatik regresyon testi yok; denetim script'i arama bypass'ını gösterdi (bkz. bölüm 9).
