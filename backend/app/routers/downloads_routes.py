import shutil

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth
from ..config import settings
from ..downloads.link_meta import DownloadLinkMeta
from ..downloads.manager import manager
from ..events import record_event
from ..search.parse import _is_uncached_placeholder
from ..torbox.client import magnet_from_hash

router = APIRouter(prefix="/api/downloads", tags=["downloads"],
                   dependencies=[Depends(auth.require_auth)])

# Headroom kept free beyond the expected download size, so a big cache/download
# doesn't fill the disk to zero even if the size hint is slightly off.
_DISK_HEADROOM_BYTES = 2 * 1024**3  # 2 GiB


def _check_disk_space(size_bytes: int) -> None:
    """Raise 400 if the library disk doesn't have room for `size_bytes` + headroom.
    No-op when there's no size hint (size_bytes <= 0)."""
    if size_bytes <= 0:
        return
    needed = size_bytes + _DISK_HEADROOM_BYTES
    free = shutil.disk_usage(settings.library_path).free
    if free < needed:
        free_gb = free / 1024**3
        needed_gb = needed / 1024**3
        raise HTTPException(
            400,
            f"Not enough disk space: {free_gb:.1f} GB free, need about "
            f"{needed_gb:.1f} GB (including 2 GB headroom).",
        )


class YoutubeBody(BaseModel):
    url: str
    link: DownloadLinkMeta | None = None


class M3U8Body(BaseModel):
    url: str
    title: str = ""
    referer: str = ""
    link: DownloadLinkMeta | None = None


class TorrentBody(BaseModel):
    url: str = ""
    title: str = ""
    cache_first: bool = False
    magnet: str = ""
    info_hash: str = ""
    file_idx: int | None = None
    filename: str = ""
    size_bytes: int = 0
    link: DownloadLinkMeta | None = None


class ClearBody(BaseModel):
    statuses: list[str] = []


_CLEARABLE_STATUSES = {"completed", "failed", "cancelled"}


class RestartBody(BaseModel):
    mode: str = "auto"


@router.get("")
def list_downloads():
    return manager.list_jobs()


@router.post("/youtube")
async def add_youtube(body: YoutubeBody, user: auth.CurrentUser = Depends(auth.require_auth)):
    if not body.url.strip():
        raise HTTPException(400, "URL required")
    result = await manager.add("youtube", body.url.strip(), link=body.link)
    record_event("download_start", result.get("title") or body.url.strip(), user=user)
    return result


@router.post("/m3u8")
async def add_m3u8(body: M3U8Body, user: auth.CurrentUser = Depends(auth.require_auth)):
    if not body.url.strip():
        raise HTTPException(400, "URL required")
    result = await manager.add(
        "m3u8",
        body.url.strip(),
        title=body.title,
        referer=body.referer,
        link=body.link,
    )
    record_event("download_start", result.get("title") or body.url.strip(), user=user)
    return result


@router.post("/torrent")
async def add_torrent(body: TorrentBody, user: auth.CurrentUser = Depends(auth.require_auth)):
    _check_disk_space(body.size_bytes)
    if body.cache_first:
        magnet = (body.magnet or "").strip() or magnet_from_hash(body.info_hash)
        url = body.url.strip()
        if not magnet and url.lower().startswith("magnet:"):
            magnet = url
        if magnet:
            result = await manager.add_torbox_cache(
                magnet,
                title=body.title,
                file_idx=body.file_idx,
                filename_hint=body.filename or body.title,
                size_bytes=body.size_bytes,
                link=body.link,
            )
            record_event("download_start", result.get("title") or body.title, user=user)
            return result
        if url and "/playback/" in url.lower():
            result = await manager.add_torbox_playback_cache(
                url,
                title=body.title,
                file_idx=body.file_idx,
                filename_hint=body.filename or body.title,
                size_bytes=body.size_bytes,
                link=body.link,
            )
            record_event("download_start", result.get("title") or body.title, user=user)
            return result
        raise HTTPException(
            400,
            "This stream has no magnet/infoHash for TorBox. Try another result "
            "or enable Service Wrap in AIOStreams.",
        )

    url = body.url.strip()
    if not url:
        raise HTTPException(400, "URL required")
    if _is_uncached_placeholder(body.title, url):
        raise HTTPException(
            400,
            "This link is not cached on TorBox yet. Use “Cache & download” for "
            "uncached torrents, or pick a ⚡ cached stream.",
        )
    result = await manager.add("torrent", url, title=body.title, link=body.link)
    record_event("download_start", result.get("title") or body.title, user=user)
    return result


@router.post("/{job_id}/cancel")
async def cancel(job_id: str):
    await manager.cancel(job_id)
    return {"ok": True}


@router.post("/{job_id}/restart")
async def restart(job_id: str, body: RestartBody | None = None):
    mode = body.mode if body and body.mode in ("auto", "direct", "hls", "ytdlp") else "auto"
    result = await manager.restart(job_id, retry_mode=mode)
    if result is None:
        raise HTTPException(404, "Job not found")
    return result


@router.delete("/{job_id}")
async def remove(job_id: str):
    await manager.remove(job_id)
    return {"ok": True}


@router.post("/clear")
async def clear(body: ClearBody):
    statuses = [s for s in body.statuses if s in _CLEARABLE_STATUSES]
    if not statuses:
        raise HTTPException(
            400, "statuses must be a subset of completed/failed/cancelled"
        )
    removed = await manager.clear_by_status(statuses)
    return {"ok": True, "removed": removed}
