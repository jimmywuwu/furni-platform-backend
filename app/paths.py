from __future__ import annotations

import os
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = APP_DIR.parent
DATA_DIR = Path(os.getenv("FURNI_DATA_DIR", str(PROJECT_ROOT))).expanduser().resolve()
DB_PATH = Path(os.getenv("FURNI_DB_PATH", str(DATA_DIR / "furni.db"))).expanduser().resolve()
ASSETS_DIR = Path(os.getenv("FURNI_ASSETS_DIR", str(DATA_DIR / "assets"))).expanduser().resolve()
STATIC_DIR = Path(os.getenv("FURNI_STATIC_DIR", str(DATA_DIR / "static"))).expanduser().resolve()


def ensure_runtime_dirs() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
