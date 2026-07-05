from obsws_python.error import OBSSDKRequestError

import app.obs.controller as obs_controller
from app.obs.controller import OBSBusyError, OBSController, OBSNotConnectedError

# ---------------------------------------------------------------------------
# Offline backoff
# ---------------------------------------------------------------------------


def test_connection_info_reports_offline_when_port_closed(monkeypatch):
    ctrl = OBSController()
    monkeypatch.setattr(ctrl, "_port_open", lambda: False)

    info = ctrl.connection_info()

    assert info["connected"] is False


def test_offline_backoff_blocks_fast_retry_even_when_port_opens(monkeypatch):
    ctrl = OBSController()

    clock = {"now": 1000.0}
    monkeypatch.setattr(obs_controller.time, "monotonic", lambda: clock["now"])

    # First attempt: port closed -> marks offline until now + _OFFLINE_BACKOFF_SEC.
    monkeypatch.setattr(ctrl, "_port_open", lambda: False)
    info1 = ctrl.connection_info()
    assert info1["connected"] is False

    # Port is now open, but we're still within the backoff window.
    monkeypatch.setattr(ctrl, "_port_open", lambda: True)
    clock["now"] += 1.0  # advance a bit, still inside 15s backoff
    info2 = ctrl.connection_info()

    assert info2["connected"] is False


# ---------------------------------------------------------------------------
# _call() error mapping
# ---------------------------------------------------------------------------


def test_call_maps_207_to_busy_error():
    ctrl = OBSController()
    ctrl._req = object()  # any non-None sentinel; fn ignores it

    def fn(_req):
        raise OBSSDKRequestError("SomeRequest", 207, "busy")

    try:
        ctrl._call(fn)
        assert False, "expected OBSBusyError"
    except OBSBusyError:
        pass


def test_call_maps_non_207_to_not_connected_error():
    ctrl = OBSController()
    ctrl._req = object()

    def fn(_req):
        raise OBSSDKRequestError("SomeRequest", 100, "generic failure")

    try:
        ctrl._call(fn)
        assert False, "expected OBSNotConnectedError"
    except OBSNotConnectedError:
        pass


# ---------------------------------------------------------------------------
# status() busy fallback
# ---------------------------------------------------------------------------


def test_status_falls_back_to_last_known_after_repeated_busy(monkeypatch):
    ctrl = OBSController()
    ctrl._last_status = {"media_state": "X", "duration": 111, "cursor": 222}

    def always_busy(_fn):
        raise OBSBusyError("busy")

    monkeypatch.setattr(ctrl, "_call", always_busy)
    monkeypatch.setattr(obs_controller.time, "sleep", lambda _s: None)

    result = ctrl.status()

    assert result == {"media_state": "X", "duration": 111, "cursor": 222}
