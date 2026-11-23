"""Security and frontend sync regression checks; no live services needed."""
from pathlib import Path
import zipfile

import pytest

from tools.package_release import CHECKSUMS, create_release, verify_release

ROOT = Path(__file__).resolve().parents[1]


def test_no_global_broken_sync_listener():
    script = (ROOT / 'frontend/assets/app.js').read_text()
    assert "document.addEventListener('blueplate:synced'" not in script
    assert 'window.BluePlateApp={' in script
    assert 'setAdmin({restaurants,alerts,trend,' in script


def test_session_never_contains_admin_token():
    code = (ROOT / 'web_app_example/flask_db_connector.py').read_text()
    block = code.split('@app.get("/api/session")')[1].split('@app.get("/api/user/reviews")')[0]
    assert 'MANAGER_API_TOKEN' not in block
    assert 'manager_token' not in block
    assert 'Cache-Control' in block


def test_browser_bridge_does_not_fetch_manager_secret():
    code = (ROOT / 'frontend/assets/api-bridge.js').read_text()
    assert 'managerToken' not in code
    assert 'cloneNode' not in code
    assert '/api/dashboard/trends?' in code
    assert 'window.BluePlateApp' in code


def test_seed_does_not_promote_user_id_one():
    sql = (ROOT / 'database/09_v8_live_connection_seed.sql').read_text().lower()
    assert 'update role =' not in sql
    assert 'insert into app_users' not in sql


def test_private_env_not_in_source_bundle(tmp_path):
    first = tmp_path / "first.zip"
    second = tmp_path / "second.zip"
    names = create_release(ROOT, first)
    create_release(ROOT, second)
    assert names == verify_release(first)
    assert first.read_bytes() == second.read_bytes()
    with zipfile.ZipFile(first) as bundle:
        assert ".env.example" in names and CHECKSUMS in names
        assert ".env" not in names
        assert all(".venv" not in name and not name.endswith(".zip") for name in names)
        assert bundle.read(".env.example") == (ROOT / ".env.example").read_bytes()
    with pytest.raises(FileExistsError):
        create_release(ROOT, first)


@pytest.mark.parametrize("extra", [".env", ".env.local", ".venv/bin/python", "archive.zip",
                                    "cache/secret.pem", "backup.sql.gz", "../outside.py"])
def test_release_rejects_forbidden_allowlist_entries(tmp_path, extra):
    (tmp_path / "release-files.txt").write_text(f"release-files.txt\n{extra}\n")
    with pytest.raises(ValueError, match="Forbidden release path"):
        create_release(tmp_path, tmp_path / "out.zip")


def test_release_rejects_credentials_without_printing_values(tmp_path):
    (tmp_path / "release-files.txt").write_text("release-files.txt\nfixture.txt\n")
    fake_value = "synthetic-private-value"
    (tmp_path / "fixture.txt").write_text("REPORT_PASSWORD=" + fake_value)
    with pytest.raises(ValueError, match="fixture.txt: environment assignment") as rejected:
        create_release(tmp_path, tmp_path / "out.zip")
    assert fake_value not in str(rejected.value)
    assert not (tmp_path / "out.zip").exists()


def test_release_leaves_unlisted_working_files_in_place(tmp_path):
    working = tmp_path / "working"
    working.mkdir()
    (working / "release-files.txt").write_text("release-files.txt\nREADME.md\n")
    (working / "README.md").write_text("Public fixture\n")
    (working / ".env").write_text("MYSQL_PASSWORD=test-only-secret\n")
    (working / ".venv").mkdir()
    (working / ".venv/bin").write_text("local interpreter\n")
    (working / "original.zip").write_bytes(b"test archive")
    release = tmp_path / "built.zip"
    names = create_release(working, release)
    assert names == ["README.md", CHECKSUMS, "release-files.txt"]
    assert (working / ".env").exists()
    assert (working / ".venv/bin").exists()
    assert (working / "original.zip").exists()
