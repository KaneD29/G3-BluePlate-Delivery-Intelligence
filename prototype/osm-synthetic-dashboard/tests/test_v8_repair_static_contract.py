"""Security and frontend sync regression checks; no live services needed."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_no_global_broken_sync_listener():
    script = (ROOT / 'frontend/assets/app.js').read_text()
    assert "document.addEventListener('blueplate:synced'" not in script
    assert 'window.BluePlateApp={' in script
    assert 'setAdmin({restaurants,alerts,trend})' in script


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


def test_private_env_not_in_source_bundle():
    assert not (ROOT / '.env').exists()
    assert not (ROOT / '.venv').exists()
    assert (ROOT / '.env.example').exists()
