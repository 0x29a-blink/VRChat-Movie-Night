"""Built-in OBS encoder / video presets for Settings → Stream quality."""

from __future__ import annotations

from typing import Any

# Partial output settings merged into live stream encoder (GetOutputSettings / SetOutputSettings).
# Keys vary by encoder (x264 vs NVENC); we only set keys present in the patch if they exist on the output.
ENCODER_PRESETS: list[dict[str, Any]] = [
    {
        "id": "normal",
        "name": "Normal (~6 Mbps)",
        "description": "Default movie night quality.",
        "settings": {
            "bitrate": 6000,
            "preset": "veryfast",
            "tune": "zerolatency",
            "keyint_sec": 2,
        },
    },
    {
        "id": "low",
        "name": "Low (~3 Mbps)",
        "description": "Softer upload — choppy internet.",
        "settings": {
            "bitrate": 3000,
            "preset": "veryfast",
            "tune": "zerolatency",
            "keyint_sec": 2,
        },
    },
    {
        "id": "emergency",
        "name": "Emergency (~1.5 Mbps)",
        "description": "Minimal bandwidth survival mode.",
        "settings": {
            "bitrate": 1500,
            "preset": "ultrafast",
            "tune": "zerolatency",
            "keyint_sec": 2,
        },
    },
]

# Applied only when stream is stopped (SetVideoSettings).
VIDEO_PRESETS: list[dict[str, Any]] = [
    {
        "id": "source",
        "name": "Match canvas (no downscale)",
        "description": "Output resolution follows base canvas.",
        "video": {},
    },
    {
        "id": "1440p",
        "name": "Downscale to 2560×1440",
        "description": "Lower encode load — apply before Go live.",
        "video": {
            "outputWidth": 2560,
            "outputHeight": 1440,
        },
    },
    {
        "id": "1080p",
        "name": "Downscale to 1920×1080",
        "description": "1080p output — apply before Go live.",
        "video": {
            "outputWidth": 1920,
            "outputHeight": 1080,
        },
    },
]


def encoder_preset(preset_id: str) -> dict[str, Any] | None:
    return next((p for p in ENCODER_PRESETS if p["id"] == preset_id), None)


def video_preset(preset_id: str) -> dict[str, Any] | None:
    return next((p for p in VIDEO_PRESETS if p["id"] == preset_id), None)


def merge_output_settings(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Shallow merge; also merge nested 'encoder' dict if both have it."""
    out = dict(current)
    for key, val in patch.items():
        if key == "encoder" and isinstance(val, dict) and isinstance(out.get("encoder"), dict):
            merged = dict(out["encoder"])
            merged.update(val)
            out["encoder"] = merged
        else:
            out[key] = val
    return out


def recommend_from_upload_kbps(upload_kbps: float) -> dict[str, Any]:
    """Suggest encoder preset from measured upload (leave headroom for audio + jitter)."""
    upload_kbps = max(500.0, float(upload_kbps))
    video_kbps = int(upload_kbps * 0.65) - 160
    video_kbps = max(800, min(video_kbps, 12000))

    if video_kbps < 1800:
        preset_id = "emergency"
    elif video_kbps < 3500:
        preset_id = "low"
    else:
        preset_id = "normal"

    preset = encoder_preset(preset_id) or ENCODER_PRESETS[0]
    return {
        "upload_kbps": round(upload_kbps),
        "recommended_video_kbps": video_kbps,
        "preset_id": preset_id,
        "preset_name": preset["name"],
        "note": (
            f"Estimated safe video bitrate ~{video_kbps} Kbps from "
            f"{round(upload_kbps)} Kbps upload. Apply preset below if it looks right."
        ),
    }
