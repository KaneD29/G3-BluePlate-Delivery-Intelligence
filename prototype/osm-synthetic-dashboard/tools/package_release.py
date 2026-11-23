"""Build and audit the standalone BluePlate Flask source release."""
import argparse
import hashlib
import io
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST = "release-files.txt"
CHECKSUMS = "RELEASE-MANIFEST.sha256"
EXECUTABLES = {"RUN_BLUEPLATE_SYNTHETIC_DEMO.command"}
BLOCKED_DIRS = {
    ".git", ".aws", ".ssh", ".pytest_cache", "__pycache__", "__macosx",
    "node_modules", "venv", "dist", "reports", "restore_payload",
}
BLOCKED_SUFFIXES = {
    ".bak", ".backup", ".command.bak", ".db", ".dump", ".gz", ".key", ".log",
    ".p12", ".pem", ".pyc", ".pyo", ".rar", ".sqlitedb", ".sqlite", ".sqlite3",
    ".swp", ".tar", ".tmp", ".zip", ".7z", ".xz",
}
CONTENT_CHECKS = {
    "private key": rb"(?m)^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[ \t]*\r?$",
    "AWS access key": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "GitHub token": rb"\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,})\b",
    "password in database URI": rb"\b(?:mysql|postgres(?:ql)?)(?:\+[a-z0-9]+)?://[^\s:/@]+:[^\s/@]+@",
    "database dump header": rb"(?mi)^-- (?:MySQL dump|MariaDB dump|PostgreSQL database dump)",
    "environment assignment": (
        rb"(?m)^[ \t]*(?:export[ \t]+)?(?:[A-Z0-9_]*(?:PASSWORD|SECRET(?:_KEY)?|API_TOKEN|API_KEY))"
        rb"[ \t]*=[ \t]*(?!(?:replace_with_[a-z_]+|<[^>]+>)[ \t]*$)[a-zA-Z0-9_./+=:@\"'-]+[ \t]*$"
    ),
}


def permitted_path(name):
    path = PurePosixPath(name)
    return (bool(path.parts) and path.as_posix() == name and not path.is_absolute()
            and re.fullmatch(r"[a-zA-Z0-9_./-]+", name) is not None
            and all(part not in {"", ".", ".."} for part in path.parts)
            and not any(part.lower() in BLOCKED_DIRS or part.lower().startswith(".venv")
                        for part in path.parts)
            and (name in {".env.example", ".gitignore"} or not any(part.startswith(".") for part in path.parts))
            and path.suffix.lower() not in BLOCKED_SUFFIXES)


def release_paths(raw):
    names = raw.decode("utf-8").splitlines()
    if not names or len(names) != len(set(names)):
        raise ValueError("Empty release list or duplicate release paths")
    if CHECKSUMS in names or ALLOWLIST not in names:
        raise ValueError("Release list must include itself and exclude the generated checksum manifest")
    for name in names:
        if not permitted_path(name):
            raise ValueError(f"Forbidden release path: {name}")
    return sorted(names)


def audit_content(name, data):
    for label, pattern in CONTENT_CHECKS.items():
        if re.search(pattern, data):
            raise ValueError(f"Release audit rejected {name}: {label} signature")


def checksums(contents):
    return "".join(f"{hashlib.sha256(data).hexdigest()}  {name}\n"
                   for name, data in sorted(contents.items())).encode()


def verify_release(path):
    with zipfile.ZipFile(path) as bundle:
        names = bundle.namelist()
        if ALLOWLIST not in names:
            raise ValueError("Missing release list")
        permitted = release_paths(bundle.read(ALLOWLIST))
        if names != sorted([*permitted, CHECKSUMS]):
            raise ValueError("Archive members do not match the release list exactly")
        contents = {}
        for name in permitted:
            entry = bundle.getinfo(name)
            if not stat.S_ISREG(entry.external_attr >> 16):
                raise ValueError(f"Release entry is not a regular file: {name}")
            data = bundle.read(name)
            audit_content(name, data)
            contents[name] = data
        if bundle.read(CHECKSUMS) != checksums(contents):
            raise ValueError("Release checksum manifest does not match archive contents")
        return names


def create_release(root, output):
    root = root.resolve()
    contents = {}
    for name in release_paths((root / ALLOWLIST).read_bytes()):
        path = root / name
        if path.resolve() != path or path.is_symlink() or not path.is_file():
            raise ValueError(f"Missing file or symbolic link in release source: {name}")
        data = path.read_bytes()
        audit_content(name, data)
        contents[name] = data
    contents[CHECKSUMS] = checksums(contents)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        for name, data in sorted(contents.items()):
            entry = zipfile.ZipInfo(name)
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | (0o755 if name in EXECUTABLES else 0o644)) << 16
            bundle.writestr(entry, data)
    buffer.seek(0)
    names = verify_release(buffer)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as stream:
        stream.write(buffer.getbuffer())
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--output", type=Path, help="Create a new ZIP without overwriting any file")
    action.add_argument("--verify", type=Path, help="Verify an existing release ZIP")
    args = parser.parse_args()
    try:
        names = verify_release(args.verify) if args.verify else create_release(ROOT, args.output)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Release check failed: {error}\n")
    print(f"Verified {len(names)} release entries")


if __name__ == "__main__":
    main()
