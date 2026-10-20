from __future__ import annotations

import json
import mimetypes
import os
import re
import subprocess
import ipaddress
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from typing import Optional


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
PORT = int(os.environ.get("PORT", "5179"))
HOST = os.environ.get("HOST", "127.0.0.1")
MAX_BODY_BYTES = 65536


def run_adb(args: list[str]) -> tuple[int, str, str]:
    """ADB komutunu çalıştır ve (code, stdout, stderr) döndür."""
    adb_path = os.environ.get("ADB_PATH", "adb")
    try:
        result = subprocess.run(
            [adb_path] + args,
            capture_output=True,
            text=True,
            timeout=15,
            encoding="utf-8",
            errors="replace"
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "ADB timeout"
    except FileNotFoundError:
        return -1, "", "ADB not found in PATH"


def list_adb_devices() -> list[dict]:
    code, stdout, stderr = run_adb(["devices", "-l"])
    if code != 0:
        return []
    devices = []
    for line in stdout.strip().split("\n")[1:]:
        if not line.strip():
            continue
        parts = line.strip().split()
        if len(parts) >= 2:
            serial = parts[0]
            state = parts[1]
            model = None
            android = None
            for part in parts[2:]:
                if part.startswith("model:"):
                    model = part[6:]
                elif part.startswith("android:"):
                    android = part[8:]
            devices.append({
                "serial": serial,
                "state": state,
                "model": model,
                "androidVersion": android
            })
    return devices


def adb_shell(serial: str, command: str) -> tuple[int, str, str]:
    return run_adb(["-s", serial, "shell", command])


def adb_screencap(serial: str) -> tuple[int, bytes, str]:
    code, stdout, stderr = run_adb(["-s", serial, "exec-out", "screencap", "-p"])
    if code == 0:
        return code, stdout.encode("latin-1"), stderr
    return code, b"", stderr


def adb_input(serial: str, input_type: str, args: list[str]) -> tuple[int, str, str]:
    return run_adb(["-s", serial, "shell", "input", input_type] + args)


def adb_install(serial: str, apk_path: str) -> tuple[int, str, str]:
    return run_adb(["-s", serial, "install", "-r", apk_path])


def adb_pull(serial: str, remote: str, local: str) -> tuple[int, str, str]:
    return run_adb(["-s", serial, "pull", remote, local])


def adb_push(serial: str, local: str, remote: str) -> tuple[int, str, str]:
    return run_adb(["-s", serial, "push", local, remote])


def adb_logcat(serial: str, filter_expr: str = "") -> tuple[int, str, str]:
    args = ["-s", serial, "logcat", "-d", "-t", "100"]
    if filter_expr:
        args.append(filter_expr)
    return run_adb(args)


class Handler(BaseHTTPRequestHandler):
    server_version = "UltronMobileRemote/1.0"
    sys_version = ""

    def _headers(self, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, payload: dict | list, status: int = 200) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._headers("application/json; charset=utf-8", status)
        self.wfile.write(encoded)

    def _error(self, status: int, code: str, message: str) -> None:
        self._json({"error": {"code": code, "message": message}}, status)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        route = urlparse(self.path).path
        
        if route == "/api/devices":
            devices = list_adb_devices()
            self._json({"devices": devices})
            return

        if route == "/api/health":
            self._json({"status": "ok", "service": "mobile-remote-control"})
            return

        # Static files
        if route in ("/", "/index.html"):
            self._static("index.html")
            return
        
        if route.startswith("/assets/") or route.startswith("/styles.css") or route.startswith("/app.js"):
            self._static(route.lstrip("/"))
            return

        self._error(404, "not_found", "Route not found")

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        
        # Read body
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length > MAX_BODY_BYTES:
            self._error(413, "body_too_large", "Request body too large")
            return
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        
        try:
            body = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._error(400, "invalid_request", f"Invalid JSON: {exc}")
            return

        if route == "/api/devices/refresh":
            devices = list_adb_devices()
            self._json({"devices": devices, "refreshed": True})
            return

        if route.startswith("/api/devices/") and route.count("/") >= 3:
            # /api/devices/<serial>/<action>
            parts = route.split("/")
            serial = parts[3]
            action = parts[4] if len(parts) > 4 else ""
            
            try:
                if action == "shell":
                    command = body.get("command", "")
                    code, stdout, stderr = adb_shell(serial, command)
                    self._json({"code": code, "stdout": stdout, "stderr": stderr})
                    return
                
                elif action == "tap":
                    x = body.get("x")
                    y = body.get("y")
                    if x is None or y is None:
                        self._error(422, "invalid_params", "x and y required")
                        return
                    code, stdout, stderr = adb_input(serial, "tap", [str(x), str(y)])
                    self._json({"code": code, "stdout": stdout, "stderr": stderr})
                    return
                
                elif action == "swipe":
                    x1, y1 = body.get("x1"), body.get("y1")
                    x2, y2 = body.get("x2"), body.get("y2")
                    duration = body.get("duration", 300)
                    if None in (x1, y1, x2, y2):
                        self._error(422, "invalid_params", "x1, y1, x2, y2 required")
                        return
                    code, stdout, stderr = adb_input(serial, "swipe", [str(x1), str(y1), str(x2), str(y2), str(duration)])
                    self._json({"code": code, "stdout": stdout, "stderr": stderr})
                    return
                
                elif action == "text":
                    text = body.get("text", "")
                    # Escape spaces for adb input text
                    escaped = text.replace(" ", "%s").replace("'", "\\'")
                    code, stdout, stderr = adb_input(serial, "text", [escaped])
                    self._json({"code": code, "stdout": stdout, "stderr": stderr})
                    return
                
                elif action == "key":
                    keycode = body.get("keycode")
                    if keycode is None:
                        self._error(422, "invalid_params", "keycode required")
                        return
                    code, stdout, stderr = adb_input(serial, "key", [str(keycode)])
                    self._json({"code": code, "stdout": stdout, "stderr": stderr})
                    return
                
                elif action == "screencap":
                    code, img_data, stderr = adb_screencap(serial)
                    if code == 0 and img_data:
                        self.send_response(200)
                        self.send_header("Content-Type", "image/png")
                        self.send_header("Access-Control-Allow-Origin", "*")
                        self.end_headers()
                        self.wfile.write(img_data)
                        return
                    self._error(500, "screencap_failed", stderr or "Failed to capture screen")
                    return
                
                elif action == "install":
                    apk_path = body.get("apkPath")
                    if not apk_path:
                        self._error(422, "invalid_params", "apkPath required")
                        return
                    code, stdout, stderr = adb_install(serial, apk_path)
                    self._json({"code": code, "stdout": stdout, "stderr": stderr})
                    return
                
                elif action == "pull":
                    remote_path = body.get("remotePath")
                    local_path = body.get("localPath")
                    if not remote_path or not local_path:
                        self._error(422, "invalid_params", "remotePath and localPath required")
                        return
                    code, stdout, stderr = adb_pull(serial, remote_path, local_path)
                    self._json({"code": code, "stdout": stdout, "stderr": stderr})
                    return
                
                elif action == "push":
                    local_path = body.get("localPath")
                    remote_path = body.get("remotePath")
                    if not local_path or not remote_path:
                        self._error(422, "invalid_params", "localPath and remotePath required")
                        return
                    code, stdout, stderr = adb_push(serial, local_path, remote_path)
                    self._json({"code": code, "stdout": stdout, "stderr": stderr})
                    return
                
                elif action == "logcat":
                    filter_expr = body.get("filter", "")
                    code, stdout, stderr = adb_logcat(serial, filter_expr)
                    self._json({"code": code, "stdout": stdout, "stderr": stderr})
                    return
                
                else:
                    self._error(404, "unknown_action", f"Unknown action: {action}")
                    return
                    
            except Exception as e:
                self._error(500, "internal_error", str(e))
                return

        if route == "/api/remote-desktop/connect":
            # Session oluştur, WebSocket URL'si döndür
            rtype = body.get("type", "vnc")
            host = body.get("host")
            port = body.get("port")
            password = body.get("password")
            
            if not host:
                self._error(422, "invalid_params", "host required")
                return
            
            session_id = f"rd-{int(time.time() * 1000)}-{os.urandom(4).hex()}"
            ws_url = f"ws://{HOST}:{PORT}/ws/remote-desktop/{session_id}"
            
            self._json({
                "sessionId": session_id,
                "wsUrl": ws_url
            })
            return

        self._error(404, "not_found", "Route not found")

    def _static(self, relative_path: str) -> None:
        target = (PUBLIC / relative_path).resolve()
        try:
            target.relative_to(PUBLIC.resolve())
            content = target.read_bytes()
        except (ValueError, OSError):
            self._error(404, "not_found", "Static asset not found")
            return
        self._headers(mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.wfile.write(content)

    def log_message(self, format: str, *args: object) -> None:
        route = urlparse(self.path).path
        known = {"/", "/index.html", "/api/devices", "/api/health", "/api/devices/refresh"}
        if route not in known and not route.startswith("/api/devices/") and not route.startswith("/ws/"):
            route = "/<other>"
        print(f"{self.address_string()} {self.log_date_time_string()} {self.command} {route}", flush=True)


def main() -> None:
    try:
        address = ipaddress.ip_address(HOST)
    except ValueError as exc:
        raise RuntimeError("HOST must be a loopback address") from exc
    if not address.is_loopback:
        raise RuntimeError("HOST must be a loopback address")
    if PORT < 0 or PORT > 65535:
        raise RuntimeError("PORT must be between 0 and 65535")
    
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    print(f"Ultron Mobile Remote Control listening at http://{HOST}:{server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    import time
    main()