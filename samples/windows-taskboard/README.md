# Kod Atölyesi Windows masaüstü görev panosu

Python standart kitaplığı ile Tkinter masaüstü arayüzü ve SQLite kalıcılığı kullanan örnek Windows uygulaması.

## Başlatma ve doğrulama

- `python main.py`
- `python -m unittest discover -s tests -v`
- `python -m py_compile main.py app_ui.py task_store.py`
- EXE paketlemek için proje ortamında PyInstaller kurun ve Kod Atölyesi Windows panelinden paketleme onayını verin.

Uygulama görevleri `%LOCALAPPDATA%\KodAtolyesi\WindowsTaskboard\tasks.sqlite3` içinde saklar. Testler yalnızca geçici klasör kullanır.
