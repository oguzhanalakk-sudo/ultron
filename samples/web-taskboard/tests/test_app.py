from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class TaskboardHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="kod-atolyesi-web-")
        self.database_path = str(Path(self.temp.name) / "taskboard.sqlite3")
        self.process: subprocess.Popen[bytes] | None = None
        self._start_server()

    def _start_server(self) -> None:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        environment = os.environ.copy()
        environment["WEB_TASKS_HOST"] = "127.0.0.1"
        environment["WEB_TASKS_PORT"] = str(self.port)
        environment["WEB_TASKS_DB"] = self.database_path
        self.process = subprocess.Popen(
            [sys.executable, "server.py"], cwd=ROOT, env=environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.base_url = f"http://127.0.0.1:{self.port}"
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                _, error = self.process.communicate(timeout=1)
                self.fail(f"Server stopped before becoming healthy: {error}")
            try:
                self.request("GET", "/api/health")
                break
            except (OSError, urllib.error.URLError):
                time.sleep(0.05)
        else:
            self.fail("Server did not become healthy within 5 seconds.")

    def _stop_server(self) -> str:
        if self.process is None:
            return ""
        process = self.process
        self.process = None
        if process.poll() is None:
            process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate(timeout=3)
        return (stdout + stderr).decode("utf-8", "replace")

    def tearDown(self) -> None:
        self._stop_server()
        self.temp.cleanup()

    def request(self, method: str, route: str, body: dict | None = None, *, raw_body: bytes | None = None, content_type: str | None = None):
        data = raw_body if raw_body is not None else (json.dumps(body).encode("utf-8") if body is not None else None)
        headers = {"Content-Type": content_type or "application/json"} if data is not None else {}
        request = urllib.request.Request(
            self.base_url + route, data=data, method=method,
            headers=headers,
        )
        try:
            response = urllib.request.urlopen(request, timeout=2)
        except urllib.error.HTTPError as error:
            response = error
        return response.status, json.loads(response.read().decode("utf-8")) if "json" in response.headers.get("Content-Type", "") else response.read().decode("utf-8"), response.headers

    def test_health_checks_real_sqlite_connection_and_schema(self) -> None:
        status, payload, headers = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["database"], "connected")
        self.assertEqual(payload["integrity"], "ok")
        self.assertIn("Content-Security-Policy", headers)

    def test_task_crud_uses_api_and_persists_in_sqlite(self) -> None:
        status, created, _ = self.request("POST", "/api/tasks", {"title": "Metrajı gözden geçir", "description": "Kesitleri doğrula"})
        self.assertEqual(status, 201)
        task_id = created["task"]["id"]
        self.assertEqual(created["task"]["title"], "Metrajı gözden geçir")
        status, listed, _ = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        self.assertEqual(listed["count"], 1)
        self.assertEqual(listed["tasks"][0]["id"], task_id)
        status, updated, _ = self.request("PATCH", f"/api/tasks/{task_id}", {"done": True})
        self.assertEqual(status, 200)
        self.assertTrue(updated["task"]["done"])
        status, deleted, _ = self.request("DELETE", f"/api/tasks/{task_id}")
        self.assertEqual(status, 200)
        self.assertTrue(deleted["deleted"])
        self.assertEqual(self.request("GET", "/api/tasks")[1]["count"], 0)

    def test_validation_and_missing_resources_return_real_http_errors(self) -> None:
        status, payload, _ = self.request("POST", "/api/tasks", {"title": " "})
        self.assertEqual(status, 422)
        self.assertEqual(payload["error"]["code"], "invalid_title")
        status, payload, _ = self.request("PATCH", "/api/tasks/999", {"done": True})
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "task_not_found")
        status, payload, _ = self.request("GET", "/api/missing")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "not_found")

    def test_static_frontend_is_served_with_security_headers(self) -> None:
        response = urllib.request.urlopen(self.base_url + "/", timeout=2)
        html = response.read().decode("utf-8")
        self.assertIn("Görevlerin", html)
        self.assertIn("Content-Security-Policy", response.headers)
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_invalid_json_wrong_content_type_and_oversize_body_are_json_errors(self) -> None:
        status, payload, _ = self.request("POST", "/api/tasks", raw_body=b"{broken")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_request")
        status, payload, _ = self.request("POST", "/api/tasks", raw_body=b"{}", content_type="text/plain")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"]["code"], "invalid_request")
        status, payload, _ = self.request("POST", "/api/tasks", raw_body=b" " * 8193)
        self.assertEqual(status, 413)
        self.assertEqual(payload["error"]["code"], "body_too_large")

    def test_unsupported_http_method_returns_json_405(self) -> None:
        status, payload, _ = self.request("PUT", "/api/tasks")
        self.assertEqual(status, 405)
        self.assertEqual(payload["error"]["code"], "method_not_allowed")

    def test_persisted_tasks_survive_a_real_server_restart(self) -> None:
        status, created, _ = self.request("POST", "/api/tasks", {"title": "Restart sonrası kalıcı"})
        self.assertEqual(status, 201)
        task_id = created["task"]["id"]
        self._stop_server()
        self._start_server()
        status, listed, _ = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        self.assertEqual(listed["tasks"][0]["id"], task_id)

    def test_access_logs_omit_query_secrets_and_arbitrary_paths(self) -> None:
        secret = "web-log-secret-should-not-appear"
        self.request("GET", f"/api/health?token={secret}")
        self.request("GET", f"/private-user-route?token={secret}")
        logs = self._stop_server()
        self.assertNotIn(secret, logs)
        self.assertIn("GET /api/health", logs)
        self.assertIn("GET /<unmatched>", logs)


class TaskboardHostSafetyTests(unittest.TestCase):
    def test_server_refuses_non_loopback_bind_address(self) -> None:
        with tempfile.TemporaryDirectory(prefix="kod-atolyesi-web-host-") as temporary:
            environment = os.environ.copy()
            environment["WEB_TASKS_HOST"] = "0.0.0.0"
            environment["WEB_TASKS_PORT"] = "0"
            environment["WEB_TASKS_DB"] = str(Path(temporary) / "taskboard.sqlite3")
            result = subprocess.run(
                [sys.executable, "server.py"], cwd=ROOT, env=environment,
                capture_output=True, text=True, timeout=5,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("loopback", result.stderr)

    def test_server_reports_a_port_conflict_instead_of_claiming_success(self) -> None:
        with tempfile.TemporaryDirectory(prefix="kod-atolyesi-web-port-") as temporary:
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                listener.listen()
                environment = os.environ.copy()
                environment["WEB_TASKS_HOST"] = "127.0.0.1"
                environment["WEB_TASKS_PORT"] = str(listener.getsockname()[1])
                environment["WEB_TASKS_DB"] = str(Path(temporary) / "taskboard.sqlite3")
                result = subprocess.run(
                    [sys.executable, "server.py"], cwd=ROOT, env=environment,
                    capture_output=True, text=True, timeout=5,
                )
        self.assertNotEqual(result.returncode, 0)
        self.assertRegex(result.stderr.lower(), r"address already in use|winerror 100(?:13|48)")


if __name__ == "__main__":
    unittest.main()
