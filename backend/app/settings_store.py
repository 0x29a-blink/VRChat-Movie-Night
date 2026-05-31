"""Runtime-editable settings, backed by the DB, falling back to .env defaults."""
import json
from typing import Any

from .config import settings as env_settings
from .db import SessionLocal
from .models import Setting

# Keys the user can edit at runtime, with their type for coercion.
EDITABLE: dict[str, type] = {
    "obs_host": str,
    "obs_port": int,
    "obs_password": str,
    "obs_media_input": str,
    "obs_scene": str,
    "tmdb_api_key": str,
    "aiostreams_base": str,
    "torbox_api_key": str,
    "max_concurrent_downloads": int,
    "use_deno": bool,
    "skip_small": int,
    "skip_large": int,
    "queue_loop": bool,
    "obs_media_volume": float,
    "hls_public_host": str,
    "hls_stream_path": str,
}


def _default(key: str) -> Any:
    return getattr(env_settings, key, None)


def get(key: str, default: Any = None) -> Any:
    # 1) DB override (set via Settings page)
    with SessionLocal() as s:
        row = s.get(Setting, key)
        if row is not None and row.value != "":
            try:
                return json.loads(row.value)
            except json.JSONDecodeError:
                return row.value
    # 2) .env / environment default (only for known config fields)
    env_val = _default(key)
    if env_val is not None:
        return env_val
    # 3) caller-provided fallback
    return default


def set_value(key: str, value: Any) -> None:
    with SessionLocal() as s:
        row = s.get(Setting, key)
        payload = json.dumps(value)
        if row is None:
            s.add(Setting(key=key, value=payload))
        else:
            row.value = payload
        s.commit()


def update(values: dict[str, Any]) -> None:
    for key, raw in values.items():
        if key not in EDITABLE:
            continue
        caster = EDITABLE[key]
        try:
            if caster is bool and isinstance(raw, str):
                value = raw.lower() in ("1", "true", "yes", "on")
            else:
                value = caster(raw)
        except (TypeError, ValueError):
            continue
        set_value(key, value)


def public() -> dict[str, Any]:
    """Return current editable settings for the Settings page."""
    return {key: get(key) for key in EDITABLE}
