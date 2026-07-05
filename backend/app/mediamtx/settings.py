"""MediaMTX HLS presets — live apply via Control API + persist to mediamtx.yml."""

from __future__ import annotations

import re
from typing import Any

import httpx

from ..config import PROJECT_ROOT
from ..network_utils import MTX_API_PORT
from ..settings_store import get as setting_get
from ..settings_store import set_value as setting_set

MEDIAMTX_YML = PROJECT_ROOT / "MediaMTX" / "mediamtx.yml"
PRESET_SETTING_KEY = "mediamtx_preset"

HLS_KEYS = ("hlsSegmentDuration", "hlsSegmentCount", "hlsAlwaysRemux", "hlsVariant")

PRESETS: list[dict[str, Any]] = [
    {
        "id": "compatibility",
        "name": "Compatibility",
        "description": (
            "4s HLS segments — best for weak Wi‑Fi or VRChat PC stutter after low-latency tuning. "
            "Higher delay (~12s+ from packaging)."
        ),
        "settings": {
            "hlsSegmentDuration": "4s",
            "hlsSegmentCount": 7,
            "hlsAlwaysRemux": True,
            "hlsVariant": "mpegts",
        },
    },
    {
        "id": "balanced",
        "name": "Balanced",
        "description": "2s segments — middle ground between delay and stability.",
        "settings": {
            "hlsSegmentDuration": "2s",
            "hlsSegmentCount": 5,
            "hlsAlwaysRemux": True,
            "hlsVariant": "mpegts",
        },
    },
    {
        "id": "low_latency",
        "name": "Low latency",
        "description": (
            "1s segments — lowest MediaMTX delay; may stutter on slow links. "
            "Match OBS keyframe interval ~2s."
        ),
        "settings": {
            "hlsSegmentDuration": "1s",
            "hlsSegmentCount": 4,
            "hlsAlwaysRemux": True,
            "hlsVariant": "mpegts",
        },
    },
]

_PRESET_BY_ID = {p["id"]: p for p in PRESETS}


def list_presets() -> list[dict[str, Any]]:
    return [
        {"id": p["id"], "name": p["name"], "description": p["description"]}
        for p in PRESETS
    ]


def active_preset_id() -> str:
    raw = setting_get(PRESET_SETTING_KEY, "")
    if isinstance(raw, str) and raw in _PRESET_BY_ID:
        return raw
    return "low_latency"


def _yaml_value(val: Any) -> str:
    if isinstance(val, bool):
        return "true" if val else "false"
    return str(val)


def _patch_mediamtx_yml(updates: dict[str, Any]) -> None:
    if not MEDIAMTX_YML.is_file():
        raise FileNotFoundError(f"Missing {MEDIAMTX_YML}")
    text = MEDIAMTX_YML.read_text(encoding="utf-8")
    for key, val in updates.items():
        if key not in HLS_KEYS:
            continue
        repl = _yaml_value(val)
        pattern = rf"^({re.escape(key)}:\s*).*$"
        new_text, n = re.subn(pattern, rf"\g<1>{repl}", text, count=1, flags=re.MULTILINE)
        if n == 0:
            raise ValueError(f"Key {key} not found in mediamtx.yml")
        text = new_text
    MEDIAMTX_YML.write_text(text, encoding="utf-8")


def _pick_hls(global_cfg: dict) -> dict[str, Any]:
    return {k: global_cfg.get(k) for k in HLS_KEYS if k in global_cfg}


async def fetch_global_hls() -> dict[str, Any]:
    url = f"http://127.0.0.1:{MTX_API_PORT}/v3/config/global/get"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return {"api_reachable": False, "error": f"HTTP {r.status_code}"}
            data = r.json()
            return {"api_reachable": True, "hls": _pick_hls(data)}
    except httpx.HTTPError as exc:
        return {"api_reachable": False, "error": str(exc)}


async def apply_preset(preset_id: str) -> dict[str, Any]:
    preset = _PRESET_BY_ID.get(preset_id)
    if not preset:
        raise ValueError(f"Unknown preset: {preset_id}")
    settings = preset["settings"]
    _patch_mediamtx_yml(settings)

    url = f"http://127.0.0.1:{MTX_API_PORT}/v3/config/global/patch"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.patch(url, json=settings)
            if r.status_code != 200:
                raise RuntimeError(
                    f"MediaMTX API returned {r.status_code}: {r.text[:200]}"
                )
    except httpx.HTTPError as exc:
        raise RuntimeError(f"MediaMTX API not reachable on port {MTX_API_PORT}: {exc}") from exc

    setting_set(PRESET_SETTING_KEY, preset_id)
    live = await fetch_global_hls()
    return {
        "ok": True,
        "preset_id": preset_id,
        "preset_name": preset["name"],
        "applied": settings,
        "yaml_updated": True,
        **live,
    }


async def status() -> dict[str, Any]:
    live = await fetch_global_hls()
    return {
        "presets": list_presets(),
        "active_preset_id": active_preset_id(),
        **live,
    }
