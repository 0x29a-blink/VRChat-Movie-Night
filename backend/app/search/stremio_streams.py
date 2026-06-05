"""Fetch streams from AIOStreams using Stremio ids (Kitsu/MAL/etc.)."""

from . import aiostreams


async def fetch_streams_for_video_id(video_id: str) -> tuple[str, list[dict]]:
    """Try anime then series resource paths; return (video_id, streams)."""
    vid = (video_id or "").strip()
    if not vid:
        raise RuntimeError("Missing video id for stream lookup.")
    last_err: Exception | None = None
    for stream_type in ("movie", "series", "anime"):
        try:
            streams = await aiostreams.fetch_streams(stream_type, vid)
            if streams:
                return vid, streams
        except Exception as exc:
            last_err = exc
            continue
    raise RuntimeError(str(last_err) or "Could not load streams for this id")
