"""Build a Cloud Run --env-vars-file YAML from .env (secrets stay out of repo)."""
from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOTENV = ROOT / ".env"
# Production app URL (override localhost in .env)
APP_URL = "https://expenseagent.aviralagarwal.com"


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
    cfg = {
        "SUPABASE_URL": env["SUPABASE_URL"],
        "SUPABASE_SERVICE_KEY": env["SUPABASE_SERVICE_KEY"],
        "APP_URL": APP_URL,
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
