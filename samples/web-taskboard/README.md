# Kod Atölyesi Taskboard — local full-stack sample

A dependency-free Python and SQLite web application demonstrating real UI, REST endpoints, data persistence, schema migration, validation, tests, and a localhost-only development server.

## Run

```powershell
python server.py
```

Open `http://127.0.0.1:5178`. Set `WEB_TASKS_PORT` to choose another port. `WEB_TASKS_DB` can point at a different SQLite file. The server rejects non-loopback bind addresses and creates `data/tasks.sqlite3` when no database path is set.

## Verify

```powershell
python -m unittest discover -s tests -v
```

The tests start the real HTTP service against isolated temporary SQLite databases and verify health, create/list/update/delete, input errors, missing routes, and static security headers.

## Scope

This is a local development sample, not a production account system. It intentionally has no authentication, password reset, email provider, TLS termination, or deployment secrets. Do not expose it to a public network or use it for personal/production records without adding the appropriate controls. It uses Python's standard library and SQLite; it has no external service, package, font, or API dependency.
