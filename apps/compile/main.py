"""Sandboxed TeX Live compile service (stub for Phase 0).

Real compilation (§7: sandboxed pdflatex/xelatex jobs) lands in Phase 3.
This process currently only exposes a health check so the service has a
place in `docker-compose.yml` from the start.
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ok"}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):  # noqa: A002 - stdlib hook signature
        pass


def main():
    port = int(os.environ.get("PORT", "8100"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
