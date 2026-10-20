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


class MobileRemoteControlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="ultron-mobile-")
        self.process: subprocess.Popen[bytes] | None = None
        self._start_server()

    def _start_server(self) -> None:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        environment = os.environ.copy()
        environment["PORT"] = str(self.port)
        environment["HOST"] = "127.0.0.1"
        self.process = subprocess.Popen(
            [sys.executable, "server.py"],
            cwd=ROOT, env=environment,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.base_url = f"http://127.0.0.1:{self.port}"
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                _, error = self.process.communicate(timeout=1)
                self.fail(f"Server stopped before becoming healthy: {error}")
            try:
                self.request("GET", "/api/devices")
                break
            except (OSError, urllib.error.URLError):
                time.sleep(0.2)
        else:
            self.fail("Server did not become healthy within 15 seconds.")

    def _stop_server(self) -> str:
        if self.process is None:
            return ""
        process = self.process
        self.process = None
        if process.poll() is None:
            process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate(timeout=5)
        return (stdout + stderr).decode("utf-8", "replace")

    def tearDown(self) -> None:
        self._stop_server()
        self.temp.cleanup()

    def request(self, method: str, route: str, body: dict | None = None) -> tuple[int, dict | str, dict]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        request = urllib.request.Request(
            self.base_url + route, data=data, method=method,
            headers=headers,
        )
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        content_type = response.headers.get("Content-Type", "")
        resp_body = json.loads(response.read().decode("utf-8")) if "json" in content_type else response.read().decode("utf-8")
        return response.status, resp_body, dict(response.headers)

    def test_health_and_devices_endpoint(self) -> None:
        status, payload, headers = self.request("GET", "/api/devices")
        self.assertEqual(status, 200)
        self.assertIn("devices", payload)
        self.assertIsInstance(payload["devices"], list)

    def test_static_frontend_served(self) -> None:
        response = urllib.request.urlopen(self.base_url + "/", timeout=5)
        html = response.read().decode("utf-8")
        self.assertIn("Ultron Mobile Remote Control", html)

    def test_devices_refresh_endpoint(self) -> None:
        status, payload, _ = self.request("POST", "/api/devices/refresh")
        self.assertEqual(status, 200)
        self.assertIn("devices", payload)
        self.assertIn("refreshed", payload)
        self.assertTrue(payload["refreshed"])

    def test_invalid_device_action_returns_404(self) -> None:
        status, payload, _ = self.request("POST", "/api/devices/nonexistent/unknown")
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"]["code"], "unknown_action")

    def test_remote_desktop_connect_creates_session(self) -> None:
        status, payload, _ = self.request("POST", "/api/remote-desktop/connect", {
            "type": "vnc",
            "host": "127.0.0.1",
            "port": 5900
        })
        self.assertEqual(status, 200)
        self.assertIn("sessionId", payload)
        self.assertIn("wsUrl", payload)
        self.assertTrue(payload["wsUrl"].startswith("ws://"))

    def test_cors_headers_present(self) -> None:
        status, _, headers = self.request("OPTIONS", "/api/devices")
        self.assertEqual(status, 204)
        self.assertIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")


if __name__ == "__main__":
    unittest.main()