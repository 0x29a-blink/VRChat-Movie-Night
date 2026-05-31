"""Runtime-editable settings, backed by the DB, falling back to .env defaults."""
import json
from typing import Any

from .aiostreams_local import discover_local_aiostreams_base
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
    "aiostreams_auto": bool,
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
    "preserve_torrent_tracks": bool,
}

# Defaults when not set in DB or .env (torrents keep all tracks for OBS track picker).
_EDITABLE_DEFAULTS: dict[str, Any] = {
    "preserve_torrent_tracks": True,
}


def _default(key: str) -> Any:
    return getattr(env_settings, key, None)


def _db_raw(key: str) -> Any | None:
    with SessionLocal() as s:
        row = s.get(Setting, key)
        if row is None or row.value == "":
            return None
        try:
            return json.loads(row.value)
        except json.JSONDecodeError:
            return row.value


def is_aiostreams_auto() -> bool:
    stored = _db_raw("aiostreams_auto")
    if stored is not None:
        return bool(stored)
    manual = _db_raw("aiostreams_base")
    if manual:
        return False
    return True


def get_aiostreams_manual() -> str:
    manual = _db_raw("aiostreams_base")
    if isinstance(manual, str):
        return manual.strip()
    return ""


def get_aiostreams_discovered() -> str:
    return discover_local_aiostreams_base()


def get_aiostreams_effective() -> str:
    if is_aiostreams_auto():
        env_val = (_default("aiostreams_base") or "").strip()
        if env_val:
            return env_val.rstrip("/")
        return get_aiostreams_discovered()
    manual = get_aiostreams_manual()
    if manual:
        return manual.rstrip("/")
    env_val = (_default("aiostreams_base") or "").strip()
    return env_val.rstrip("/") if env_val else ""


def aiostreams_public_fields() -> dict[str, Any]:
    return {
        "aiostreams_auto": is_aiostreams_auto(),
        "aiostreams_base": get_aiostreams_manual(),
        "aiostreams_base_effective": get_aiostreams_effective(),
        "aiostreams_base_discovered": get_aiostreams_discovered(),
    }


def reset_aiostreams_auto() -> None:
    set_value("aiostreams_auto", True)
    set_value("aiostreams_base", "")


def get(key: str, default: Any = None) -> Any:
    if key == "aiostreams_auto":
        return is_aiostreams_auto()
    if key == "aiostreams_base":
        effective = get_aiostreams_effective()
        if effective:
            return effective
        return default

    with SessionLocal() as s:
        row = s.get(Setting, key)
        if row is not None and row.value != "":
            try:
                return json.loads(row.value)
            except json.JSONDecodeError:
                return row.value
    env_val = _default(key)
    if env_val is not None and env_val != "":
        return env_val
    if key in _EDITABLE_DEFAULTS:
        return _EDITABLE_DEFAULTS[key]
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
    out = {key: get(key) for key in EDITABLE if key not in ("aiostreams_base", "aiostreams_auto")}
    out.update(aiostreams_public_fields())
    return out
