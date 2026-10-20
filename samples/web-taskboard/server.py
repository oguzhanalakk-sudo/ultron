from __future__ import annotations

import json
import mimetypes
import os
import re
import sqlite3
import ipaddress
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
MIGRATIONS = ROOT / "migrations"
DB_PATH = Path(os.environ.get("WEB_TASKS_DB", str(ROOT / "data" / "tasks.sqlite3"))).resolve()
HOST = os.environ.get("WEB_TASKS_HOST", "127.0.0.1")
PORT = int(os.environ.get("WEB_TASKS_PORT", "5178"))
MAX_BODY_BYTES = 8192
MAX_TITLE_LENGTH = 160
MAX_DESCRIPTION_LENGTH = 1000


def connect_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=5000")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


@contextmanager
def database():
    connection = connect_db()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def migrate() -> None:
    connection = connect_db()
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        known = {row[0] for row in connection.execute("SELECT version FROM schema_migrations")}
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if migration.name in known:
                continue
            sql = migration.read_text(encoding="utf-8")
            pending = ""
            connection.execute("BEGIN IMMEDIATE")
            try:
                for line in sql.splitlines(keepends=True):
                    pending += line
                    if sqlite3.complete_statement(pending):
                        statement = pending.strip()
                        pending = ""
                        if statement:
                            connection.execute(statement)
                if pending.strip():
                    raise RuntimeError(f"Incomplete SQL statement in {migration.name}")
                connection.execute("INSERT INTO schema_migrations(version) VALUES (?)", (migration.name,))
                connection.commit()
            except Exception:
                connection.rollback()
                raise
    finally:
        connection.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "KodAtolyesiWebDemo/1.0"
    sys_version = ""

    def _headers(self, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _json(self, payload: dict | list, status: int = 200) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._headers("application/json; charset=utf-8", status)
        self.wfile.write(encoded)

    def _error(self, status: int, code: str, message: str) -> None:
        self._json({"error": {"code": code, "message": message}}, status)

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        # BaseHTTPRequestHandler's default error page can echo raw request text.
        # Keep malformed requests and unsupported methods on the same JSON contract.
        if code == 501:
            self._error(405, "method_not_allowed", "HTTP method is not allowed.")
            return
        self._error(code, "invalid_http_request", "Invalid HTTP request.")

    def _body(self) -> dict:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise ValueError("Content-Length must be an integer.") from exc
        if length < 0 or length > MAX_BODY_BYTES:
            raise OverflowError("Request body is too large.")
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Content-Type must be application/json.")
        try:
            value = json.loads(self.rfile.read(length) or b"{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Request body must be valid JSON.") from exc
        if not isinstance(value, dict):
            raise ValueError("Request body must be a JSON object.")
        return value

    def do_GET(self) -> None:  # noqa: N802
        route = urlparse(self.path).path
        if route == "/api/health":
            try:
                with database() as connection:
                    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
                self._json({"status": "ok" if integrity == "ok" else "degraded", "database": "connected", "integrity": integrity, "sqliteVersion": sqlite3.sqlite_version})
            except sqlite3.Error:
                self._error(503, "database_unavailable", "Database connection check failed.")
            return

        if route == "/api/tasks":
            with database() as connection:
                tasks = [dict(row) for row in connection.execute(
                    "SELECT id, title, description, done, created_at, updated_at FROM tasks ORDER BY done ASC, id DESC"
                )]
            for task in tasks:
                task["done"] = bool(task["done"])
            self._json({"tasks": tasks, "count": len(tasks)})
            return

        if route in ("/", "/index.html"):
            self._static("index.html")
            return
        if route in ("/assets/app.js", "/assets/styles.css"):
            self._static(route.removeprefix("/"))
            return
        self._error(404, "not_found", "Route not found.")

    def do_POST(self) -> None:  # noqa: N802
        route = urlparse(self.path).path
        if route != "/api/tasks":
            self._error(404, "not_found", "Route not found.")
            return
        try:
            body = self._body()
        except OverflowError:
            self._error(413, "body_too_large", "Request body exceeds the allowed size.")
            return
        except ValueError as exc:
            self._error(400, "invalid_request", str(exc))
            return
        title = body.get("title")
        description = body.get("description", "")
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > MAX_TITLE_LENGTH:
            self._error(422, "invalid_title", f"Title must contain 1–{MAX_TITLE_LENGTH} characters.")
            return
        if not isinstance(description, str) or len(description) > MAX_DESCRIPTION_LENGTH:
            self._error(422, "invalid_description", f"Description must be at most {MAX_DESCRIPTION_LENGTH} characters.")
            return
        with database() as connection:
            cursor = connection.execute("INSERT INTO tasks(title, description) VALUES (?, ?)", (title.strip(), description.strip()))
            task = connection.execute("SELECT id, title, description, done, created_at, updated_at FROM tasks WHERE id=?", (cursor.lastrowid,)).fetchone()
        result = dict(task)
        result["done"] = bool(result["done"])
        self._json({"task": result}, 201)

    def do_PATCH(self) -> None:  # noqa: N802
        match = re.fullmatch(r"/api/tasks/(\d+)", urlparse(self.path).path)
        if not match:
            self._error(404, "not_found", "Route not found.")
            return
        try:
            body = self._body()
        except OverflowError:
            self._error(413, "body_too_large", "Request body exceeds the allowed size.")
            return
        except ValueError as exc:
            self._error(400, "invalid_request", str(exc))
            return
        if not isinstance(body.get("done"), bool):
            self._error(422, "invalid_done", "done must be a boolean.")
            return
        with database() as connection:
            connection.execute("UPDATE tasks SET done=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (body["done"], int(match.group(1))))
            task = connection.execute("SELECT id, title, description, done, created_at, updated_at FROM tasks WHERE id=?", (int(match.group(1)),)).fetchone()
        if task is None:
            self._error(404, "task_not_found", "Task not found.")
            return
        result = dict(task)
        result["done"] = bool(result["done"])
        self._json({"task": result})

    def do_DELETE(self) -> None:  # noqa: N802
        match = re.fullmatch(r"/api/tasks/(\d+)", urlparse(self.path).path)
        if not match:
            self._error(404, "not_found", "Route not found.")
            return
        with database() as connection:
            cursor = connection.execute("DELETE FROM tasks WHERE id=?", (int(match.group(1)),))
        if cursor.rowcount == 0:
            self._error(404, "task_not_found", "Task not found.")
            return
        self._json({"deleted": True, "id": int(match.group(1))})

    def _static(self, relative_path: str) -> None:
        target = (PUBLIC / relative_path).resolve()
        try:
            target.relative_to(PUBLIC.resolve())
            content = target.read_bytes()
        except (ValueError, OSError):
            self._error(404, "not_found", "Static asset not found.")
            return
        self._headers(mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.wfile.write(content)

    def log_message(self, format: str, *args: object) -> None:
        # Log only canonical route names. Never format the raw request line, which
        # contains user-controlled paths and query parameters that may hold tokens.
        route = urlparse(self.path).path
        known_routes = {"/", "/index.html", "/api/health", "/api/tasks", "/assets/app.js", "/assets/styles.css"}
        if re.fullmatch(r"/api/tasks/\d+", route):
            route = "/api/tasks/:id"
        elif route not in known_routes:
            route = "/<unmatched>"
        method = self.command if re.fullmatch(r"[A-Z]{1,16}", self.command or "") else "UNKNOWN"
        print(f"{self.address_string()} {self.log_date_time_string()} {method} {route}", flush=True)


def main() -> None:
    try:
        address = ipaddress.ip_address(HOST)
    except ValueError as exc:
        raise RuntimeError("WEB_TASKS_HOST must be a loopback address.") from exc
    if not address.is_loopback:
        raise RuntimeError("WEB_TASKS_HOST must be a loopback address.")
    if PORT < 0 or PORT > 65535:
        raise RuntimeError("WEB_TASKS_PORT must be between 0 and 65535.")
    migrate()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"Kod Atölyesi Taskboard listening at http://{HOST}:{server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
