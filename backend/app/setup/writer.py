"""Writes the wizard's answers to config.yaml and .env.

config.yaml receives only the user's answers; omitted keys fall back to the
library's defaults, which keeps the file small and lets library upgrades
improve defaults without editing it. Secrets are written to .env with file
mode 600 and never appear in the yaml.
"""
import os

from app import bootstrap
from app.setup.schemas import ALLOWED_SECRET_KEYS, CompleteRequest

_PADDLE_DEFAULTS = {"backend": "mlx-vlm-server", "server_url": "http://localhost:8111/"}


def render_config_yaml(answers: CompleteRequest) -> str:
    """Render config.yaml containing only the user's answers."""
    lines = [
        "# Written by ingestlib-studio setup. Only your answers live here;",
        "# every omitted key is an ingestlib library default.",
        "",
        "aws:",
        f"  profile: {answers.aws.profile}",
        f"  region: {answers.aws.region}",
        f'  account_id: "{answers.aws.account_id}"',
        "",
        f"vector_store: {answers.vector_store}",
        "",
        f"reranker: {answers.reranker}",
    ]
    if answers.bucket != f"ingestlib-{answers.aws.account_id}":  # the default stays unwritten
        lines += ["", "s3:", f"  bucket: {answers.bucket}"]
    paddle = answers.paddle_vl
    if paddle is not None and paddle.model_dump() != _PADDLE_DEFAULTS:
        lines += ["", "paddle_vl:"]
        if paddle.backend != _PADDLE_DEFAULTS["backend"]:
            lines.append(f"  backend: {paddle.backend}")
        if paddle.server_url != _PADDLE_DEFAULTS["server_url"]:
            lines.append(f"  server_url: {paddle.server_url}")
    return "\n".join(lines) + "\n"


def render_env(secrets: dict[str, str]) -> str:
    """Render .env from the allow-listed secrets. Unknown keys raise ValueError."""
    unknown = set(secrets) - set(ALLOWED_SECRET_KEYS)
    if unknown:
        raise ValueError(f"unknown secret key(s): {sorted(unknown)}")
    lines = ["# Written by ingestlib-studio setup. Secrets only; file mode 600."]
    lines += [f"{key}={secrets[key]}" for key in ALLOWED_SECRET_KEYS if key in secrets]
    return "\n".join(lines) + "\n"


def write_and_activate(answers: CompleteRequest) -> str:
    """Write both files and activate them in the running process.

    Returns the path of the written config.yaml. The library reads its
    configuration on first use, which happens after this call, so the fresh
    files take effect without a restart."""
    directory = bootstrap.config_dir()
    directory.mkdir(parents=True, exist_ok=True)

    bootstrap.config_path().write_text(render_config_yaml(answers))

    env_file = bootstrap.env_path()
    env_file.write_text(render_env(answers.secrets))
    os.chmod(env_file, 0o600)

    bootstrap.activate_written_config()
    return str(bootstrap.config_path())
