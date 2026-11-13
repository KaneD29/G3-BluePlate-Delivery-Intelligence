"""Serve BluePlate dashboard datasets directly from its MySQL schema."""

import gzip
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
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
        "/usr/bin/timeout", "25", "/usr/bin/mysql", f"--defaults-file={credentials}", "--no-login-paths",
        "--ssl-mode=VERIFY_IDENTITY", "--binary-mode", "--skip-reconnect",
        "--local-infile=0", "--connect-timeout=5", "--default-character-set=utf8mb4", "--batch", "--raw",
        "--quick", "--skip-column-names", "--database", SCHEMA,
    ]
    # Stream MySQL rows to files so the service stays within its memory budget.
    directory = tempfile.TemporaryDirectory(prefix="blueplate-api-")
    root = Path(directory.name)
    required = {"restaurants", "cities", "priceChanges", "alerts"} if dataset == "blueplate" else {"fields", "rows", "menus"}
    seen = set()
    arrays = set()
    completed_arrays = set()
    active = None
    ordinal = 0
    size = 0
    try:
        with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL) as query:
            query.stdin.write(sql.encode())
            query.stdin.close()
            try:
                with (root / "data.json").open("wb") as raw, gzip.open(root / "data.gz", "wb", compresslevel=3) as compressed:
                    def write(chunk):
                        nonlocal size
                        size += len(chunk)
                        if size > MAX_RESPONSE_BYTES:
                            raise ValueError("Dataset exceeds response limit")
                        raw.write(chunk)
                        compressed.write(chunk)

                    def encode(value):
                        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()

                    write(b"{")
                    first = True
                    for line in query.stdout:
                        row_type, section, flag, value = json.loads(line)
                        if row_type == 0:
                            if section in seen or section in arrays or flag not in (0, 1):
                                raise ValueError("Invalid section metadata")
                            if flag == 1:
                                if value is not None:
                                    raise ValueError("Array metadata has a scalar value")
                                arrays.add(section)
                                continue
                            if not first:
                                write(b",")
                            write(encode(section) + b":" + encode(value))
                            seen.add(section)
                            first = False
                            continue
                        if row_type != 1 or section not in arrays:
                            raise ValueError("Invalid data row")
                        if section != active:
                            if active is not None:
                                write(b"]")
                            if section in completed_arrays:
                                raise ValueError("Repeated array section")
                            if not first:
                                write(b",")
                            write(encode(section) + b":[")
                            active, ordinal, first = section, 0, False
                            completed_arrays.add(section)
                        if flag != ordinal:
                            raise ValueError("Unexpected row order")
                        if ordinal:
                            write(b",")
                        write(encode(value))
                        ordinal += 1
                    if active is not None:
                        write(b"]")
                    if not required.issubset(completed_arrays):
                        raise ValueError("Incomplete dashboard dataset")
                    for section in sorted(arrays - completed_arrays):
                        if not first:
                            write(b",")
                        write(encode(section) + b":[]")
                        first = False
                    write(b"}")
                    if query.wait(timeout=10):
                        raise ValueError("MySQL query failed")
            except Exception:
                query.kill()
                raise
        return directory, root
    except Exception:
        directory.cleanup()
        raise

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
                directory, root = fetch_dataset(dataset, self.server.credentials)
                cached = self.server.cache[dataset] = (time.monotonic() + CACHE_SECONDS, directory, root)
        except (OSError, subprocess.SubprocessError, ValueError):
            self.log_error("MySQL dataset refresh failed for %s", dataset)
            self.send_error(503, "Dataset temporarily unavailable")
            return
        use_gzip = any(
            encoding.strip().lower() == "gzip"
            for encoding in self.headers.get("Accept-Encoding", "").split(",")
        )
        body = cached[2] / ("data.gz" if use_gzip else "data.json")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(body.stat().st_size))
        if use_gzip:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        if send_body:
            try:
                with body.open("rb") as response:
                    shutil.copyfileobj(response, self.wfile)
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
