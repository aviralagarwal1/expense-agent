"""Render scripts/og.html to static/og.png (1200x630) with headless Chrome.

usage: python scripts/render_og.py
Set CHROME to the browser binary if it is not found automatically.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "scripts" / "og.html"
OUTPUT = ROOT / "static" / "og.png"

CANDIDATES = [
    os.environ.get("CHROME", ""),
    "google-chrome", "chromium", "chromium-browser", "chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome() -> str:
    for candidate in CANDIDATES:
        if candidate and (shutil.which(candidate) or Path(candidate).exists()):
            return shutil.which(candidate) or candidate
    sys.exit("Chrome not found. Set CHROME to your Chrome or Chromium binary.")


def main() -> None:
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run([
            find_chrome(), "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--force-prefers-reduced-motion", f"--user-data-dir={profile}",
            "--virtual-time-budget=4000", "--window-size=1200,630",
            f"--screenshot={OUTPUT}", SOURCE.as_uri(),
        ], check=True, capture_output=True)
    print(f"Wrote {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
