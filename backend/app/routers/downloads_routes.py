from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import auth
from ..downloads.link_meta import DownloadLinkMeta
from ..downloads.manager import manager
from ..search.parse import _is_uncached_placeholder
from ..torbox.client import magnet_from_hash

router = APIRouter(prefix="/api/downloads", tags=["downloads"],
                   dependencies=[Depends(auth.require_auth)])


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


@router.get("")
def list_downloads():
    return manager.list_jobs()


@router.post("/youtube")
async def add_youtube(body: YoutubeBody):
    if not body.url.strip():
        raise HTTPException(400, "URL required")
    return await manager.add("youtube", body.url.strip(), link=body.link)


@router.post("/m3u8")
async def add_m3u8(body: M3U8Body):
    if not body.url.strip():
        raise HTTPException(400, "URL required")
    return await manager.add(
        "m3u8",
        body.url.strip(),
        title=body.title,
        referer=body.referer,
        link=body.link,
    )


@router.post("/torrent")
async def add_torrent(body: TorrentBody):
    if body.cache_first:
        magnet = (body.magnet or "").strip() or magnet_from_hash(body.info_hash)
        url = body.url.strip()
        if not magnet and url.lower().startswith("magnet:"):
            magnet = url
        if magnet:
            return await manager.add_torbox_cache(
                magnet,
                title=body.title,
                file_idx=body.file_idx,
                filename_hint=body.filename or body.title,
                size_bytes=body.size_bytes,
                link=body.link,
            )
        if url and "/playback/" in url.lower():
            return await manager.add_torbox_playback_cache(
                url,
                title=body.title,
                file_idx=body.file_idx,
                filename_hint=body.filename or body.title,
                size_bytes=body.size_bytes,
                link=body.link,
            )
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
    return await manager.add("torrent", url, title=body.title, link=body.link)


@router.post("/{job_id}/cancel")
async def cancel(job_id: str):
    await manager.cancel(job_id)
    return {"ok": True}


@router.post("/{job_id}/restart")
async def restart(job_id: str):
    result = await manager.restart(job_id)
    if result is None:
        raise HTTPException(404, "Job not found")
    return result


@router.delete("/{job_id}")
async def remove(job_id: str):
    await manager.remove(job_id)
    return {"ok": True}
