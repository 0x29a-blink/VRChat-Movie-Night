"""Read/apply OBS stream encoder and video settings via WebSocket."""

from __future__ import annotations

import logging
from typing import Any

from .controller import OBSBusyError, OBSController, OBSNotConnectedError
from .stream_presets import (
    encoder_preset,
    merge_output_settings,
    video_preset,
    ENCODER_PRESETS,
    VIDEO_PRESETS,
)

logger = logging.getLogger(__name__)

_STREAM_OUTPUT_CANDIDATES = ("adv_stream", "streaming", "stream")


def _to_dict(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    for attr in ("output_settings", "outputSettings", "video_settings", "videoSettings"):
        val = getattr(raw, attr, None)
        if isinstance(val, dict):
            return val
    return {}


class StreamSettingsService:
    def __init__(self, controller: OBSController) -> None:
        self._controller = controller

    def _call(self, fn):
        return self._controller._call(fn)  # noqa: SLF001

    def streaming_active(self) -> bool:
        return bool(self._controller.stream_status().get("active"))

    def find_stream_output_name(self) -> str | None:
        def _do(req):
            resp = req.get_output_list()
            outputs = getattr(resp, "outputs", []) or []
            names: list[tuple[int, str]] = []
            for out in outputs:
                name = getattr(out, "output_name", "") or ""
                kind = (getattr(out, "output_kind", "") or "").lower()
                if not name:
                    continue
                score = 0
                low = name.lower()
                if low in _STREAM_OUTPUT_CANDIDATES or "stream" in low:
                    score += 10
                if "ffmpeg" in kind or "rtmp" in kind:
                    score += 5
                if score:
                    names.append((score, name))
            if not names:
                return None
            names.sort(reverse=True)
            return names[0][1]

        try:
            return self._call(_do)
        except (OBSNotConnectedError, OBSBusyError):
            return None

    def get_encoder_settings(self) -> dict[str, Any]:
        name = self.find_stream_output_name()
        if not name:
            raise OBSNotConnectedError("Could not find OBS stream output")

        def _do(req):
            resp = req.get_output_settings(name)
            return _to_dict(resp)

        settings = self._call(_do)
        return {
            "output_name": name,
            "streaming": self.streaming_active(),
            "settings": settings,
        }

    def apply_encoder_preset(self, preset_id: str) -> dict[str, Any]:
        preset = encoder_preset(preset_id)
        if not preset:
            raise ValueError(f"Unknown encoder preset: {preset_id}")

        name = self.find_stream_output_name()
        if not name:
            raise OBSNotConnectedError("Could not find OBS stream output")

        def _get(req):
            return _to_dict(req.get_output_settings(name))

        current = self._call(_get)
        merged = merge_output_settings(current, preset["settings"])

        def _set(req):
            req.set_output_settings(name, merged)

        self._call(_set)
        logger.info("Applied encoder preset %s to output %s", preset_id, name)
        return {
            "ok": True,
            "preset_id": preset_id,
            "output_name": name,
            "streaming": self.streaming_active(),
            "applied_settings": preset["settings"],
        }

    def get_video_settings(self) -> dict[str, Any]:
        def _do(req):
            return _to_dict(req.get_video_settings())

        return {
            "streaming": self.streaming_active(),
            "video": self._call(_do),
        }

    def apply_video_preset(self, preset_id: str) -> dict[str, Any]:
        if self.streaming_active():
            raise RuntimeError("Stop the stream before changing video / downscale settings.")

        preset = video_preset(preset_id)
        if not preset:
            raise ValueError(f"Unknown video preset: {preset_id}")

        patch = preset.get("video") or {}
        if not patch:
            return {"ok": True, "preset_id": preset_id, "note": "No video changes for this preset."}

        def _get(req):
            return _to_dict(req.get_video_settings())

        current = self._call(_get)

        def _set(req):
            num = int(patch.get("fpsNumerator", current.get("fpsNumerator") or 60))
            den = int(patch.get("fpsDenominator", current.get("fpsDenominator") or 1))
            base_w = int(patch.get("baseWidth", current.get("baseWidth") or 1920))
            base_h = int(patch.get("baseHeight", current.get("baseHeight") or 1080))
            out_w = int(patch.get("outputWidth", current.get("outputWidth") or base_w))
            out_h = int(patch.get("outputHeight", current.get("outputHeight") or base_h))
            req.set_video_settings(num, den, base_w, base_h, out_w, out_h)

        self._call(_set)
        logger.info("Applied video preset %s", preset_id)
        return {"ok": True, "preset_id": preset_id, "video": patch}

    def list_presets(self) -> dict[str, Any]:
        return {
            "encoder_presets": ENCODER_PRESETS,
            "video_presets": VIDEO_PRESETS,
            "streaming": self.streaming_active(),
        }
