"""Inspect (and optionally apply) recommended OBS settings for Movie Night."""

from __future__ import annotations

from typing import Any

from .. import settings_store
from .controller import OBSBusyError, OBSController, OBSNotConnectedError

RTMP_SERVER = "rtmp://localhost:1935/live"
STREAM_KEY = "vrstream"
EXPECTED_SERVICE = "Custom"


def _norm(s: str) -> str:
    return (s or "").strip().rstrip("/")


def audit_obs(controller: OBSController) -> dict[str, Any]:
    """
    Report OBS readiness. Does not modify anything unless apply=True is used
    via apply_obs_recommendations().
    """
    media_input = settings_store.get("obs_media_input") or "VRStream"
    scene = (settings_store.get("obs_scene") or "").strip()
    out: dict[str, Any] = {
        "connected": False,
        "media_input": media_input,
        "media_input_ok": False,
        "scene_ok": True,
        "stream_settings_ok": False,
        "stream_active": False,
        "recommendations": [],
        "can_auto_fix_stream": False,
        "can_auto_create_input": False,
    }

    try:
        stream = controller.stream_status()
        out["connected"] = True
        out["stream_active"] = bool(stream.get("active"))
    except OBSNotConnectedError as exc:
        out["error"] = str(exc)
        out["recommendations"].append(
            "Install OBS 28+, enable Tools → WebSocket Server (port 4455), "
            "and match the password in backend/.env."
        )
        return out
    except OBSBusyError:
        out["error"] = "OBS is busy; try again in a moment."
        return out
    except Exception as exc:
        out["error"] = str(exc)
        return out

    def _call(fn):
        return controller._call(fn)  # noqa: SLF001

    try:
        inputs = _call(lambda req: req.get_input_list())
        names = [getattr(i, "input_name", "") for i in getattr(inputs, "inputs", []) or []]
        out["media_input_ok"] = media_input in names
        if not out["media_input_ok"]:
            out["recommendations"].append(
                f'Create a Media Source named "{media_input}" (leave file empty — the app sets it).'
            )
            out["can_auto_create_input"] = True

        if scene:
            scenes = _call(lambda req: req.get_scene_list())
            scene_names = [getattr(s, "scene_name", "") for s in getattr(scenes, "scenes", []) or []]
            out["scene_ok"] = scene in scene_names
            if not out["scene_ok"]:
                out["recommendations"].append(
                    f'Create a scene named "{scene}" or clear OBS_SCENE in Settings.'
                )

        ss = _call(lambda req: req.get_stream_service_settings())
        settings = getattr(ss, "stream_service_settings", None) or {}
        if isinstance(settings, dict):
            server = _norm(str(settings.get("server", "")))
            key = _norm(str(settings.get("key", "")))
            service = str(settings.get("service", "") or "")
            expected_server = _norm(RTMP_SERVER)
            out["stream_settings"] = {"server": server, "key": key, "service": service}
            out["stream_settings_ok"] = (
                server == expected_server
                and key == STREAM_KEY
                and (not service or service == EXPECTED_SERVICE)
            )
            if not out["stream_settings_ok"]:
                out["recommendations"].append(
                    f"Set Stream → Custom: Server `{RTMP_SERVER}` Stream key `{STREAM_KEY}`."
                )
                out["can_auto_fix_stream"] = True
    except OBSNotConnectedError as exc:
        out["error"] = str(exc)
    except Exception as exc:
        out["error"] = f"OBS audit failed: {exc}"

    if out["connected"] and not out["recommendations"]:
        out["recommendations"].append("OBS looks correctly configured for Movie Night.")

    return out


def apply_obs_recommendations(controller: OBSController) -> dict[str, Any]:
    """Apply stream + media input fixes where the WebSocket API allows."""
    audit = audit_obs(controller)
    if not audit.get("connected"):
        return {**audit, "applied": [], "ok": False}

    applied: list[str] = []
    media_input = audit["media_input"]

    def _call(fn):
        return controller._call(fn)  # noqa: SLF001

    try:
        if audit.get("can_auto_fix_stream"):
            _call(
                lambda req: req.set_stream_service_settings(
                    EXPECTED_SERVICE,
                    {"server": RTMP_SERVER, "key": STREAM_KEY, "service": EXPECTED_SERVICE},
                )
            )
            applied.append("stream_service_settings")

        if audit.get("can_auto_create_input"):
            scene_name = (settings_store.get("obs_scene") or "").strip()
            if not scene_name:
                scenes = _call(lambda req: req.get_scene_list())
                scene_list = getattr(scenes, "scenes", []) or []
                if scene_list:
                    scene_name = getattr(scene_list[0], "scene_name", "")
            if scene_name:
                _call(
                    lambda req: req.create_input(
                        scene_name,
                        media_input,
                        "ffmpeg_source",
                        {
                            "local_file": "",
                            "is_local_file": True,
                            "looping": False,
                            "restart_on_activate": False,
                        },
                        True,
                    )
                )
                applied.append(f"created_input:{media_input}")
            else:
                audit["recommendations"].append(
                    "Add at least one scene in OBS so the media source can be created automatically."
                )
    except Exception as exc:
        return {**audit_obs(controller), "applied": applied, "ok": False, "error": str(exc)}

    result = audit_obs(controller)
    result["applied"] = applied
    result["ok"] = result.get("media_input_ok") and result.get("stream_settings_ok")
    return result
