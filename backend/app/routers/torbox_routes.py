"""TorBox download URLs only — never stream library files from the host disk."""

from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException

from ..http_errors import format_api_detail
from ..search import aiostreams
from ..search.aiostreams_auth import prepare_aiostreams_request_url
from ..search.ids import parse_torbox_catalog_ids
from ..search.parse import parse_stream
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import auth
from ..db import SessionLocal, get_db
from ..models import LibraryItem
from ..permissions import may_local_download
from ..settings_store import get as setting_get
from ..torbox.client import (
    TorboxClient,
    TorboxError,
    magnet_from_hash,
    parse_torbox_permalink,
    pick_file_id,
    torrent_matches_hint,
    torrent_matches_hint_loose,
    torrent_ready,
)

router = APIRouter(prefix="/api/torbox", tags=["torbox"], dependencies=[Depends(auth.require_auth)])

_BTIH_RE = re.compile(r"\b([0-9a-fA-F]{40})\b")


class TorboxLinkBody(BaseModel):
    url: str = ""
    torrent_id: int | None = None
    magnet: str = ""
    info_hash: str = ""
    file_idx: int | None = None
    filename: str = ""
    name: str = ""
    description: str = ""
    cached: bool = False
    size_bytes: int = 0


class TorboxBrowseBody(BaseModel):
    stremio_id: str
    title: str = ""
    type: str = "movie"
    overview: str = ""


def _client() -> TorboxClient:
    key = str(setting_get("torbox_api_key", "") or "")
    return TorboxClient(key)


def _is_playback_proxy(url: str) -> bool:
    return "/playback/" in (url or "").lower()


def _is_blocked_url(url: str) -> bool:
    host = (urlparse(url).netloc or "").lower()
    return host in ("localhost", "127.0.0.1", "::1")


def _filename_hints(body: TorboxLinkBody) -> list[str]:
    hints: list[str] = []
    for raw in (body.filename, body.name, body.description):
        s = (raw or "").strip()
        if s and s not in hints:
            hints.append(s)
    return hints


def _catalog_title_hints(title: str, overview: str = "") -> list[str]:
    hints: list[str] = []
    for raw in (title, overview):
        s = (raw or "").strip()
        if s and s not in hints:
            hints.append(s)
    no_year = re.sub(r"\s*\(\d{4}\)\s*", " ", title or "").strip()
    if no_year and no_year not in hints:
        hints.append(no_year)
    return hints


async def _match_catalog_on_account(body: TorboxLinkBody, *, title: str = "") -> dict | None:
    """TorBox library catalog: strict then loose title match before playback URLs."""
    hints = _filename_hints(body)
    hints.extend(h for h in _catalog_title_hints(title, body.description) if h not in hints)
    if not hints and not body.size_bytes:
        return None
    client = _client()
    for torrent in await client.list_torrents():
        if not torrent_ready(torrent):
            continue
        for hint in hints:
            if torrent_matches_hint(torrent, hint, size_bytes=body.size_bytes):
                return await _request_link_for_torrent(client, torrent, body)
        if title and torrent_matches_hint_loose(torrent, title):
            return await _request_link_for_torrent(client, torrent, body)
    return None


def _extract_info_hash(url: str, magnet: str, info_hash: str, *text_blobs: str) -> str:
    ih = (info_hash or "").strip().lower()
    if ih:
        return ih.replace("magnet:?xt=urn:btih:", "")
    mag = (magnet or "").strip()
    if mag.lower().startswith("magnet:"):
        m = _BTIH_RE.search(mag)
        if m:
            return m.group(1).lower()
    for blob in (url, *text_blobs):
        m = _BTIH_RE.search(blob or "")
        if m:
            return m.group(1).lower()
    return ""


async def _follow_playback_to_cdn(playback_url: str) -> str | None:
    """Cached TorBox rows often use AIOStreams /playback/ URLs — follow redirects to the CDN."""
    headers = {"User-Agent": "Mozilla/5.0", "Range": "bytes=0-1"}
    request_url = prepare_aiostreams_request_url(playback_url)
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=45.0) as client:
            resp = await client.get(request_url, headers=headers)
            if resp.status_code >= 400:
                try:
                    body = resp.json()
                    detail = format_api_detail(body.get("detail") or body)
                except Exception:
                    detail = resp.text[:300]
                raise HTTPException(502, f"AIOStreams playback failed: {detail}")
            final = str(resp.url)
            if final.startswith(("http://", "https://")) and not _is_playback_proxy(final):
                return final
            if resp.status_code < 400 and final.startswith(("http://", "https://")):
                return final
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"AIOStreams playback request failed: {exc}") from exc
    return None


async def _resolve_torbox_permalink(body: TorboxLinkBody, url: str) -> dict | None:
    """Turn api.torbox.app/requestdl permalinks into a fresh CDN URL (never expose API key)."""
    parsed = parse_torbox_permalink(url)
    if not parsed:
        return None
    torrent_id, file_id = parsed
    client = _client()
    torrent = await client.get_torrent(torrent_id)
    if not torrent:
        raise HTTPException(404, "Torrent not found on TorBox")
    if not torrent_ready(torrent):
        raise HTTPException(409, "Torrent is on TorBox but not cached yet.")
    link_body = body.model_copy(update={"torrent_id": torrent_id, "file_idx": file_id})
    return await _request_link_for_torrent(client, torrent, link_body)


async def _find_torrent(client: TorboxClient, body: TorboxLinkBody) -> dict:
    if body.torrent_id:
        row = await client.get_torrent(body.torrent_id)
        if row:
            return row
        raise HTTPException(404, "Torrent not found on TorBox")

    magnet = (body.magnet or "").strip() or magnet_from_hash(body.info_hash)
    text_blob = f"{body.name}\n{body.description}\n{body.filename}"
    ih = _extract_info_hash(body.url, body.magnet, body.info_hash, text_blob)
    if not magnet and ih:
        magnet = magnet_from_hash(ih)

    if not magnet and not ih:
        hints = _filename_hints(body)
        for torrent in await client.list_torrents():
            for hint in hints:
                if torrent_matches_hint(torrent, hint, size_bytes=body.size_bytes):
                    return torrent
        raise HTTPException(404, "No matching torrent on your TorBox account")

    ih = ih or _extract_info_hash("", magnet, "")
    for t in await client.list_torrents():
        th = (t.get("hash") or "").lower()
        if ih and th == ih:
            return t
        for hint in _filename_hints(body):
            if torrent_matches_hint(t, hint, size_bytes=body.size_bytes):
                return t
    raise HTTPException(404, "No matching torrent on your TorBox account")


async def _request_link_for_torrent(
    client: TorboxClient, torrent: dict, body: TorboxLinkBody
) -> dict:
    tid = int(torrent.get("id") or 0)
    if not tid:
        raise HTTPException(404, "Invalid torrent on TorBox")
    hint = body.filename or body.name or ""
    fid = pick_file_id(torrent, body.file_idx, hint)
    url = await client.request_download_link(tid, fid)
    return {
        "url": url,
        "torrent_id": tid,
        "file_id": fid,
        "source": "torbox_api",
        "note": "Fresh TorBox CDN link from your account (opens in the browser).",
    }


async def _match_ready_torrent_on_account(body: TorboxLinkBody) -> dict | None:
    """Cached AIOStreams rows often omit magnet — match TorBox mylist by file name/size."""
    hints = _filename_hints(body)
    if not hints and not body.size_bytes:
        return None
    client = _client()
    for torrent in await client.list_torrents():
        if not torrent_ready(torrent):
            continue
        for hint in hints:
            if torrent_matches_hint(torrent, hint, size_bytes=body.size_bytes):
                return await _request_link_for_torrent(client, torrent, body)
    return None


async def _resolve_torbox_url(body: TorboxLinkBody) -> dict:
    """Return a TorBox CDN URL for AIOStreams/TorBox streams (no host file proxy)."""
    direct = (body.url or "").strip()

    # 1) Magnet / hash / torrent id → requestdl
    text_blob = f"{body.name}\n{body.description}\n{body.filename}"
    has_magnet = bool(
        body.torrent_id
        or (body.magnet or "").strip()
        or _extract_info_hash(body.url, body.magnet, body.info_hash, text_blob)
    )
    if has_magnet:
        client = _client()
        torrent = await _find_torrent(client, body)
        if not torrent_ready(torrent):
            raise HTTPException(
                409,
                "Torrent is on TorBox but not cached yet. Wait for ⚡ cached or use server Download.",
            )
        return await _request_link_for_torrent(client, torrent, body)

    # 2) Match an existing cached torrent on the host TorBox account (common for ⚡ rows)
    matched = await _match_ready_torrent_on_account(body)
    if matched:
        return matched

    # 3) TorBox permalink in stream JSON (no token — resolve server-side)
    if direct.startswith(("http://", "https://")) and not _is_blocked_url(direct):
        permalink = await _resolve_torbox_permalink(body, direct)
        if permalink:
            permalink["source"] = "torbox_permalink"
            return permalink

    # 4) AIOStreams /playback/ URL (common for ⚡ cached TorBox — follow redirects to CDN)
    if direct.startswith(("http://", "https://")) and not _is_blocked_url(direct):
        if _is_playback_proxy(direct):
            followed = await _follow_playback_to_cdn(direct)
            if followed:
                return {
                    "url": followed,
                    "source": "playback_redirect",
                    "note": "Resolved TorBox CDN link from AIOStreams playback URL.",
                }
            if body.cached:
                raise HTTPException(
                    502,
                    "Cached stream uses a playback link but TorBox did not return a download URL. "
                    "Try Refresh streams, Copy link again, or server Download.",
                )
            raise HTTPException(
                400,
                "This stream is not cached on TorBox yet. Pick a ⚡ cached row or use Cache & download.",
            )
        return {
            "url": direct,
            "source": "stream_cdn_url",
            "note": "Direct CDN link from AIOStreams (opens in your browser; not served from the Movie Night PC).",
        }

    raise HTTPException(400, "No TorBox URL or magnet available for this stream.")


async def _resolve_torbox_catalog_item(body: TorboxBrowseBody) -> dict:
    """Resolve a TorBox Library catalog row to a CDN URL (already on the host account)."""
    sid = (body.stremio_id or "").strip()
    title = (body.title or "").strip()
    tid, fid = parse_torbox_catalog_ids(sid)
    link_body = TorboxLinkBody(
        name=title or sid,
        filename=title or sid,
        description=body.overview,
        cached=True,
        file_idx=fid,
        torrent_id=tid,
    )

    if tid:
        client = _client()
        torrent = await client.get_torrent(tid)
        if not torrent:
            raise HTTPException(404, "Torrent not found on TorBox")
        if not torrent_ready(torrent):
            raise HTTPException(
                409,
                "This item is on TorBox but not finished caching yet.",
            )
        out = await _request_link_for_torrent(client, torrent, link_body)
        out["source"] = "torbox_catalog_id"
        out["note"] = "Download from your TorBox library (CDN link, not from the Movie Night PC)."
        return out

    matched = await _match_catalog_on_account(link_body, title=title)
    if matched:
        matched["source"] = "torbox_catalog_match"
        matched["note"] = "Matched your TorBox library by title."
        return matched

    stream_type = "series" if (body.type or "").lower() in ("series", "tv") else "movie"
    try:
        raw_streams = await aiostreams.fetch_streams(stream_type, sid)
    except Exception:
        raw_streams = []
    for raw in raw_streams:
        parsed = parse_stream(raw)
        if not parsed:
            continue
        stream_body = TorboxLinkBody(
            url=parsed.get("url") or "",
            magnet=parsed.get("magnet") or "",
            info_hash=parsed.get("info_hash") or "",
            file_idx=parsed.get("file_idx"),
            filename=parsed.get("filename") or "",
            name=parsed.get("name") or title,
            description=parsed.get("description") or "",
            cached=True,
            size_bytes=int(parsed.get("size_bytes") or 0),
        )
        matched_stream = await _match_catalog_on_account(stream_body, title=title)
        if matched_stream:
            matched_stream["source"] = "torbox_catalog_stream_match"
            return matched_stream
        try:
            resolved = await _resolve_torbox_url(stream_body)
            resolved["source"] = "torbox_catalog_stream"
            return resolved
        except HTTPException:
            continue

    raise HTTPException(
        404,
        "Could not match this TorBox library entry. Try Streams on the title, or check the name on torbox.app.",
    )


@router.post("/download-link")
async def torbox_download_link(
    body: TorboxLinkBody,
    user: auth.CurrentUser = Depends(auth.require_auth),
    db: Session = Depends(get_db),
):
    if not may_local_download(user, db):
        raise HTTPException(403, "Local download is not enabled for your account")
    try:
        return await _resolve_torbox_url(body)
    except TorboxError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/download-link/browse")
async def torbox_browse_download_link(
    body: TorboxBrowseBody,
    user: auth.CurrentUser = Depends(auth.require_auth),
    db: Session = Depends(get_db),
):
    """TorBox Library catalog — item is already cached on the host TorBox account."""
    if not may_local_download(user, db):
        raise HTTPException(403, "Local download is not enabled for your account")
    try:
        return await _resolve_torbox_catalog_item(body)
    except TorboxError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.post("/download-link/library/{item_id}")
async def torbox_library_download_link(
    item_id: int,
    user: auth.CurrentUser = Depends(auth.require_auth),
    db: Session = Depends(get_db),
):
    """Match a library torrent file to TorBox and return a CDN URL (not the on-disk file)."""
    if not may_local_download(user, db):
        raise HTTPException(403, "Local download is not enabled for your account")
    with SessionLocal() as s:
        item = s.get(LibraryItem, item_id)
        if not item:
            raise HTTPException(404, "Not found")
        if item.folder != "torrents":
            raise HTTPException(
                400,
                "Only Movies & Shows (torrent) library items can use TorBox links. "
                "YouTube and M3U8 are not on TorBox.",
            )
        filename = item.filename or item.title
        size_bytes = int(item.size or 0)

    body = TorboxLinkBody(filename=filename, name=item.title, size_bytes=size_bytes)
    try:
        matched = await _match_ready_torrent_on_account(body)
        if matched:
            matched["source"] = "torbox_library_match"
            matched["note"] = (
                "Matched your TorBox account by filename — download goes through TorBox, not this PC."
            )
            return matched
        raise HTTPException(
            404,
            "This file is not on your TorBox account (or the name no longer matches). "
            "Use Find streams on the title, or re-cache on TorBox.",
        )
    except TorboxError as exc:
        raise HTTPException(502, str(exc)) from exc
