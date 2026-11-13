"""Serve BluePlate dashboard datasets directly from its MySQL schema."""

import gzip
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import urlsplit


SCHEMA = "2026_3dsa_3_blueplate"
ROUTES = {"/data/blueplate.json": "blueplate", "/data/orders.json": "orders"}
CACHE_SECONDS = 30
MAX_RESPONSE_BYTES = 32 * 1024 * 1024


def fetch_dataset(dataset, credentials):
    if dataset not in ROUTES.values():
        raise ValueError("Unknown dataset")
    # JSON serialization escapes delimiters in MySQL's line-oriented output.
    sql = f"""
START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY;
SELECT JSON_ARRAY(0, section, is_array, payload)
FROM dashboard_sections WHERE dataset = '{dataset}' ORDER BY section;
SELECT JSON_ARRAY(1, section, ordinal, payload)
FROM dashboard_rows WHERE dataset = '{dataset}' ORDER BY section, ordinal;
COMMIT;
"""
    command = [
        "/usr/bin/mysql", f"--defaults-file={credentials}", "--no-login-paths",
        "--ssl-mode=VERIFY_IDENTITY", "--binary-mode", "--skip-reconnect",
        "--local-infile=0", "--connect-timeout=5", "--default-character-set=utf8mb4", "--batch", "--raw",
        "--skip-column-names", "--database", SCHEMA,
    ]
    result = subprocess.run(command, input=sql.encode(), capture_output=True, check=True, timeout=20)
    if not result.stdout or len(result.stdout) > MAX_RESPONSE_BYTES:
        raise ValueError("Invalid dataset response size")
    sections = {}
    arrays = set()
    for line in result.stdout.splitlines():
        row_type, section, flag_or_ordinal, value = json.loads(line)
        if row_type == 0:
            if section in sections:
                raise ValueError("Duplicate section metadata")
            if flag_or_ordinal == 1:
                if value is not None:
                    raise ValueError("Array metadata has a scalar value")
                arrays.add(section)
                sections[section] = []
            elif flag_or_ordinal == 0:
                sections[section] = value
            else:
                raise ValueError("Invalid section metadata")
        else:
            if row_type != 1 or section not in arrays or flag_or_ordinal != len(sections[section]):
                raise ValueError("Unexpected row order")
            sections[section].append(value)
    required = {"restaurants", "cities", "priceChanges", "alerts"} if dataset == "blueplate" else {"fields", "rows", "menus"}
    if not required.issubset(sections) or any(not sections[key] for key in required):
        raise ValueError("Incomplete dashboard dataset")
    raw = json.dumps(sections, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    return raw, gzip.compress(raw, compresslevel=3, mtime=0)


class DataHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond(send_body=True)

    def do_HEAD(self):
        self.respond(send_body=False)

    def respond(self, send_body):
        dataset = ROUTES.get(urlsplit(self.path).path)
        if dataset is None:
            self.send_error(404)
            return
        try:
            cached = self.server.cache.get(dataset)
            if cached is None or cached[0] <= time.monotonic():
                raw, compressed = fetch_dataset(dataset, self.server.credentials)
                cached = self.server.cache[dataset] = (time.monotonic() + CACHE_SECONDS, raw, compressed)
        except (OSError, subprocess.SubprocessError, ValueError):
            self.log_error("MySQL dataset refresh failed for %s", dataset)
            self.send_error(503, "Dataset temporarily unavailable")
            return
        use_gzip = any(
            encoding.strip().lower() == "gzip"
            for encoding in self.headers.get("Accept-Encoding", "").split(",")
        )
        body = cached[2 if use_gzip else 1]
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        if use_gzip:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        if send_body:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, format, *args):
        if format != '"%s" %s %s':
            super().log_message(format, *args)


def main():
    credentials = Path(os.environ["CREDENTIALS_DIRECTORY"]) / "mysql.cnf"
    with HTTPServer(("127.0.0.1", 18182), DataHandler) as server:
        server.credentials = credentials
        server.cache = {}
        server.serve_forever()


if __name__ == "__main__":
    main()
