"""Shared fixtures. Every test runs hermetically inside a scratch config dir."""
import pytest
from fastapi.testclient import TestClient

from app import bootstrap
from app.main import create_app


@pytest.fixture()
def scratch(tmp_path, monkeypatch):
    """Simulate a fresh laptop: INGESTLIB_CONFIG is unset, wizard writes land
    under tmp_path, and the working directory holds no config.yaml for the
    parent walk to find."""
    monkeypatch.delenv(bootstrap.CONFIG_ENV_VAR, raising=False)
    monkeypatch.delenv(bootstrap.FORCE_UNCONFIGURED_VAR, raising=False)
    monkeypatch.setenv(bootstrap.CONFIG_DIR_VAR, str(tmp_path / "confdir"))
    monkeypatch.chdir(tmp_path)
    return tmp_path


@pytest.fixture()
def client(scratch):
    return TestClient(create_app())


@pytest.fixture()
def configured_client(scratch):
    """A client whose scratch directory holds a minimal valid configuration."""
    directory = bootstrap.config_dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "config.yaml").write_text(
        'aws:\n  profile: p\n  region: us-east-1\n  account_id: "1"\n'
    )
    return TestClient(create_app())
