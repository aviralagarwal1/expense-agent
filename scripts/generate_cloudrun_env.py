"""Build a Cloud Run --env-vars-file YAML from .env (secrets stay out of repo)."""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOTENV = ROOT / ".env"


def parse_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip().strip('"').strip("'")
            env[key] = val
    return env


def main() -> None:
    env = parse_env(DOTENV)
    try:
        supabase_url = env["SUPABASE_URL"]
        service_key = env["SUPABASE_SERVICE_KEY"]
    except KeyError as e:
        raise SystemExit(f"Missing {e.args[0]} in {DOTENV}") from e

    # Prefer CLOUDRUN_APP_URL when .env still points at localhost for local dev.
    app_url = (os.environ.get("CLOUDRUN_APP_URL") or env.get("APP_URL") or "").strip().rstrip("/")
    if not app_url:
        raise SystemExit(
            f"Set APP_URL in {DOTENV} to your public origin, or set CLOUDRUN_APP_URL for this command only."
        )

    cfg = {
        "SUPABASE_URL": supabase_url,
        "SUPABASE_SERVICE_KEY": service_key,
        "APP_URL": app_url,
    }
    fd, path = tempfile.mkstemp(suffix=".yaml", text=True)
    p = Path(path)
    p.write_text(
        "\n".join(f"{k}: {json.dumps(v)}" for k, v in cfg.items()) + "\n",
        encoding="utf-8",
    )
    print(str(p.resolve()))


if __name__ == "__main__":
    main()
