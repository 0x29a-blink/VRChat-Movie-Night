"""TorBox API client for cache-and-download workflow."""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from ..http_errors import format_api_detail

TORBOX_API = "https://api.torbox.app/v1/api"
VIDEO_SUFFIXES = (".mkv", ".mp4", ".avi", ".mov", ".m4v", ".webm", ".ts")


class TorboxError(Exception):
    pass


class TorboxClient:
    def __init__(self, api_key: str) -> None:
        key = (api_key or "").strip()
        if not key:
            raise TorboxError("TorBox API key is not configured (Settings page).")
        self._api_key = key
        self._headers = {"Authorization": f"Bearer {key}"}

    async def create_torrent(self, magnet: str, name: str = "") -> dict[str, Any]:
        data: dict[str, str] = {"magnet": magnet}
        if name:
            data["name"] = name[:200]
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{TORBOX_API}/torrents/createtorrent",
                headers=self._headers,
                data=data,
            )
        return _unwrap(resp)

    async def list_torrents(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{TORBOX_API}/torrents/mylist",
                headers=self._headers,
                params={"bypass_cache": "true"},
            )
        data = _unwrap(resp)
        if isinstance(data, list):
            return data
        return []

    async def get_torrent(self, torrent_id: int, *, bypass_cache: bool = True) -> dict[str, Any]:
        params = {"id": torrent_id}
        if bypass_cache:
            params["bypass_cache"] = "true"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{TORBOX_API}/torrents/mylist",
                headers=self._headers,
                params=params,
            )
        data = _unwrap(resp)
        if isinstance(data, list):
            return data[0] if data else {}
        return data if isinstance(data, dict) else {}

    async def request_download_link(self, torrent_id: int, file_id: int) -> str:
        async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
            resp = await client.get(
                f"{TORBOX_API}/torrents/requestdl",
                headers=self._headers,
                params={
                    "token": self._api_key,
                    "torrent_id": torrent_id,
                    "file_id": file_id,
                    "redirect": "false",
                },
            )
        url = _unwrap(resp)
        if isinstance(url, str) and url.startswith("http"):
            return url
        raise TorboxError("TorBox did not return a download link")


def _torrent_total_bytes(torrent: dict[str, Any]) -> int:
    total = int(torrent.get("size") or 0)
    if total:
        return total
    return sum(int(f.get("size") or 0) for f in torrent.get("files") or [])


def normalize_match_hint(text: str) -> str:
    """Fold titles for TorBox library matching (year tags, punctuation)."""
    s = (text or "").lower()
    s = re.sub(r"\(\d{4}\)", " ", s)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def torrent_matches_hint_loose(torrent: dict[str, Any], title_hint: str) -> bool:
    """Match catalog display titles to messy torrent/file names on TorBox."""
    hint_norm = normalize_match_hint(title_hint)
    if len(hint_norm) < 4:
        return False
    tokens = [t for t in hint_norm.split() if len(t) > 2]
    if not tokens:
        return False

    def blob_matches(blob: str) -> bool:
        if not blob:
            return False
        if hint_norm in blob or blob in hint_norm:
            return True
        return all(t in blob for t in tokens)

    if blob_matches(normalize_match_hint(torrent.get("name") or "")):
        return True
    for f in torrent.get("files") or []:
        if blob_matches(normalize_match_hint(f.get("name") or "")):
            return True
    return False


def torrent_matches_hint(
    torrent: dict[str, Any],
    filename_hint: str,
    *,
    size_bytes: int = 0,
) -> bool:
    hint = (filename_hint or "").strip().lower()
    name = (torrent.get("name") or "").lower()
    file_names = [(f.get("name") or "").lower() for f in torrent.get("files") or []]

    name_ok = True
    if hint:
        name_ok = (
            hint in name
            or name in hint
            or any(hint in fn or fn in hint for fn in file_names)
        )

    size_ok = True
    if size_bytes > 0:
        total = _torrent_total_bytes(torrent)
        if total > 0:
            ratio = total / size_bytes
            size_ok = 0.85 <= ratio <= 1.15

    if hint and size_bytes > 0:
        return name_ok and size_ok
    if hint:
        return name_ok
    if size_bytes > 0:
        return size_ok
    return True


def pick_best_new_torrent(
    candidates: list[dict[str, Any]],
    *,
    filename_hint: str = "",
    size_bytes: int = 0,
) -> dict[str, Any] | None:
    if not candidates:
        return None
    if filename_hint or size_bytes:
        matched = [
            t
            for t in candidates
            if torrent_matches_hint(t, filename_hint, size_bytes=size_bytes)
        ]
        if matched:
            candidates = matched
    return candidates[0]


async def trigger_playback_prewarm(playback_url: str) -> None:
    """Hit AIOStreams playback so TorBox begins caching (same as Stremio play)."""
    from ..search.aiostreams_auth import prepare_aiostreams_request_url

    headers = {"User-Agent": "Mozilla/5.0", "Range": "bytes=0-1"}
    url = prepare_aiostreams_request_url(playback_url)
    async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
        for _ in range(3):
            try:
                await client.get(url, headers=headers)
            except httpx.HTTPError:
                pass
            await asyncio.sleep(2)


async def wait_for_new_torrent(
    client: TorboxClient,
    *,
    before_ids: set[int],
    filename_hint: str = "",
    size_bytes: int = 0,
    poll_seconds: float = 12.0,
    timeout_seconds: float = 600.0,
    should_cancel: Any | None = None,
) -> dict[str, Any]:
    """Poll TorBox until a new torrent appears after playback prewarm."""
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if should_cancel and should_cancel():
            raise TorboxError("Cancelled")
        new = [
            t
            for t in await client.list_torrents()
            if int(t.get("id") or 0) and int(t["id"]) not in before_ids
        ]
        found = pick_best_new_torrent(
            new, filename_hint=filename_hint, size_bytes=size_bytes
        )
        if found:
            return found
        await asyncio.sleep(poll_seconds)
    raise TorboxError(
        "TorBox did not start caching this stream within 10 minutes. "
        "Try a ⚡ cached row, or enable Service Wrap in AIOStreams so magnets are exposed."
    )


def magnet_from_hash(info_hash: str) -> str:
    h = (info_hash or "").strip()
    if not h:
        return ""
    if h.lower().startswith("magnet:"):
        return h
    return f"magnet:?xt=urn:btih:{h}"


def pick_file_id(
    torrent: dict[str, Any],
    file_idx: int | None,
    filename_hint: str = "",
) -> int:
    files: list[dict[str, Any]] = list(torrent.get("files") or [])
    if not files:
        raise TorboxError("Torrent has no files yet on TorBox")

    def is_video(f: dict[str, Any]) -> bool:
        name = (f.get("name") or "").lower()
        return any(name.endswith(ext) for ext in VIDEO_SUFFIXES)

    videos = [f for f in files if is_video(f)]
    pool = videos or files

    if filename_hint:
        hint = filename_hint.lower()
        for f in pool:
            if hint in (f.get("name") or "").lower():
                return int(f["id"])

    if file_idx is not None and 0 <= file_idx < len(files):
        chosen = files[file_idx]
        if is_video(chosen) or not videos:
            return int(chosen["id"])
        # Index points at a non-video (nfo/srt/sample) while the torrent has
        # real videos — fall through to largest-video selection instead.

    best = max(pool, key=lambda f: int(f.get("size") or 0))
    return int(best["id"])


def torrent_ready(torrent: dict[str, Any]) -> bool:
    if torrent.get("download_finished"):
        return True
    state = (torrent.get("download_state") or "").lower()
    if state in ("cached", "completed"):
        return True
    if torrent.get("cached") and torrent.get("download_present"):
        return True
    progress = float(torrent.get("progress") or 0)
    return progress >= 1.0


def torrent_failed(torrent: dict[str, Any]) -> str | None:
    state = (torrent.get("download_state") or "").lower()
    if "stalled" in state and (torrent.get("seeds") or 0) == 0:
        return "Torrent stalled with no seeders on TorBox"
    if state in ("error", "missing files"):
        return torrent.get("tracker_message") or f"TorBox state: {state}"
    return None


async def wait_for_torrent(
    client: TorboxClient,
    torrent_id: int,
    *,
    poll_seconds: float = 12.0,
    timeout_seconds: float = 7200.0,
    on_progress: Any | None = None,
    should_cancel: Any | None = None,
) -> dict[str, Any]:
    """Poll TorBox until the torrent is ready to download."""
    deadline = time.monotonic() + timeout_seconds
    last_pct = -1.0
    while time.monotonic() < deadline:
        if should_cancel and should_cancel():
            raise TorboxError("Cancelled")
        torrent = await client.get_torrent(torrent_id)
        fail = torrent_failed(torrent)
        if fail:
            raise TorboxError(fail)
        if torrent_ready(torrent):
            return torrent

        pct = float(torrent.get("progress") or 0) * 100.0
        if on_progress and pct != last_pct:
            last_pct = pct
            await on_progress(torrent, pct)

        await asyncio.sleep(poll_seconds)

    raise TorboxError("Timed out waiting for TorBox to cache the torrent (2h limit)")


def _unwrap(resp: httpx.Response) -> Any:
    try:
        body = resp.json()
    except Exception as exc:
        raise TorboxError(f"TorBox returned invalid JSON ({resp.status_code})") from exc
    if resp.status_code >= 400:
        detail = format_api_detail(body.get("detail") or body.get("error") or resp.text)
        raise TorboxError(detail or f"TorBox error ({resp.status_code})")
    if not body.get("success"):
        detail = format_api_detail(body.get("detail") or body.get("error") or "TorBox request failed")
        raise TorboxError(detail)
    return body.get("data")


def parse_torbox_permalink(url: str) -> tuple[int, int] | None:
    """TorBox permalinks use ?torrent_id=&file_id=; token must not be sent to clients."""
    host = (urlparse(url).netloc or "").lower()
    path = (urlparse(url).path or "").lower()
    if "torbox.app" not in host or "requestdl" not in path:
        return None
    qs = parse_qs(urlparse(url).query)
    try:
        tid = int((qs.get("torrent_id") or ["0"])[0] or 0)
        fid = int((qs.get("file_id") or ["0"])[0] or 0)
    except (TypeError, ValueError):
        return None
    if tid > 0 and fid >= 0:
        return tid, fid
    return None
