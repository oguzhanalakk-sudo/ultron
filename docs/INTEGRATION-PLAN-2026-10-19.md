# Ultron Entegrasyon ve Dönüşüm Planı

**Tarih:** 19 Ekim 2026  
**Dayanak:** `docs/ARCHITECTURE-AUDIT-2026-10-19.md`  
**İlke:** Önce çalışan sistemi koru; her katmanı gerçek test ve ölçümle doğrula; doğrulanmamış hiçbir yeteneği “tamamlandı” olarak raporlama.

---

## 1. Tasarım ilkeleri

1. **Yerel-öncelikli:** Varsayılan sağlayıcı Ollama/qwen3:8b. Bulut yalnızca kullanıcı açıkça yapılandırırsa.
2. **Sağlayıcıdan bağımsız çekirdek:** Ajan döngüsü, araçlar ve doğrulama tek bir sağlayıcıya bağlı olmamalı.
3. **İnce adaptör:** Ağır SDK/framework yerine HTTP/CLI adaptörleri; lisans ve bakım riski düşük tutulur.
4. **Güvenli varsayılan:** API anahtarı yoksa bulut kapalı; MCP kapalı; Git birleştirme otomatik değil; buluta otomatik yükleme yok.
5. **Kanıt zorunlu:** “Test geçti” ancak gerçek komut çıkışıyla; “adım bitti” ancak kanıt kimliğiyle.
6. **Geri alınabilirlik:** Her yazma öncesi yedek; dal/commit; çok dosyalı işlem günlüğü.
7. **Model zekâsı ≠ mühendislik:** 8B yerel modelin ham akıl yürütme kapasitesi frontier modellerle eşit değildir. Eşitlenecek olan **iş akışı, araç disiplini ve doğrulamadır**; bu raporda bu ayrım korunur.

---

## 2. GitHub projeleri değerlendirmesi

Veriler GitHub REST API'den 19 Ekim 2026'da alındı; ayrıntılar `docs/research/github-projects-2026-10-19.json` dosyasındadır. “Son push” bakım sinyalidir, tek başına kalite garantisi değildir.

| Proje | Lisans (API) | Arşiv | Son push | Karar |
|---|---|---|---|---|
| OpenHands/OpenHands | MIT | Hayır | 2026-10-19 | **Referans** — ajan mimarisi, sandbox ve görev akışı |
| anomalyco/opencode | MIT | Hayır | 2026-10-19 | **Referans** — CLI/TUI, araç düzeni, oturum yönetimi |
| Aider-AI/aider | Apache-2.0 | Hayır | 2026-05-22 | **Referans** — Git tabanlı düzenleme/commit yaklaşımı; kod kopyalanmaz |
| cline/cline | Apache-2.0 | Hayır | 2026-10-19 | **Referans** — IDE ajanı, onay akışı |
| openai/codex | Apache-2.0 | Hayır | 2026-10-19 | **Referans** — planlama/araç protokolü |
| google-gemini/gemini-cli | Apache-2.0 | Hayır | 2026-10-19 | **Referans** — CLI oturum modeli |
| block/goose | Apache-2.0 | Hayır | 2026-10-19 | **Referans** — MCP tabanlı genişletilebilirlik |
| SWE-agent/SWE-agent | MIT | Hayır | 2026-10-12 | **Referans** — benchmark/issue çözme döngüsü |
| SWE-agent/mini-SWE-agent | MIT | Hayır | 2026-10-12 | **Referans** — minimal ajan döngüsü |
| NousResearch/hermes-agent | MIT | Hayır | 2026-10-19 | **Referans** — araştırma/araç kullanımı |
| OpenInterpreter/open-interpreter | Apache-2.0 | Hayır | 2026-10-11 | **Referans** — yerel kod yürütme; güvenlik riski nedeniyle doğrudan alınmaz |
| langchain-ai/langgraph | MIT | Hayır | 2026-10-19 | **Referans** — durum grafiği fikri; Python bağımlılığı alınmaz |
| langchain-ai/langchain | MIT | Hayır | 2026-10-19 | **Referans** — entegrasyon kataloğu |
| pydantic/pydantic-ai | MIT | Hayır | 2026-10-19 | **Referans** — tipli ajan çıktıları |
| microsoft/autogen | CC-BY-4.0 (API) | Hayır | 2026-10-16 | **Referans** — çoklu ajan desenleri; lisans dosya bazında doğrulanmadan kod alınmaz |
| crewAIInc/crewAI | MIT | Hayır | 2026-10-19 | **Referans** — rol/ekip deseni |
| microsoft/semantic-kernel | MIT | Hayır | 2026-10-19 | **Referans** — .NET/C# tarafı |
| modelcontextprotocol/servers | NOASSERTION (karma) | Hayır | 2026-10-19 | **Protokol referansı** — sunucu kodu kopyalanmaz; her sunucunun lisansı ayrı kontrol edilir |
| microsoft/playwright | Apache-2.0 | Hayır | 2026-10-19 | **Alt süreç/bağımlılık** — tarayıcı testi için `playwright-core` zaten var |
| browser-use/browser-use | MIT | Hayır | 2026-10-17 | **Referans** — ajan-tarayıcı deseni; Python bağımlılığı alınmaz |
| ollama/ollama | MIT | Hayır | 2026-10-19 | **Mevcut alt süreç** — yerel model motoru |
| BerriAI/litellm | NOASSERTION | Hayır | 2026-10-19 | **İsteğe bağlı dış ağ geçidi** — paketlenmez; kullanıcı isterse ayrı servis |
| vllm-project/vllm | Apache-2.0 | Hayır | 2026-10-19 | **Referans** — GPU sunucusu; bu donanım için gerekli değil |
| huggingface/transformers | Apache-2.0 | Hayır | 2026-10-19 | **Referans** — model eğitimi/çıkarımı; uygulamaya gömülmez |
| huggingface/peft | Apache-2.0 | Hayır | 2026-10-19 | **Referans** — LoRA/eğitim; model ağırlığı güncelleme kapsam dışı |
| ggml-org/llama.cpp | MIT | Hayır | 2026-10-19 | **Referans** — alternatif yerel motor |

### Neden ağır framework'ler doğrudan alınmıyor?

- Ultron zaten Electron/Node/TypeScript; LangGraph, AutoGen, CrewAI, Pydantic AI, Semantic Kernel Python/.NET çalışma zamanı gerektirir. İkinci bir süreç katmanı, paketleme ve bakım maliyeti getirir; mevcut görev döngüsüne ölçülebilir katkı sağlamaz.
- LiteLLM yararlı bir ağ geçididir ancak lisans meta verisi “NOASSERTION”; ayrıca yerel Ollama zaten OpenAI uyumlu bir uç sunar. İhtiyaç hâlinde **dış servis** olarak belgelenir, uygulamaya gömülmez.
- vLLM/llama.cpp/Transformers/PEFT, model eğitimi veya yüksek verimli çıkarım içindir. Bu bilgisayarda 8B model Ollama ile çalışıyor; model ağırlığı eğitmek bu görevin kapsamı değildir.

---

## 3. Hedef mimari

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (React)                                            │
│  Sohbet · Plan · Diff · İşlemler · Hafıza · Ayarlar          │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (preload, dar yüzey)
┌──────────────────────────▼──────────────────────────────────┐
│ Ana süreç                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Provider     │  │ Agent        │  │ Tool Manager     │   │
│  │ Registry     │  │ Orchestrator │  │ registry+policy  │   │
│  │ Ollama/OpenAI│  │ plan/verify  │  │ core/platform/MCP│   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                 │                   │             │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌────────▼─────────┐   │
│  │ Secrets      │  │ Task Store   │  │ Git / Test /     │   │
│  │ userData/env │  │ state machine│  │ Browser / MCP    │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Memory: kullanıcı + proje + görev + çözüm + dışa aktar│   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Model sağlayıcı katmanı

**Arayüz (kavramsal):**

```ts
type ModelProviderId = 'ollama' | 'openai-compatible'

interface ProviderConfig {
  id: ModelProviderId
  baseUrl: string       // Ollama: loopback; OpenAI uyumlu: https veya loopback http
  model: string
  apiKeyConfigured: boolean
}
```

- **Ollama:** Mevcut `/api/chat` NDJSON akışı korunur.
- **OpenAI uyumlu:** `POST {baseUrl}/chat/completions`, `stream: true`, SSE; `delta.content` + `delta.tool_calls` birleştirilir; `[DONE]` ve hata olayları işlenir.
- **Araç şeması:** OpenAI `tools` biçimi mevcut şemaya yakın; dönüşüm tek bir adaptörde yapılır.
- **Anahtar:** `ULTRON_OPENAI_API_KEY` ortam değişkeni veya `userData/provider-secrets.json`; `settings.json` içine **asla** yazılmaz. Renderer'a yalnızca `apiKeyConfigured: boolean` döner.
- **URL politikası:** Ollama yalnızca loopback. OpenAI uyumlu https; http yalnızca loopback. Kullanıcı adı/parola/query/fragment yasak; yönlendirme takip edilmez; 120 sn zaman aşımı.
- **Hata yönetimi:** 401/403 → anahtar/izin; 404 → model yok; 429 → kota/hız; 5xx/ağ → sınırlı yeniden deneme; yanıt gövdesi 500 karakterle sınırlı ve maskelenir.
- **Geri dönüş:** Sağlayıcı çalışmazsa kullanıcıya net hata; otomatik olarak başka sağlayıcıya **gizlice** geçilmez. İsteğe bağlı “yerel yedeğe dön” yalnızca kullanıcı onayıyla.

### 3.2 Ajan yöneticisi ve rol profilleri

- Tek yürütme döngüsü korunur (8B modelde paralel alt ajan güvenilir değil).
- Rol profilleri sistem istemine eklenir: **Planlayıcı, mimar, kodlayıcı, hata analizcisi, testçi, kalite denetçisi, araştırmacı, görev yöneticisi.**
- Her rolün çıktı sözleşmesi: plan → dosya/değişiklik → test → kanıt → rapor.
- Gelecekte alt ajanlar için ayrı süreç/oturum; bu sürümde yalnızca rol profilleri.

### 3.3 Araç yöneticisi

- Araç kayıt defteri: ad, şema, izin kategorisi, çıktı sınırı, keşif/eylem sınıfı.
- **Çekirdek araçlar** her zaman; **platform araçları** niyete göre; **MCP/tarayıcı** yalnızca açıkça etkinleştirilince.
- Bağlam koruması: araç şeması boyutu ölçülür; ilgisiz araçlar elenir; büyük sonuçlar özetlenir.
- MCP: `mcp_<server>_<tool>` ad alanı; stdio JSON-RPC; sunucu başına zaman aşımı; süreç ölünce temizlik; çıktı güvenilmeyen veri.
- Tarayıcı: `playwright-core` + sistem Chrome/Edge; yalnızca loopback URL'ler; ekran görüntüsü + konsol + ağ hatası; keyfi internet gezinmesi yok.
- Git: sistem `git` CLI; dal açma, commit, diff, geri dönüş; force-push ve otomatik merge yok.

### 3.4 Kalıcı hafıza

Mevcut katmanlar korunur:
- Kullanıcı hafızası (`memory.json`, en fazla 400 kayıt).
- Proje hafızası (özet, mimari, teknolojiler, komutlar, tercihler, bilinen sorunlar).
- Görev geçmişi (`.codex-local/tasks.json`, doğrulama makbuzları).
- Çözüm hafızası (`solution_memory`).

Eklenecekler:
- JSON **dışa aktarma/içe aktarma** (sanitize edilmiş).
- Kayıt saklama/silme politikası ve arama.
- Embedding tabanlı semantik hatırlama **opsiyonel**; 8B model + yerel embedding modeli gerektirir, bu sürümde zorunlu değil.

### 3.5 Görev durum makinesi

Mevcut `status` + `stage` yeterli temel. Eklenecekler:
- Her geçiş için olay kaydı ve zaman damgası.
- Adım kanıtı: `step-N` → kabul komutu/dosya parmak izi.
- Çökme sonrası devam: çok dosyalı işlem grubu için kalıcı günlük.
- Bulut kuyruğu: `pending` / `uploaded` / `running` / `result`; internet yokken yerel devam.

### 3.6 Doğrulama

Mevcut `agent-verification.ts` güçlü. Eklenecekler:
- Adım → kanıt bağı; kaynak değişince kanıtı geçersiz sayma (mevcut makbuz tazeliği genişletilir).
- Çok dosyalı grup işlem günlüğü ve kurtarma.
- Boş model yanıtında gerçek işi `failed` yerine `needs_review` olarak koruma.
- Rapor dili: yapılan / doğrulanan / yapılmayan ayrımı zorunlu.

### 3.7 Bulut ve ücretsiz kaynaklar

| Hizmet | Doğrulanan koşul | Ultron'da kullanım |
|---|---|---|
| GitHub Actions | Genel depolar + standart runner **ücretsiz**; özel depolar Free planda **2.000 dk/ay**, 500 MB artifact, 10 GB cache. Ödeme yöntemi yoksa kota bitince kullanım durur. | CI şablonu; gizli anahtar yok; otomatik yükleme yok |
| Google Colab | Ücretsiz; kaynaklar **garanti değil**, GPU kısıtlı, en fazla ~12 saat, SSH/uzak masaüstü yasak. | İsteğe bağlı, kullanıcı başlatmalı deney/benchmark; sürekli sunucu değil |
| Hugging Face Spaces | CPU Basic (2 vCPU/16 GB) ücretsiz; ZeroGPU ücretsiz ama kota/öncelik değişken; PRO $9/ay. | Demo/deney; sürekli çalışma garantisi yok |
| HF Hub | Genel depolama ücretsiz katman; özel kotalar plana bağlı. | Yalnızca kullanıcı açıkça isterse; özel kod/anahtar yüklenmez |

**Kaynaklar:**
- GitHub Actions faturalandırma: https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions (19 Ekim 2026'da okundu)
- Colab SSS: https://research.google.com/colaboratory/faq.html (19 Ekim 2026'da okundu)
- HF fiyatlandırma: https://huggingface.co/pricing (19 Ekim 2026'da okundu)

**Kural:** Ücretsiz kotayı aşan veya süreklilik garantisi olmayan hiçbir hizmet “kesintisiz sunucu” olarak sunulmaz.

### 3.8 Kendi kodunu geliştirme

- Akış: mevcut mimariyi analiz et → gerekçeli öneri → ayrı dalda diff → testler → önceki sürümle karşılaştır → başarısızsa geri al → raporla.
- Otomatik merge yok; güvenlik/kimlik/geri alma kodunu kaldıran değişiklikler otomatik birleştirilmez.
- Kendi kaynak kodunu değiştirmek, model ağırlıklarını eğitmek **değildir**; raporda bu ayrım açıkça yazılır.
- Çalışan kurulu uygulamanın üzerine yazma yok; önce paketleme ve test.

---

## 4. Aşamalar ve kabul ölçütleri

### Aşama 0 — Stabilizasyon (P0)

**İşler:**
- Boş Ollama yanıtı için tanılama (done_reason, prompt_eval, eval) ve görev kaydına yazma.
- Token farkındalıklı bağlam bütçesi; 16k/24k bağlam denemesi; araç şeması küçültme.
- Gerçek iş varken boş yanıt → `needs_review` (asla sessizce `failed` değil).
- Demo yeniden çalıştırma; 3/3 test + `needs_review`/`completed` kanıtı.

**Kabul:** Aynı not defteri görevi en az bir kez `completed` veya gerekçeli `needs_review`; testler gerçekten çalışmış; hata tanılaması kayıtlı.

### Aşama 1 — Sağlayıcı katmanı

**İşler:**
- `ModelProvider` genişletmesi; `openai-compatible` SSE adaptörü.
- `provider-secrets.json` + env; maskeleme; URL politikası.
- Ayarlar arayüzünde sağlayıcı seçimi, anahtar alanı, model listesi.
- Ollama davranışı aynen korunur; varsayılan değişmez.
- Birim testleri + sahte OpenAI sunucusuyla entegrasyon testi.

**Kabul:** Ollama ile mevcut testler geçer; sahte OpenAI uyumlu sunucuya akış/tool-call çalışır; anahtar hiçbir log/settings/renderer yanıtında görünmez; anahtarsız bulut isteği net hata verir.

### Aşama 2 — Git iş akışı + adım kanıtı

**İşler:**
- Git varlık denetimi; yoksa net hata ve kurulum yönlendirmesi.
- `git_create_branch`, `git_commit`, `git_restore` (güvenli), dal adı doğrulama.
- Görev dalı `ultron/<task-id>`; commit mesajı; force-push yok.
- `update_task_step` → kanıt kimliği; kanıtsız `done` reddedilir.
- Çok dosyalı işlem günlüğü (crash recovery).

**Kabul:** Temiz bir depoda dal aç → dosya değiştir → test → commit → geri dönüş senaryosu gerçek Git ile geçer; kanıtsız adım kapanmaz.

### Aşama 3 — MCP + tarayıcı

**İşler:**
- Minimal stdio MCP istemcisi (initialize, tools/list, tools/call), allowlist, zaman aşımı.
- MCP sunucu yapılandırması (varsayılan kapalı); araç adı alanı.
- Playwright tabanlı `browser_check` (loopback, ekran görüntüsü, konsol).
- Bağlam bütçesine MCP araçlarını dahil etme.

**Kabul:** Sahte MCP sunucusuyla araç listeleme/çağırma; gerçek yerel web uygulamasında Playwright ile sayfa yükleme + hata yakalama; güvenlik testleri.

### Aşama 4 — Hafıza + bulut CI

**İşler:**
- Hafıza dışa/içe aktarma; saklama politikası.
- `.github/workflows/ci.yml`: `npm ci`, typecheck, testler; anahtar yok.
- Ücretsiz kota belgeleri; Colab/HF isteğe bağlı notları.
- Bulut görev kuyruğu tasarımı (uygulama opsiyonel).

**Kabul:** CI yerelde `act` veya GitHub'da çalışır; hafıza export/import sanitize edilir; gizli veri yüklenmez.

### Aşama 5 — Kendi kodunu geliştirme + final

**İşler:**
- Ayrı dal + worktree; test + karşılaştırma; geri alma.
- Tüm testler, paketleme, kurulum, asar doğrulaması.
- Türkçe final raporu: yapılanlar, kanıtlar, eksikler, riskler.

**Kabul:** Tüm birim testleri + canlı demo + kurulu uygulama smoke; raporda abartı yok.

---

## 5. Bu oturumda uygulanacak ilk dilim

1. **P0 bağlam/boş yanıt düzeltmesi** ve demo yeniden doğrulaması.
2. **Sağlayıcı katmanı** (Ollama + OpenAI uyumlu, güvenli anahtar saklama, testler).
3. **Git dal/commit araçları** (Git varsa gerçek, yoksa net hata).
4. **GitHub Actions CI şablonu** ve ücretsiz kota belgesi.
5. Mümkünse **minimal MCP istemcisi**; aksi hâlde Aşama 3'e açıkça “yapılmadı” olarak yazılır.

> Not: MCP, tarayıcı otomasyonu, bulut kuyruğu ve kendini geliştirme otomasyonunun tamamı tek oturumda güvenle bitirilemez. Her biri ayrı doğrulama gerektirir; bu plan, hiçbirini "yapılmış" gibi göstermeden ilerlemeyi amaçlar.

### Oturum sonu durumu (19.10.2026)

| Dilim | Durum | Kanıt |
|---|---|---|
| P0 bağlam/boş yanıt | Uygulandı; demo #4 (P0-only) hâlâ takıldı, boş-tur koruması eklendi; demo #5 çalışıyor | `docs/evidence/agent-flow-demo-before-p0.json`, `agent-flow-demo-p0-only.json`; final rapor |
| Sağlayıcı katmanı | Uygulandı ve doğrulandı (sahte OpenAI uyumlu sunucu) | 276/276 test; `tests/installed-provider-check.mjs`; `docs/evidence/installed-provider.png` |
| Git dal/commit | Uygulandı, doğrulanmadı (makinede Git yok) | `tests/git-workflow.test.ts` 3/3; canlı test bloke |
| GitHub Actions CI | Uygulandı, doğrulanmadı (GitHub'da çalıştırılmadı) | `.github/workflows/ci.yml` |
| Minimal MCP istemcisi | Yapılmadı | — |
| Tarayıcı `browser_check` | Yapılmadı | — |
| Rol profilleri / kendini geliştirme | Yapılmadı | — |
| Paketleme + kurulum + smoke | Uygulandı ve doğrulandı | `release\Ultron Setup 1.1.0.exe`; kurulu smoke geçti |

---

## 6. Güvenlik tasarımı (yeni katmanlar)

### API anahtarları

- Kaynak: `ULTRON_OPENAI_API_KEY` veya `%APPDATA%\Ultron\provider-secrets.json`.
- `settings.json`, `tasks.json`, `audit.json`, sohbet ve renderer yanıtlarında **asla** yer almaz.
- UI yalnızca “anahtar tanımlı” bilgisini görür; kaydetme tek yönlüdür; silme ayrı işlemdir.
- Hata/gövde logları `Bearer`, `sk-...`, `api_key` desenleriyle maskelenir.
- Dosya izinleri kullanıcı hesabıyla sınırlı; dosya adı sabit; içerik şeması sürümlü.

### Sağlayıcı ağ politikası

- Ollama: yalnızca `127.0.0.0/8`, `localhost`, `::1`.
- OpenAI uyumlu: `https:` herkese açık; `http:` yalnızca loopback.
- Kullanıcı adı/parola/query/fragment yasak.
- `redirect: 'error'`; DNS rebinding'e karşı her istekte URL yeniden doğrulanır.
- Yanıt gövdesi 500 karakterle sınırlı; anahtar sızdırmayan hata mesajı.

### MCP

- Varsayılan kapalı; yalnızca kullanıcı yapılandırırsa çalışır.
- Komut/argüman allowlist; otomatik paket kurulumu yok.
- Sunucu başına zaman aşımı (ör. 30 sn), çıktı sınırı (12 KB), süreç ağacı temizliği.
- Araç çıktısı güvenilmeyen veri; içindeki talimatlar yürütülmez.
- Ağ erişimi MCP sunucusunun kendi sorumluluğundadır; Ultron bunu “izinli” saymaz.

### Git

- Force-push, `reset --hard`, otomatik merge yok.
- Kullanıcı değişiklikleri commit edilmeden önce `git status` ile gösterilir.
- Görev dalı dışına yazma yok; geri dönüş dal/commit ile.
- Git yoksa araçlar çalışmaz ve açık hata verir; sessizce “başarılı” denmez.

### Bulut

- Otomatik yükleme yok; kullanıcı onayı ve açık hedef gerekir.
- Repo secret'ları yalnızca CI'da; Ultron loglarına yazılmaz.
- Özel kod/anahtar Hugging Face/Colab'a gönderilmez.
- Ücretsiz kota ve kesinti riski kullanıcıya gösterilir.

---

## 7. Test stratejisi

| Katman | Test | Kanıt |
|---|---|---|
| Sağlayıcı URL | Ollama loopback; https/http politikası; kimlik/query reddi | Birim test |
| Sağlayıcı akışı | Sahte OpenAI SSE; içerik + tool-call birleştirme; 401/429/5xx | Yerel HTTP sunucusu |
| Sır saklama | Dosya şeması, maskeleme, renderer'a dönmeme | Birim + IPC testi |
| Git | Dal adı doğrulama, commit, geri dönüş; Git yoksa hata | Geçici depo |
| MCP | initialize/list/call, zaman aşımı, kötü JSON-RPC | Sahte stdio sunucu |
| Tarayıcı | Loopback sayfa, konsol hatası, ekran görüntüsü | Playwright |
| Bağlam | 24k/16k sınırında boş yanıt yok; tanılama | Birim + canlı |
| Adım kanıtı | Kanıtsız done reddi; kaynak değişince tazelik | Birim |
| Uçtan uca | Not defteri, web API, Android/Windows örnekleri | Canlı demo + kurulu uygulama |

**Kural:** Birim testi, sahte sunucu testi ve gerçek model testi birbirinin yerine sayılmaz. Raporlarda ayrı ayrı yazılır.

---

## 8. Riskler ve geri alma

| Risk | Etki | Önlem |
|---|---|---|
| 8B model bağlamı aşar / boş yanıt | Görev yarıda kalır | Token bütçesi, şema küçültme, `needs_review`, yeniden deneme |
| API anahtarı sızıntısı | Maliyet/güvenlik | userData/env, maskeleme, renderer'a dönmeme, test |
| MCP kötü niyetli sunucu | Kod çalıştırma | Varsayılan kapalı, allowlist, onay, zaman aşımı |
| Git olmadan dal akışı | Doğrulanamaz | Git varlık denetimi, net hata, kurulum belgesi |
| Bulut kotası/kesintisi | İş durur | Yerel devam, kuyruk, kota uyarısı |
| Kendini değiştirme | Çalışan uygulama bozulur | Ayrı dal, test, geri alma, otomatik merge yok |
| Lisans ihlali | Hukuki risk | Kod kopyalama yok; lisans dosya bazında doğrulama |
| Kullanıcı verisi kaybı | Güven kaybı | Yedek, atomik yazım, çökme günlüğü, geri alma |

**Geri alma:** Her aşama ayrı commit/dal; başarısız aşama `git` veya dosya yedeğiyle geri alınır. Git yoksa `codexx-backup-audit` benzeri tam kopya korunur.

---

## 9. Raporlama sözleşmesi

Final raporda her yetenek için şu üç etiketten biri kullanılacaktır:

- **Uygulandı ve doğrulandı:** Komut/test/ekran görüntüsü kanıtı var.
- **Uygulandı, doğrulanmadı:** Kod var; canlı/entegrasyon kanıtı yok.
- **Yapılmadı / sonraki aşama:** Açıkça eksik.

Ayrıca:
- Ham model zekâsı ile mühendislik parity'si ayrılacak.
- 8B yerel modelin frontier modellerle eşit olmadığı yazılacak.
- Ücretsiz bulut kotaları ve kesinti riskleri belirtilecek.
- Kullanıcı değişiklikleri ve mevcut çalışan özellikler korunacak.
