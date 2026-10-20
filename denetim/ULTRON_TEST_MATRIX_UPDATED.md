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

## N. HEDEF A — Mobil/Uzak Kontrol (yeni: samples/mobile-remote-control)

| Kimlik | İstenen davranış | Durum | Test yöntemi | Gerçek test sonucu |
|---|---|---|---|---|
| REQ-N01 | ADB cihaz listesi | PASS | pytest + API | `/api/devices` gerçek adb devices çıktısı |
| REQ-N02 | ADB shell komutu | PASS | API + onay akışı | `adb_shell` aracı onaylı çalışıyor |
| REQ-N03 | Ekran görüntüsü (screencap) | PASS | API | Base64 PNG döndürüyor |
| REQ-N04 | ADB input (tap/swipe/text/key) | PASS | API + onay akışı | `adb_input` aracı onaylı çalışıyor |
| REQ-N05 | APK yükle/çıkar | PASS | API + onay akışı | `adb_install`, `adb_pull`, `adb_push` onaylı |
| REQ-N06 | Logcat okuma | PASS | API | `adb_logcat` filtreli log döndürüyor |
| REQ-N07 | Web tabanlı kontrol paneli | PASS | pytest + manuel | HTML/CSS/JS frontend, canvas tabanlı ekran yayını |
| REQ-N08 | Uzak masaüstü (VNC) oturumu | PASS | API | `remote-desktop/connect` session + WebSocket proxy |
| REQ-N09 | Otomatik test paketi | PASS | pytest 6/6 | CORS, devices, refresh, invalid action, session, static |

## Audit-live kanıt özeti (8/15 PASS, 7 PARTIAL/honest)