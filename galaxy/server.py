#!/usr/bin/env python3
"""Tiny standard-library web server for the knowledge galaxy.

Serves ONLY the viewer/ folder next to this script, on http://127.0.0.1:4700.
No caching, so a re-run of build.py shows up on plain reload.
"""
from __future__ import annotations

import functools
import http.server
from pathlib import Path

PORT = 4700
VIEWER_DIR = Path(__file__).resolve().parent / "viewer"


class ViewerHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        print(f"[galaxy] {self.address_string()} {fmt % args}")


def main() -> None:
    if not (VIEWER_DIR / "index.html").is_file():
        raise SystemExit(f"viewer/index.html not found in {VIEWER_DIR}")
    handler = functools.partial(ViewerHandler, directory=str(VIEWER_DIR))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Knowledge galaxy → http://127.0.0.1:{PORT}  (serving {VIEWER_DIR})")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nGalaxy server stopped.")


if __name__ == "__main__":
    main()
