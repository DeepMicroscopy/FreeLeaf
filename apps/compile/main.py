"""Sandboxed TeX Live compile service (Plan.md §7, Phase 3).

Internal-only HTTP service — never exposed to the internet, only called by
apps/api over the Docker Compose network. Receives a tar of project source
files, runs the actual pdflatex/xelatex job in an ephemeral sandboxed
container (see sandbox.py for every isolation rule), and returns the
result as JSON.
"""

import base64
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from sandbox import CompileError, run_job

MAX_REQUEST_BYTES = 100 * 1024 * 1024  # 100 MB cap on an uploaded project tar


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok"})
            return
        self._json(404, {"detail": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/compile":
            self._json(404, {"detail": "not found"})
            return

        params = parse_qs(parsed.query)
        compiler = (params.get("compiler") or ["pdflatex"])[0]
        main_file = (params.get("main") or ["main.tex"])[0]

        length = int(self.headers.get("content-length", 0))
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._json(400, {"detail": "invalid or oversized request body"})
            return
        tar_bytes = self.rfile.read(length)

        try:
            result = run_job(tar_bytes, compiler, main_file)
        except CompileError as exc:
            self._json(400, {"detail": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001 - last-resort boundary for an internal service
            self._json(500, {"detail": f"compile service error: {exc}"})
            return

        self._json(
            200,
            {
                "status": result.status,
                "log": result.log,
                "pdf_base64": base64.b64encode(result.pdf).decode() if result.pdf else None,
                "synctex_base64": base64.b64encode(result.synctex).decode() if result.synctex else None,
                "duration_ms": result.duration_ms,
                "exit_code": result.exit_code,
                "compiler": result.compiler,
            },
        )

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 - stdlib hook signature
        pass


def main():
    port = int(os.environ.get("PORT", "8100"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
