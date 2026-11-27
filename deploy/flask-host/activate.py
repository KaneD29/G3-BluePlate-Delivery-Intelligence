#!/usr/bin/env python3
"""Activate BluePlate Flask releases using the existing scoped SSM delivery."""

from contextlib import closing
import fcntl
import gzip
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request


ACCOUNT = "173677044880"
INSTANCE = "i-068efaae507c5294d"
BUCKET = f"msi-ust-paid-sites-{ACCOUNT}-us-east-1"
DOMAIN = "blueplate.space"
ROOT = Path("/srv/ust-paid-sites/blueplate")
RELEASES = ROOT / "flask-releases"
STAGING = ROOT / "flask-staging"
CONFIG = Path("/etc/blueplate-flask")
STATE = Path("/var/lib/blueplate-flask/state.json")
NGINX = Path("/etc/nginx/sites-available/ust-blueplate-pending")
PORTS = (18584, 18585)
MAX_COMPRESSED = 64 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
MAX_FILES = 5000
SHA256 = re.compile(r"[a-f0-9]{64}")
RELEASE_ID = re.compile(r"[a-f0-9]{40}-[1-9][0-9]{0,19}-[1-9][0-9]{0,3}")
PATH = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.+-]*(/[A-Za-z0-9_][A-Za-z0-9_.+-]*)*")
APP_ROOTS = ("app/frontend/", "app/etl/", "app/web_app_example/")
APP_FILES = {"app/database/13_versioned_bi.sql", "app/docs/VERSIONED_BI_WAREHOUSE.md"}
REQUIRED = APP_FILES | {
    "app/frontend/index.html", "app/web_app_example/flask_db_connector.py",
    "vendor/flask/__init__.py", "vendor/gunicorn/__init__.py",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(*arguments):
    return subprocess.run(arguments, check=True, capture_output=True, timeout=25)


def trusted_directory(path):
    st = path.lstat()
    require(path.is_dir() and path.resolve() == path and st.st_uid == 0 and not st.st_mode & 0o022,
            f"Untrusted directory: {path}")


def atomic_bytes(path, data, mode):
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".update-", delete=False) as file:
        temporary = Path(file.name)
        os.fchmod(file.fileno(), mode)
        file.write(data)
        file.flush()
        os.fsync(file.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def pointer(path, target):
    if target is None:
        path.unlink(missing_ok=True)
        return
    temporary = path.with_name(path.name + ".new")
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, path)


def current_target(path):
    if path.is_symlink():
        target = path.resolve(strict=True)
        require(target.parent == RELEASES and RELEASE_ID.fullmatch(target.name), "Invalid release target")
        return target
    require(not path.exists(), "Unexpected release pointer")
    return None


def verify_instance():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    metadata = "http://169.254.169.254/latest/"
    request = urllib.request.Request(metadata + "api/token", method="PUT",
                                     headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"})
    with opener.open(request, timeout=3) as response:
        token = response.read().decode()
    request = urllib.request.Request(metadata + "meta-data/instance-id",
                                     headers={"X-aws-ec2-metadata-token": token})
    with opener.open(request, timeout=3) as response:
        require(response.read().decode() == INSTANCE, "Unexpected EC2 instance")


def download(key, archive):
    import boto3
    from botocore.config import Config

    client = boto3.client("s3", region_name="us-east-1", config=Config(connect_timeout=5, read_timeout=20))
    response = client.get_object(Bucket=BUCKET, Key=key, ExpectedBucketOwner=ACCOUNT)
    require(0 < response["ContentLength"] <= MAX_COMPRESSED, "Compressed archive size is invalid")
    count = 0
    with closing(response["Body"]) as body, archive.open("xb") as out:
        for chunk in body.iter_chunks(chunk_size=1024 * 1024):
            count += len(chunk)
            require(count <= MAX_COMPRESSED, "Compressed archive exceeds limit")
            out.write(chunk)
    require(count == response["ContentLength"], "Incomplete artifact transfer")


def extract(archive, candidate, workspace, identity, sha, approved):
    with archive.open("rb") as stream:
        require(hashlib.file_digest(stream, "sha256").hexdigest() == sha, "Artifact checksum mismatch")
    tar = workspace / "release.tar"
    size = 0
    with gzip.open(archive, "rb") as source, tar.open("xb") as out:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
            require(size <= MAX_EXPANDED, "Expanded archive exceeds limit")
            out.write(chunk)
    candidate.mkdir(mode=0o755)
    paths = {}
    manifest = None
    with tarfile.open(tar, "r:") as bundle:
        for member in bundle:
            name = member.name
            require(len(paths) + (manifest is not None) < MAX_FILES and member.isfile() and not member.issparse()
                    and not member.mode & 0o7000 and set(member.pax_headers) <= {"path"} and name not in paths,
                    "Invalid or duplicate archive member")
            with bundle.extractfile(member) as source:
                if name == "manifest.json":
                    require(manifest is None and 0 < member.size <= 1024 * 1024, "Invalid manifest")
                    manifest = json.load(source)
                    continue
                require(len(name) <= 240 and PATH.fullmatch(name)
                        and (name in APP_FILES or name.startswith(APP_ROOTS) or name.startswith("vendor/")),
                        "Archive path is outside the runtime scope")
                out_path = candidate / name
                out_path.parent.mkdir(parents=True, mode=0o755, exist_ok=True)
                with out_path.open("xb") as out:
                    shutil.copyfileobj(source, out)
                with out_path.open("rb") as installed:
                    paths[name] = hashlib.file_digest(installed, "sha256").hexdigest()
    require(REQUIRED <= paths.keys(), "Missing BluePlate runtime files")
    require(manifest == {**identity, "files": paths, "warehouse_files": approved},
            "Release identity, file digests, or reviewed warehouse contract differs")


def check_app(port, revision=None):
    https = revision is not None
    base = f"https://{DOMAIN}" if https else f"http://127.0.0.1:{port}"
    routed = ("--resolve", f"{DOMAIN}:443:127.0.0.1") if https else ()
    for path, wanted in (("/api/health", ("service", "blueplate-local-flask")),
                         ("/api/ready", ("status", "ready")),
                         ("/api/dashboard/student-period?latest=1", ("public_listings", 274))):
        proc = run("curl", "-fsS", "--noproxy", "*", "--max-time", "7", "-D", "-", *routed, base + path)
        headers, body = proc.stdout.split(b"\r\n\r\n", 1)
        if https:
            require(f"x-blueplate-revision: {revision}".encode() in headers.lower().splitlines(),
                    "Production HTTPS is serving a different revision")
        key, value = wanted
        result = json.loads(body)
        require(result.get(key) == value, f"Unhealthy BluePlate response: {path}")
    require(b"<html" in run("curl", "-fsS", "--noproxy", "*", "--max-time", "7", *routed, base + "/dashboard/").stdout.lower(),
            "Dashboard did not serve HTML")


def wait_app(port, revision=None):
    deadline = time.monotonic() + 30
    while True:
        try:
            check_app(port, revision)
            return
        except (ValueError, subprocess.SubprocessError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)


def nginx_reload():
    run("nginx", "-t", "-q")
    run("systemctl", "reload", "nginx")


def main():
    phase = "preflight"
    try:
        key, digest, revision, run_id, run_attempt = sys.argv[1:]
        release_id = f"{revision}-{run_id}-{run_attempt}"
        require(os.geteuid() == 0 and sys.version_info[:2] == (3, 14)
                and RELEASE_ID.fullmatch(release_id) and SHA256.fullmatch(digest), "Invalid deployment inputs")
        require(key == f"paid-sites/blueplate/{revision}/{run_id}-{run_attempt}.tar.gz", "Invalid artifact key")
        for path in (ROOT, RELEASES, STAGING, CONFIG, STATE.parent):
            trusted_directory(path)
        require(shutil.disk_usage(ROOT).free > 512 * 1024 * 1024, "Insufficient release storage")
        verify_instance()
        # The service account needs to traverse releases even when SSM has a restrictive umask.
        os.umask(0o022)
        identity = {"format": 2, "project": "blueplate", "repository_id": "1445569871",
                    "revision": revision, "ref": "refs/heads/main", "run_id": run_id,
                    "run_attempt": run_attempt, "runtime": "cp314-linux-x86_64"}
        approved = json.loads((CONFIG / "warehouse-baseline.json").read_text())
        with (STATE.parent / "deploy.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            old = json.loads(STATE.read_text()) if STATE.exists() else None
            if old:
                require(old["port"] in PORTS and RELEASE_ID.fullmatch(old["current"]), "Malformed release state")
                current_order = tuple(map(int, old["current"].rsplit("-", 2)[1:]))
                if current_order > (int(run_id), int(run_attempt)):
                    print("DEPLOY_STATUS stale")
                    return 0
                if old["current"] == release_id:
                    phase = "health"
                    check_app(old["port"], revision)
                    print("DEPLOY_STATUS already-active")
                    return 0
            port = next(port for port in PORTS if not old or port != old["port"])
            slot = ROOT / f"flask-slot-{port}"
            unit = f"blueplate-flask@{port}.service"
            prior_target = current_target(slot)
            destination = RELEASES / release_id
            require(not destination.exists() and not destination.is_symlink(), "Release attempt already exists")
            with tempfile.TemporaryDirectory(dir=STAGING, prefix="attempt-") as temp:
                workspace = Path(temp)
                archive = workspace / "release.tar.gz"
                phase = "download"
                download(key, archive)
                phase = "validation"
                extract(archive, workspace / "candidate", workspace, identity, digest, approved)
                (workspace / "candidate").rename(destination)
            phase = "health"
            previous_nginx = NGINX.read_bytes()
            nginx_changed = False
            try:
                pointer(slot, destination)
                subprocess.run(["systemctl", "reset-failed", unit], check=False, capture_output=True, timeout=15)
                run("systemctl", "restart", unit)
                wait_app(port)
                phase = "activation"
                template = (CONFIG / "nginx-template.conf").read_text()
                require(template.count("@PORT@") == 1 and template.count("@REVISION@") == 1,
                        "Invalid BluePlate Nginx template")
                config = template.replace("@PORT@", str(port)).replace("@REVISION@", revision).encode()
                atomic_bytes(NGINX, config, 0o644)
                nginx_changed = True
                nginx_reload()
                wait_app(port, revision)
                run("systemctl", "enable", unit)
                new = {"current": release_id, "port": port, "previous": old["current"] if old else None}
                atomic_bytes(STATE, (json.dumps(new) + "\n").encode(), 0o600)
            except Exception:
                if nginx_changed:
                    atomic_bytes(NGINX, previous_nginx, 0o644)
                    nginx_reload()
                    if old:
                        wait_app(old["port"], old["current"].split("-")[0])
                    else:
                        run("curl", "-fsS", "--max-time", "7", "--resolve", f"{DOMAIN}:443:127.0.0.1",
                            f"https://{DOMAIN}/")
                run("systemctl", "disable", "--now", unit)
                pointer(slot, prior_target)
                raise
            try:
                if old:
                    run("systemctl", "disable", "--now", f"blueplate-flask@{old['port']}.service")
                for previous in RELEASES.iterdir():
                    if previous.name not in {new["current"], new["previous"]} and RELEASE_ID.fullmatch(previous.name):
                        require(previous.is_dir() and not previous.is_symlink(), "Untrusted previous release")
                        shutil.rmtree(previous)
            except Exception:
                logging.exception("BluePlate activation succeeded but retention needs attention")
        print("MIGRATION_STATUS unchanged")
        print("DEPLOY_STATUS activated")
        return 0
    except Exception:
        logging.exception("BluePlate failed during %s", phase)
        print(f"DEPLOY_STATUS failed-{phase}")
        return 1


if __name__ == "__main__":
    logging.basicConfig(filename=str(STATE.parent / "deploy.log"), level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    sys.exit(main())
