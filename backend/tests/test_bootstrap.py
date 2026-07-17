"""Configuration resolution branches — pure, no network, no ingestlib."""
import os
import subprocess
import sys
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app import bootstrap


def test_fresh_laptop_is_unconfigured(scratch):
    assert bootstrap.resolve() == (False, None, None)


def test_env_var_wins_with_source_env_var(scratch, monkeypatch):
    config = scratch / "elsewhere.yaml"
    config.write_text("aws: {}\n")
    monkeypatch.setenv(bootstrap.CONFIG_ENV_VAR, str(config))
    configured, path, source = bootstrap.resolve()
    assert configured and path == str(config) and source == "env-var"


def test_home_config_exports_env_var_with_source_wizard(scratch, monkeypatch):
    bootstrap.config_dir().mkdir(parents=True)
    bootstrap.config_path().write_text("aws: {}\n")
    configured, path, source = bootstrap.resolve()
    assert configured and source == "wizard"
    assert os.environ[bootstrap.CONFIG_ENV_VAR] == str(bootstrap.config_path())
    # a second resolve now takes the env-var branch but keeps the wizard label
    assert bootstrap.resolve() == (True, str(bootstrap.config_path()), "wizard")


def test_cwd_discovery_with_source_cwd(scratch, monkeypatch):
    (scratch / "config.yaml").write_text("aws: {}\n")
    configured, path, source = bootstrap.resolve()
    assert configured and source == "cwd"
    assert bootstrap.CONFIG_ENV_VAR not in os.environ, "cwd discovery must not export"


def test_force_unconfigured_overrides_everything(scratch, monkeypatch):
    monkeypatch.setenv(bootstrap.CONFIG_ENV_VAR, "/some/config.yaml")
    monkeypatch.setenv(bootstrap.FORCE_UNCONFIGURED_VAR, "1")
    assert bootstrap.resolve() == (False, None, None)


def test_gate_returns_409_while_unconfigured(scratch):
    app = FastAPI()

    @app.get("/api/protected", dependencies=[Depends(bootstrap.require_configured)])
    def protected():
        return {"ok": True}

    response = TestClient(app).get("/api/protected")
    assert response.status_code == 409
    assert response.json()["detail"]["configured"] is False


def test_importing_the_app_never_imports_ingestlib():
    """Building the app and resolving configuration state must not import the
    library. In-process activation only works if the library first loads its
    configuration after the wizard has written the files. Checked in a fresh
    interpreter, because other tests import the library legitimately."""
    code = (
        "import sys; "
        "from app.main import create_app; "
        "from app import bootstrap; "
        "create_app(); "
        "bootstrap.resolve(); "
        "assert not any(m == 'ingestlib' or m.startswith('ingestlib.') "
        "for m in sys.modules), 'ingestlib was imported'"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert result.returncode == 0, result.stderr.decode()
