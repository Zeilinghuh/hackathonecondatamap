"""Local API for the UK economic-terrain overlay.

Run from the `financial_ forecast` directory:

    python src/backend/server.py

Python serves cached HTTP bytes and Capri chat. C++ parses and joins source
data, simplifies boundaries, generates RichDEM terrain and writes the product.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import socket
import subprocess
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, ClassVar
from urllib.parse import urlparse

from capri.capri import CapriError, CapriService
from capri.speech import SpeechService
from terrain_service import PROJECT_ROOT, TerrainStore

WEB_ROOT = PROJECT_ROOT / "src" / "frontend"
BUSINESS_DEATHS_PATH = PROJECT_ROOT / "assets" / "data" / "business_deaths.csv"
TERRAIN = TerrainStore()
CAPRI = CapriService(PROJECT_ROOT)
SPEECH = SpeechService()


class LocalHTTPServer(ThreadingHTTPServer):
    """Windows SO_REUSEADDR can silently leave requests on an older server."""

    def server_bind(self) -> None:
        if os.name == "nt":
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class TerrainRequestHandler(SimpleHTTPRequestHandler):
    """Serve the browser shell and the derived terrain GeoJSON."""

    # Windows file associations can identify .js as text/plain, which browsers
    # reject for ES modules. Keep these MIME types independent of the registry.
    extensions_map: ClassVar[dict[str, str]] = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".css": "text/css",
    }

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def do_GET(self) -> None:
        route = urlparse(self.path).path
        if route == "/api/health":
            self.send_json({"status": "ok"})
            return
        if route == "/api/capri/status":
            self.send_json(CAPRI.status())
            return
        if route == "/api/capri/speech/status":
            self.send_json(SPEECH.status())
        if route == "/api/business-deaths":
            try:
                with BUSINESS_DEATHS_PATH.open(newline="", encoding="utf-8-sig") as source:
                    rows = []
                    for row in csv.DictReader(source):
                        value = (row.get("business_death_rate_percent") or "").strip()
                        if row.get("year") != "2024" or not value:
                            continue
                        rows.append(
                            {
                                "area_code": row["area_code"],
                                "area_name": row["area_name"],
                                "rate_percent": float(value),
                            }
                        )
                self.send_json(
                    {
                        "source_year": "2024",
                        "metric": "Business deaths as a percentage of active businesses",
                        "areas": rows,
                    }
                )
            except (OSError, KeyError, ValueError) as error:
                self.send_json(
                    {"error": f"Could not read business-deaths data: {error}"},
                    status=HTTPStatus.INTERNAL_SERVER_ERROR,
                )
            return
        if route == "/capri-assets/sprites.png":
            sprite = PROJECT_ROOT / "assets" / "visual" / "capri" / "sprites.png"
            if not sprite.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            content = sprite.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        if route in {"/api/terrain", "/api/history"}:
            try:
                content, compressed, etag = (
                    TERRAIN.history_response()
                    if route == "/api/history"
                    else TERRAIN.response()
                )
                unchanged = self.headers.get("If-None-Match") == etag
                encodings = self.headers.get("Accept-Encoding", "").lower()
                use_gzip = any(
                    part.split(";")[0].strip() == "gzip"
                    and not re.search(r";\s*q=0(?:\.0*)?\s*$", part)
                    for part in encodings.split(",")
                )
                body = compressed if use_gzip else content
                self.send_response(
                    HTTPStatus.NOT_MODIFIED if unchanged else HTTPStatus.OK
                )
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Vary", "Accept-Encoding")
                if not unchanged:
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    if use_gzip:
                        self.send_header("Content-Encoding", "gzip")
                    self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if not unchanged:
                    self.wfile.write(body)
            except (
                OSError,
                ValueError,
                RuntimeError,
                subprocess.SubprocessError,
            ) as error:
                self.send_json(
                    {"error": str(error)}, status=HTTPStatus.INTERNAL_SERVER_ERROR
                )
            return
        if route == "/":
            self.path = "/GUI/index.html"
        if route == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        super().do_GET()

    def local_request(self) -> bool:
        return self.headers.get("Origin") in {
            None,
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        }

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        if route not in {"/api/capri/chat", "/api/capri/speech"}:
            self.send_json({"error": "Unknown endpoint."}, HTTPStatus.NOT_FOUND)
            return
        if not self.local_request():
            self.send_json(
                {"error": "This request must come from the local app."},
                HTTPStatus.FORBIDDEN,
            )
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if route == "/api/capri/speech":
                if not 0 <= size <= 32000 or self.headers.get_content_type() != "application/octet-stream":
                    raise ValueError("Send at most one second of 16 kHz mono PCM audio.")
                self.send_json(SPEECH.feed(self.headers.get("X-Speech-Session", ""), self.rfile.read(size)))
                return
            if not 0 < size <= 32768:
                raise CapriError("The chat request is too large or empty.", 413)
            if self.headers.get_content_type() != "application/json":
                raise CapriError("Send the chat request as JSON.", 415)
            payload = json.loads(self.rfile.read(size))
            CAPRI.validate(payload)
            self.send_json(
                CAPRI.reply(
                    payload,
                    TERRAIN.context(
                        payload.get("selected_authority"), payload.get("selected_year")
                    ),
                )
            )
        except CapriError as error:
            self.send_json({"error": str(error)}, HTTPStatus(error.status))
        except (ValueError, UnicodeError):
            self.send_json(
                {"error": "Invalid speech or chat request."}, HTTPStatus.BAD_REQUEST
            )
        except (OSError, RuntimeError, subprocess.SubprocessError):
            self.send_json(
                {"error": "The map context is temporarily unavailable."},
                HTTPStatus.SERVICE_UNAVAILABLE,
            )

    def do_DELETE(self) -> None:
        if urlparse(self.path).path != "/api/capri/speech":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self.local_request():
            self.send_json({"error": "This request must come from the local app."}, HTTPStatus.FORBIDDEN)
            return
        SPEECH.close(self.headers.get("X-Speech-Session", ""))
        self.send_json({"closed": True})

    def send_json(
        self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK
    ) -> None:
        content = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode(
            "utf-8"
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the UK economic-terrain map.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Validate terrain generation without starting the server.",
    )
    args = parser.parse_args()

    if args.build_only:
        metadata = TERRAIN.metadata()
        print(json.dumps(metadata, indent=2))
        return

    try:
        server = LocalHTTPServer(("127.0.0.1", args.port), TerrainRequestHandler)
    except OSError:
        parser.exit(
            1,
            f"Could not open port {args.port}. Stop the running map server first, or choose another --port.\n",
        )
    print(f"Terrain map available at http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nTerrain server stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
