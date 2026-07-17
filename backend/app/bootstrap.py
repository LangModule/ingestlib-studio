"""Decides whether the studio is configured and where the configuration lives.

This module must not import ingestlib. The library reads its configuration
the first time it is used, so nothing in this process may touch it until the
wizard has written the configuration files. Once the files exist, setting
INGESTLIB_CONFIG is enough to activate them; no restart is required.

Resolution order:
    1. STUDIO_FORCE_UNCONFIGURED=1       unconfigured; lets developers test the
                                         wizard on an already-configured machine
    2. INGESTLIB_CONFIG is set           configured
    3. {config_dir}/config.yaml exists   configured; INGESTLIB_CONFIG is exported
    4. config.yaml in CWD or a parent    configured; the same discovery the
                                         library performs on its own
    5. otherwise                         unconfigured; only /api/setup/* works
"""
import os
from pathlib import Path

from fastapi import HTTPException

CONFIG_ENV_VAR = "INGESTLIB_CONFIG"
FORCE_UNCONFIGURED_VAR = "STUDIO_FORCE_UNCONFIGURED"
CONFIG_DIR_VAR = "STUDIO_CONFIG_DIR"


def config_dir() -> Path:
    """Directory that holds the wizard-written files.

    STUDIO_CONFIG_DIR overrides the default of ~/.ingestlib; tests and
    development setups use it to write somewhere disposable."""
    override = os.environ.get(CONFIG_DIR_VAR)
    return Path(override) if override else Path.home() / ".ingestlib"


def config_path() -> Path:
    return config_dir() / "config.yaml"


def env_path() -> Path:
    return config_dir() / ".env"


def _cwd_discovery() -> Path | None:
    cwd = Path.cwd()
    for directory in (cwd, *cwd.parents):
        candidate = directory / "config.yaml"
        if candidate.is_file():
            return candidate
    return None


def resolve() -> tuple[bool, str | None, str | None]:
    """Return (configured, config_path, source).

    The state is evaluated fresh on every call, so completing the wizard
    changes the answer within the running process. The source is "wizard"
    for the file this studio wrote, "env-var" for an externally managed
    file, and "cwd" for a file the library would discover by itself."""
    if os.environ.get(FORCE_UNCONFIGURED_VAR) == "1":
        return False, None, None

    explicit = os.environ.get(CONFIG_ENV_VAR)
    if explicit:
        source = "wizard" if explicit == str(config_path()) else "env-var"
        return True, explicit, source

    home = config_path()
    if home.is_file():
        os.environ[CONFIG_ENV_VAR] = str(home)
        return True, str(home), "wizard"

    found = _cwd_discovery()
    if found is not None:
        return True, str(found), "cwd"

    return False, None, None


def activate_written_config() -> None:
    """Activate the files the wizard just wrote.

    Sets INGESTLIB_CONFIG to the written config.yaml and clears the flag
    that simulates an unconfigured machine, so the next resolve() reports
    the studio as configured."""
    os.environ[CONFIG_ENV_VAR] = str(config_path())
    os.environ.pop(FORCE_UNCONFIGURED_VAR, None)


def require_configured() -> None:
    """FastAPI dependency for every router except setup.

    Responds with HTTP 409 until setup is complete, so no page can operate
    against a partially configured backend."""
    configured, _, _ = resolve()
    if not configured:
        raise HTTPException(
            status_code=409,
            detail={"configured": False, "hint": "complete /setup first"},
        )
