#!/usr/bin/env python3
"""Install the reviewed, project-specific BluePlate runner on the shared EC2 host."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def run(*args):
    subprocess.run(args, check=True, timeout=25)


def install(path, content, mode):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        os.fchmod(stream.fileno(), mode)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    if os.geteuid() or len(sys.argv) != 2:
        raise SystemExit("Run as root with the reviewed installation directory")
    source = Path(sys.argv[1]).resolve(strict=True)
    config = Path("/etc/blueplate-flask")
    app_root = Path("/srv/ust-paid-sites/blueplate")
    state = Path("/var/lib/blueplate-flask")
    var = Path("/usr/local/lib/ust-paid-sites")
    dispatcher = var / "deploy.py"
    runner = var / "deploy_blueplate_flask.py"
    nginx = Path("/etc/nginx/sites-available/ust-blueplate-pending")
    unit = Path("/etc/systemd/system/blueplate-flask@.service")
    for p in (config, app_root, var, dispatcher, nginx):
        info = p.lstat()
        if p.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError(f"Untrusted host path: {p}")
    if not (config / "app.env").is_file():
        raise ValueError("Verified production RDS configuration is required")
    if any(p.exists() or p.is_symlink() for p in (state, runner, unit)):
        raise ValueError("BluePlate Flask host deployment already exists")

    code = dispatcher.read_text()
    end = "if __name__ == '__main__':\n    raise SystemExit(main())\n"
    if code.count(end) != 1:
        raise ValueError("Unexpected installed shared dispatcher")
    hook = """if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'blueplate':
        os.execv(sys.executable, [sys.executable, '-I', '/usr/local/lib/ust-paid-sites/deploy_blueplate_flask.py', *sys.argv[2:]])
    raise SystemExit(main())
"""
    replacement = code.replace(end, hook)
    compile(replacement, str(dispatcher), "exec")
    runner_code = (source / "activate.py").read_bytes()
    compile(runner_code, str(runner), "exec")
    legacy = nginx.read_text()
    old = """    location / {
        add_header X-Content-Type-Options nosniff always;
        try_files $uri $uri/index.html @pending;
    }
"""
    proxy = """    location / {
        proxy_pass http://127.0.0.1:@PORT@;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Host "";
        proxy_connect_timeout 3s;
        proxy_read_timeout 35s;
        client_max_body_size 16k;
        add_header X-Content-Type-Options nosniff always;
        add_header X-BluePlate-Revision @REVISION@ always;
    }
"""
    if legacy.count(old) != 1 or legacy.count("server_name blueplate.space www.blueplate.space;") != 2:
        raise ValueError("Unexpected existing BluePlate Nginx configuration")
    template = legacy.replace(old, proxy)
    baseline = (source / "warehouse-baseline.json").read_bytes()
    values = json.loads(baseline)
    if not isinstance(values, dict) or not all(key and len(value) == 64 for key, value in values.items()):
        raise ValueError("Invalid reviewed warehouse baseline")

    backup_root = Path("/var/backups/blueplate-flask")
    backup_root.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backup_root / f"host-{stamp}"
    backup.mkdir(mode=0o700)
    shutil.copy2(dispatcher, backup / "legacy-deploy.py")
    shutil.copy2(nginx, backup / "legacy-nginx.conf")
    with tempfile.TemporaryDirectory(dir=backup) as temp:
        check = Path(temp) / "nginx.conf"
        check.write_text("events {}\nhttp {\n" + template.replace("@PORT@", "18584").replace("@REVISION@", "0" * 40)
                         + "\n}\n")
        run("nginx", "-t", "-q", "-c", str(check))
    if subprocess.run(["getent", "passwd", "blueplate-flask"], stdout=subprocess.DEVNULL).returncode:
        run("useradd", "--system", "--user-group", "--no-create-home", "--home-dir", "/nonexistent",
            "--shell", "/usr/sbin/nologin", "blueplate-flask")
    for path, mode in ((state, 0o700), (app_root / "flask-releases", 0o755), (app_root / "flask-staging", 0o700)):
        path.mkdir(mode=mode)
    install(config / "nginx-template.conf", template.encode(), 0o600)
    install(config / "warehouse-baseline.json", baseline, 0o600)
    install(runner, runner_code, 0o644)
    install(unit, (source / unit.name).read_bytes(), 0o644)
    run("systemd-analyze", "verify", str(unit))
    run("systemctl", "daemon-reload")
    with (var / "deploy.lock").open("a") as lock:
        import fcntl
        fcntl.flock(lock, fcntl.LOCK_EX)
        if dispatcher.read_text() != code or nginx.read_text() != legacy:
            raise ValueError("Existing deployment configuration changed during setup")
        install(dispatcher, replacement.encode(), 0o644)
    print(f"BLUEPLATE_HOST_READY {backup}")


if __name__ == "__main__":
    main()
