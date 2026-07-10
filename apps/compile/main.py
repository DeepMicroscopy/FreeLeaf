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
from synctex_query import backward_search, forward_search

MAX_REQUEST_BYTES = 100 * 1024 * 1024  # 100 MB cap on an uploaded project tar


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok"})
            return
        self._json(404, {"detail": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/compile":
            self._handle_compile(parsed)
        elif parsed.path == "/synctex/forward":
            self._handle_synctex_forward()
        elif parsed.path == "/synctex/backward":
            self._handle_synctex_backward()
        else:
            self._json(404, {"detail": "not found"})

    def _handle_compile(self, parsed) -> None:
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

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("content-length", 0))
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("invalid or oversized request body")
        return json.loads(self.rfile.read(length))

    def _handle_synctex_forward(self) -> None:
        try:
            body = self._read_json_body()
            pdf_bytes = base64.b64decode(body["pdf_base64"])
            synctex_bytes = base64.b64decode(body["synctex_base64"])
            file = body["file"]
            line = int(body["line"])
        except (ValueError, KeyError, TypeError) as exc:
            self._json(400, {"detail": f"invalid request: {exc}"})
            return

        result = forward_search(pdf_bytes, synctex_bytes, file, line)
        if result is None:
            self._json(404, {"detail": "no SyncTeX record for that position"})
            return
        self._json(200, result)

    def _handle_synctex_backward(self) -> None:
        try:
            body = self._read_json_body()
            pdf_bytes = base64.b64decode(body["pdf_base64"])
            synctex_bytes = base64.b64decode(body["synctex_base64"])
            page = int(body["page"])
            x = float(body["x"])
            y = float(body["y"])
        except (ValueError, KeyError, TypeError) as exc:
            self._json(400, {"detail": f"invalid request: {exc}"})
            return

        result = backward_search(pdf_bytes, synctex_bytes, page, x, y)
        if result is None:
            self._json(404, {"detail": "no SyncTeX record for that position"})
            return
        self._json(200, result)

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
