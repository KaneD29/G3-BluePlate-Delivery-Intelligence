#!/usr/bin/env python3
"""Package the committed BluePlate Flask runtime and Linux vendor tree."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tarfile
import tempfile

APP = "prototype/osm-synthetic-dashboard/"
RUNTIME_ROOTS = ("web_app_example/", "frontend/", "etl/")
RUNTIME_FILES = {
    "etl/__init__.py", "etl/config.py", "database/13_versioned_bi.sql",
    "docs/VERSIONED_BI_WAREHOUSE.md",
}
MAX_COMPRESSED = 64 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
MAX_FILES = 5000
SAFE_PATH = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.+-]*(/[A-Za-z0-9_][A-Za-z0-9_.+-]*)*")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def committed(root, revision):
    entries = subprocess.check_output(
        ["git", "ls-tree", "-r", "-z", revision, "--", APP], cwd=root
    ).split(b"\0")
    blobs = {}
    for entry in filter(None, entries):
        details, raw_path = entry.split(b"\t", 1)
        mode, kind, blob = details.decode("ascii").split()
        path = raw_path.decode("utf-8")
        if kind != "blob" or mode not in ("100644", "100755"):
            raise ValueError(f"Unsupported committed file: {path}")
        blobs[path.removeprefix(APP)] = blob
    return blobs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-attempt", required=True)
    parser.add_argument("--vendor", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if (not re.fullmatch(r"[0-9a-f]{40}", args.revision)
            or args.ref != "refs/heads/main"
            or not re.fullmatch(r"[1-9][0-9]*", args.run_id)
            or not re.fullmatch(r"[1-9][0-9]*", args.run_attempt)):
        raise ValueError("Invalid release identity")

    root = Path.cwd()
    blobs = committed(root, args.revision)
    warehouse_paths = sorted(
        path for path in blobs
        if (path.startswith("database/") and path.endswith(".sql"))
        or path in ("tools/install_warehouse.py", "data/release/warehouse-seed.json")
    )
    if not warehouse_paths or not {
        "tools/install_warehouse.py", "data/release/warehouse-seed.json"
    }.issubset(warehouse_paths):
        raise ValueError("Warehouse inputs are incomplete")
    app_paths = sorted(path for path in blobs if path in RUNTIME_FILES or path.startswith(RUNTIME_ROOTS))
    if not RUNTIME_FILES.issubset(app_paths) or not {
        "frontend/index.html", "web_app_example/flask_db_connector.py"
    }.issubset(app_paths):
        raise ValueError("Application runtime files are incomplete")
    data = {}
    for path in sorted(set(app_paths) | set(warehouse_paths)):
        if not SAFE_PATH.fullmatch(path):
            raise ValueError(f"Invalid committed path: {path}")
        data[path] = subprocess.check_output(["git", "cat-file", "blob", blobs[path]], cwd=root)

    files = {f"app/{path}": data[path] for path in app_paths}
    vendor = args.vendor
    if not vendor.is_dir() or vendor.is_symlink():
        raise ValueError("A regular vendor directory is required")
    for base, dirs, names in os.walk(vendor, followlinks=False):
        base_path = Path(base)
        for directory in dirs:
            candidate = base_path / directory
            if not stat.S_ISDIR(candidate.lstat().st_mode):
                raise ValueError(f"Unsupported vendor directory: {candidate}")
        dirs[:] = sorted(d for d in dirs if d != "__pycache__" and d != "bin")
        for name in sorted(names):
            source = base_path / name
            rel = source.relative_to(vendor).as_posix()
            if name.endswith((".pyc", ".pyo")):
                continue
            if not SAFE_PATH.fullmatch(rel) or not stat.S_ISREG(source.lstat().st_mode):
                raise ValueError(f"Unsupported vendor file: {rel}")
            files[f"vendor/{rel}"] = source.read_bytes()
    if not any(path.startswith("vendor/flask/") for path in files):
        raise ValueError("Flask is missing from the vendor tree")
    if len(files) + 1 > MAX_FILES or sum(map(len, files.values())) > MAX_EXPANDED:
        raise ValueError("Artifact content exceeds its bounds")
    manifest = {
        "format": 2, "project": "blueplate", "repository_id": "1445569871",
        "revision": args.revision, "ref": args.ref, "run_id": args.run_id,
        "run_attempt": args.run_attempt, "runtime": "cp314-linux-x86_64",
        "warehouse_files": {path: digest(data[path]) for path in warehouse_paths},
        "files": {path: digest(content) for path, content in sorted(files.items())},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=args.out.parent, suffix=".tar.gz")
    os.close(fd)
    try:
        with tarfile.open(temp, "w:gz") as archive:
            manifest_bytes = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
            for name, content in [("manifest.json", manifest_bytes), *sorted(files.items())]:
                info = tarfile.TarInfo(name)
                info.size, info.mode, info.mtime = len(content), 0o644, 0
                archive.addfile(info, io.BytesIO(content))
        if Path(temp).stat().st_size > MAX_COMPRESSED:
            raise ValueError("Compressed artifact exceeds 64 MiB")
        with gzip.open(temp, "rb") as stream:
            total = sum(len(block) for block in iter(lambda: stream.read(1024 * 1024), b""))
        if total > MAX_EXPANDED:
            raise ValueError("Expanded artifact exceeds 128 MiB")
        os.replace(temp, args.out)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print(f"Packaged {len(files)} runtime files, sha256 {digest(args.out.read_bytes())}")


if __name__ == "__main__":
    main()
