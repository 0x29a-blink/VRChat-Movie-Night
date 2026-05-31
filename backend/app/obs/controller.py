import asyncio
import logging
import socket
import threading
import time
from typing import Any, Callable

import obsws_python as obsws
from obsws_python.error import OBSSDKRequestError

from .. import settings_store

logger = logging.getLogger(__name__)

# OBS WebSocket v5: 207 = request valid but OBS is busy (stream start, scene switch, etc.)
_TRANSIENT_OBS_CODES = frozenset({207})

PLAY = "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY"
PAUSE = "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE"
RESTART = "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"
STOP = "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP"

# After a failed connect, skip new attempts for this many seconds.
_OFFLINE_BACKOFF_SEC = 15.0


class OBSNotConnectedError(Exception):
    """OBS WebSocket is unreachable or not running."""


class OBSBusyError(Exception):
    """OBS is connected but temporarily cannot handle the request."""


class OBSController:
    """Thin, thread-safe wrapper around obs-websocket v5 (sync client run in a thread)."""

    def __init__(self) -> None:
        self._req: obsws.ReqClient | None = None
        self._event: obsws.EventClient | None = None
        self._lock = threading.Lock()
        self._on_playback_ended: Callable[[], None] | None = None
        self._offline_until = 0.0
        self._last_status: dict[str, Any] = {"media_state": "", "duration": 0, "cursor": 0}

    def _config(self) -> tuple[str, int, str]:
        host = settings_store.get("obs_host") or "127.0.0.1"
        port = int(settings_store.get("obs_port") or 4455)
        password = settings_store.get("obs_password") or ""
        return host, port, password

    def _port_open(self) -> bool:
        host, port, _ = self._config()
        try:
            with socket.create_connection((host, port), timeout=0.35):
                return True
        except OSError:
            return False

    def _mark_offline(self) -> None:
        self._offline_until = time.monotonic() + _OFFLINE_BACKOFF_SEC

    # ---- connection -----------------------------------------------------
    def _connect_locked(self) -> None:
        if time.monotonic() < self._offline_until:
            raise OBSNotConnectedError("OBS is offline")

        if not self._port_open():
            self._mark_offline()
            raise OBSNotConnectedError("OBS WebSocket port is not reachable")

        host, port, password = self._config()
        try:
            self._req = obsws.ReqClient(host=host, port=port, password=password, timeout=3)
            try:
                self._event = obsws.EventClient(host=host, port=port, password=password, timeout=3)
                self._event.callback.register(self.on_media_input_playback_ended)
            except Exception:
                self._event = None
            self._offline_until = 0.0
        except Exception as exc:
            self._req = None
            self._event = None
            self._mark_offline()
            raise OBSNotConnectedError(str(exc) or "OBS connection failed") from None

    def _ensure(self) -> obsws.ReqClient:
        if self._req is None:
            self._connect_locked()
        assert self._req is not None
        return self._req

    def _reset(self) -> None:
        for client in (self._req, self._event):
            try:
                if client is not None:
                    client.disconnect()
            except Exception:
                pass
        self._req = None
        self._event = None

    def set_playback_ended_callback(self, cb: Callable[[], None]) -> None:
        self._on_playback_ended = cb

    def on_media_input_playback_ended(self, data: Any) -> None:
        """obsws_python routes MediaInputPlaybackEnded events to on_* handlers."""
        input_name = getattr(data, "input_name", None)
        if input_name == settings_store.get("obs_media_input") and self._on_playback_ended:
            try:
                self._on_playback_ended()
            except Exception:
                pass

    def _call(self, fn: Callable[[obsws.ReqClient], Any]) -> Any:
        with self._lock:
            try:
                return fn(self._ensure())
            except OBSNotConnectedError:
                raise
            except OBSSDKRequestError as exc:
                if exc.code in _TRANSIENT_OBS_CODES:
                    raise OBSBusyError(str(exc)) from None
                raise OBSNotConnectedError(str(exc)) from None
            except Exception:
                # One reconnect attempt when we had an active session.
                if self._req is None:
                    raise OBSNotConnectedError("OBS is offline") from None
                self._reset()
                try:
                    return fn(self._ensure())
                except OBSNotConnectedError:
                    raise
                except OBSSDKRequestError as exc:
                    if exc.code in _TRANSIENT_OBS_CODES:
                        raise OBSBusyError(str(exc)) from None
                    self._reset()
                    self._mark_offline()
                    raise OBSNotConnectedError(str(exc)) from None
                except Exception as exc:
                    self._reset()
                    self._mark_offline()
                    raise OBSNotConnectedError(str(exc) or "OBS request failed") from None

    # ---- high level (sync, run via to_thread) ---------------------------
    def _input(self) -> str:
        return settings_store.get("obs_media_input")

    def play_file(self, path: str) -> None:
        name = self._input()

        def _do(req: obsws.ReqClient):
            scene = (settings_store.get("obs_scene") or "").strip()
            if scene:
                try:
                    req.set_current_program_scene(scene)
                except Exception:
                    pass
            req.set_input_settings(
                name,
                {"local_file": path, "is_local_file": True, "looping": False, "restart_on_activate": False},
                True,
            )
            req.trigger_media_input_action(name, RESTART)

        self._call(_do)
        self.apply_volume()

    def media_action(self, action: str) -> None:
        name = self._input()
        self._call(lambda req: req.trigger_media_input_action(name, action))

    def play(self) -> None:
        self.media_action(PLAY)

    def pause(self) -> None:
        self.media_action(PAUSE)

    def restart(self) -> None:
        self.media_action(RESTART)

    def stop(self) -> None:
        self.media_action(STOP)

    def toggle(self) -> str:
        st = self.status()
        state = st.get("media_state", "")
        if state == "OBS_MEDIA_STATE_PLAYING":
            self.pause()
            return "paused"
        self.play()
        return "playing"

    def seek(self, ms: int) -> None:
        name = self._input()
        self._call(lambda req: req.set_media_input_cursor(name, max(0, int(ms))))

    def skip(self, seconds: int) -> None:
        name = self._input()
        self._call(lambda req: req.offset_media_input_cursor(name, int(seconds * 1000)))

    def apply_volume(self) -> None:
        """Apply saved volume multiplier to the configured media input."""
        try:
            mul = float(settings_store.get("obs_media_volume", 1.0))
        except (TypeError, ValueError):
            mul = 1.0
        self.set_volume(mul)

    def set_volume(self, mul: float) -> None:
        name = self._input()
        mul = max(0.0, min(20.0, float(mul)))

        def _do(req: obsws.ReqClient):
            req.set_input_volume(name, vol_mul=mul)

        self._call(_do)

    def get_volume(self) -> dict:
        name = self._input()

        def _do(req: obsws.ReqClient):
            resp = req.get_input_volume(name)
            mul = float(getattr(resp, "input_volume_mul", 1.0) or 1.0)
            db = float(getattr(resp, "input_volume_db", 0.0) or 0.0)
            return {"mul": mul, "db": db, "percent": max(0, min(100, round(mul * 100)))}

        return self._call(_do)

    def status(self) -> dict:
        name = self._input()

        def _do(req: obsws.ReqClient):
            resp = req.get_media_input_status(name)
            return {
                "media_state": getattr(resp, "media_state", ""),
                "duration": getattr(resp, "media_duration", 0) or 0,
                "cursor": getattr(resp, "media_cursor", 0) or 0,
            }

        for attempt in range(3):
            try:
                result = self._call(_do)
                self._last_status = result
                return result
            except OBSBusyError:
                if attempt < 2:
                    time.sleep(0.15)
                    continue
                logger.debug("OBS busy (207) while polling media status; using last known values")
                return dict(self._last_status)
            except OBSNotConnectedError:
                raise
        return dict(self._last_status)

    def stream_status(self) -> dict:
        def _do(req: obsws.ReqClient):
            resp = req.get_stream_status()
            return {
                "active": getattr(resp, "output_active", False),
                "timecode": getattr(resp, "output_timecode", ""),
            }

        return self._call(_do)

    def start_stream(self) -> None:
        self._call(lambda req: req.start_stream())

    def stop_stream(self) -> None:
        self._call(lambda req: req.stop_stream())

    def ensure_stream(self) -> dict:
        st = self.stream_status()
        if not st.get("active"):
            self.start_stream()
            return {"active": True, "started": True}
        return {"active": True, "started": False}

    def connection_info(self) -> dict:
        try:
            stream = self.stream_status()
            return {"connected": True, "streaming": stream.get("active", False)}
        except OBSNotConnectedError as exc:
            self._reset()
            return {"connected": False, "streaming": False, "error": str(exc)}
        except Exception as exc:
            self._reset()
            self._mark_offline()
            return {"connected": False, "streaming": False, "error": str(exc)}


controller = OBSController()


async def aio(fn: Callable[..., Any], *args: Any) -> Any:
    return await asyncio.to_thread(fn, *args)
