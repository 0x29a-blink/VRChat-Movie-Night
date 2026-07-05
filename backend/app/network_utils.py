import socket
from typing import Any

import httpx
from fastapi import Request

from . import settings_store
from .config import settings as env_settings

DEFAULT_HLS_REL_PATH = "live/vrstream/index.m3u8"
HLS_PORT = 8888
MTX_API_PORT = 9997


def guess_lan_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "localhost"


def host_from_request(request: Request) -> str:
    host_header = (request.headers.get("host") or "").split(":")[0].strip()
    if host_header and host_header not in ("127.0.0.1", "localhost", "::1"):
        return host_header
    client = request.client.host if request.client else ""
    if client and client not in ("127.0.0.1", "localhost", "::1"):
        return client
    return ""


def _setting_str(key: str) -> str:
    raw = settings_store.get(key, "")
    if raw is None:
        return ""
    s = str(raw).strip()
    if s.lower() in ("none", "null"):
        return ""
    return s


def resolve_hls_host(request: Request | None = None) -> str:
    override = _setting_str("hls_public_host")
    if override:
        return override
    if request is not None:
        from_header = host_from_request(request)
        if from_header:
            return from_header
    return guess_lan_ip() or "localhost"


def configured_hls_rel_path() -> str:
    custom = _setting_str("hls_stream_path").lstrip("/")
    return custom or DEFAULT_HLS_REL_PATH


def _hls_public_base_url() -> str:
    base = (env_settings.hls_public_base_url or "").strip().rstrip("/")
    return base


def build_hls_url(request: Request | None = None, rel_path: str | None = None) -> str:
    path = (rel_path or configured_hls_rel_path() or DEFAULT_HLS_REL_PATH).lstrip("/")
    tunnel_base = _hls_public_base_url()
    if tunnel_base:
        return f"{tunnel_base}/{path}"
    host = resolve_hls_host(request)
    return f"http://{host}:{HLS_PORT}/{path}"


def _path_candidates(preferred: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in (preferred, DEFAULT_HLS_REL_PATH, "vrstream/index.m3u8", "live/vrstream/index.m3u8"):
        rel = raw.lstrip("/")
        if rel and rel not in seen:
            seen.add(rel)
            out.append(rel)
    return out


async def _fetch_m3u8(client: httpx.AsyncClient, url: str) -> bool:
    """MediaMTX may redirect once for cookieCheck; validate playlist body."""
    urls = [url]
    if "cookieCheck=" not in url:
        sep = "&" if "?" in url else "?"
        urls.append(f"{url}{sep}cookieCheck=1")
    for target in urls:
        try:
            resp = await client.get(target)
            if resp.status_code == 200 and "#EXTM3U" in resp.text:
                return True
        except Exception:
            continue
    return False


async def _check_via_api(obs_streaming: bool) -> tuple[bool, bool, str, str | None]:
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.get(f"http://127.0.0.1:{MTX_API_PORT}/v3/paths/list")
            if resp.status_code != 200:
                return False, False, "", None
            payload = resp.json()
            items: list[dict[str, Any]] = payload.get("items") or []
            ready = [item for item in items if item.get("ready")]
            if ready:
                name = str(ready[0].get("name") or "").strip("/")
                rel = f"{name}/index.m3u8" if name else configured_hls_rel_path()
                return True, True, "", rel
            names = [str(item.get("name") or "?") for item in items]
            if names:
                detail = (
                    f"MediaMTX sees path(s) {', '.join(names)} but none are ready yet. "
                    "Wait a few seconds after Go live, or verify OBS RTMP settings."
                )
            elif obs_streaming:
                detail = (
                    "OBS is streaming but MediaMTX has no RTMP publisher. "
                    "Use Server rtmp://localhost:1935/live and Stream Key vrstream in OBS."
                )
            else:
                detail = "MediaMTX is running but no stream is publishing yet — click Go live."
            return True, False, detail, None
    except (httpx.ConnectError, httpx.TimeoutException):
        return False, False, "", None
    except Exception:
        return False, False, "", None


async def _check_via_http(obs_streaming: bool) -> tuple[bool, bool, str, str]:
    preferred = configured_hls_rel_path()
    try:
        async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
            for rel in _path_candidates(preferred):
                url = f"http://127.0.0.1:{HLS_PORT}/{rel}"
                if await _fetch_m3u8(client, url):
                    return True, True, "", rel
            # Port is open if we get here without ConnectError — probe any HTTP response
            try:
                probe = await client.get(f"http://127.0.0.1:{HLS_PORT}/")
            except httpx.ConnectError:
                return (
                    False,
                    False,
                    f"Nothing listening on port {HLS_PORT} — run mediamtx.cmd or start-stack.cmd",
                    preferred,
                )
            if probe.status_code < 500:
                if obs_streaming:
                    detail = (
                        "MediaMTX is up and OBS reports live, but the HLS playlist was not found. "
                        "Confirm OBS Stream settings: Server rtmp://localhost:1935/live, Key vrstream. "
                        "Enable MediaMTX API (api: true in mediamtx.yml) for clearer diagnostics."
                    )
                else:
                    detail = (
                        "MediaMTX is running but the HLS feed is not active yet — click Go live "
                        "on Queue & Player."
                    )
                return True, False, detail, preferred
    except httpx.ConnectError:
        return (
            False,
            False,
            f"Nothing listening on port {HLS_PORT} — run mediamtx.cmd or start-stack.cmd",
            preferred,
        )
    except httpx.TimeoutException:
        return False, False, f"MediaMTX on port {HLS_PORT} timed out", preferred
    except Exception as exc:
        return False, False, str(exc) or "MediaMTX check failed", preferred
    return False, False, f"MediaMTX on port {HLS_PORT} unreachable", preferred


async def check_mediamtx_stream(obs_streaming: bool = False) -> tuple[bool, bool, str, str]:
    """Returns (mediamtx_running, hls_stream_active, detail_message, relative_hls_path)."""
    api_running, api_active, api_err, api_path = await _check_via_api(obs_streaming)
    if api_running:
        rel = api_path or configured_hls_rel_path()
        return api_running, api_active, api_err, rel

    http_running, http_active, http_err, http_path = await _check_via_http(obs_streaming)
    return http_running, http_active, http_err, http_path
