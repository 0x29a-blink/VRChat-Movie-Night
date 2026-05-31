import asyncio
import os
import re
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import httpx
import psutil

from .. import settings_store
from ..config import settings
from ..db import SessionLocal
from ..downloads.link_meta import DownloadLinkMeta, apply_link_meta_to_job, job_link_meta
from ..models import Job, LibraryItem
from ..ws import hub

# Marker-prefixed progress line so we can parse reliably amid other output.
# Fields: status|downloaded|total|total_est|speed|eta|frag_index|frag_count|title
PROGRESS_TEMPLATE = (
    "download:VRCPROG|%(progress.status)s|%(progress.downloaded_bytes)s|"
    "%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|"
    "%(progress.speed)s|%(progress.eta)s|"
    "%(progress.fragment_index)s|%(progress.fragment_count)s|%(info.title)s"
)

VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".ts", ".m4v", ".avi"}
# Substrings that mark yt-dlp/ffmpeg temp files (incl. HLS ".part-FragN").
TEMP_MARKERS = (".part", ".ytdl", ".temp", ".tmp", ".download", "-frag", ".frag")

_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _is_hls_source(source: str) -> bool:
    low = (source or "").lower()
    return (
        ".m3u8" in low
        or low.endswith(".m3u")
        or "/hls/" in low
        or "application/vnd.apple.mpegurl" in low
        or "format=m3u8" in low
    )


def _ffmpeg_hls_retryable(err: str) -> bool:
    low = err.lower()
    return (
        "bitstream" in low
        or "invalid data" in low
        or "error muxing" in low
        or "error submitting a packet" in low
        or "matroska" in low
        or "incorrect codec parameters" in low
        or "could not write header" in low
    )


def _probe_download_kind(source: str, referer: str) -> str:
    """Choose direct HTTP, HLS ffmpeg, or yt-dlp for a URL."""
    if _is_hls_source(source):
        return "hls"
    low = source.lower()
    if "torbox.app" in low or "torbox." in low:
        return "direct"
    headers = {"Referer": referer} if referer else {}
    try:
        with httpx.Client(follow_redirects=True, timeout=30.0) as client:
            resp = client.head(source, headers=headers)
            final = str(resp.url)
            ct = (resp.headers.get("content-type") or "").lower()
            if _is_hls_source(final) or "mpegurl" in ct or "dash+xml" in ct:
                return "hls"
            if ct.startswith("video/") or "octet-stream" in ct:
                return "direct"
            low = final.lower()
            if "torbox.app" in low or "torbox." in low:
                return "direct"
            path = urlparse(final).path.lower()
            if any(path.endswith(ext) for ext in VIDEO_EXTS):
                return "direct"
    except Exception:
        pass
    return "ytdlp"


def _ext_from_response(headers: httpx.Headers, url: str) -> str:
    cd = headers.get("content-disposition") or ""
    m = re.search(
        r"filename\*=(?:UTF-8''|utf-8'')([^;]+)|filename=\"?([^\";]+)",
        cd,
        re.I,
    )
    if m:
        name = unquote((m.group(1) or m.group(2) or "").strip())
        ext = Path(name).suffix.lower()
        if ext in VIDEO_EXTS:
            return ext
    path = urlparse(url).path
    ext = Path(path).suffix.lower()
    if ext in VIDEO_EXTS:
        return ext
    ct = (headers.get("content-type") or "").lower()
    if "matroska" in ct or "mkv" in ct:
        return ".mkv"
    if "mp4" in ct:
        return ".mp4"
    return ".mkv"


def _safe_filename(name: str) -> str:
    cleaned = _ILLEGAL.sub("", name).strip().rstrip(". ")
    cleaned = cleaned[:120]
    cleaned = cleaned.replace("%", "%%")  # escape for yt-dlp -o template
    return cleaned or "video"


def _fmt_speed(bytes_per_sec: float | None) -> str:
    if not bytes_per_sec or bytes_per_sec <= 0:
        return ""
    units = ["B/s", "KB/s", "MB/s", "GB/s"]
    val = float(bytes_per_sec)
    i = 0
    while val >= 1024 and i < len(units) - 1:
        val /= 1024
        i += 1
    return f"{val:.1f} {units[i]}"


def _fmt_eta(seconds: float | None) -> str:
    if not seconds or seconds <= 0:
        return ""
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def _to_num(token: str) -> float | None:
    token = token.strip()
    if not token or token in ("NA", "None"):
        return None
    try:
        return float(token)
    except ValueError:
        return None


class DownloadManager:
    def __init__(self) -> None:
        self._procs: dict[str, asyncio.subprocess.Process] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._cancelled: set[str] = set()
        self._hls_out: dict[str, str] = {}
        self._cache_meta: dict[str, dict] = {}
        self._sem: asyncio.Semaphore | None = None

    def start(self) -> None:
        limit = int(settings_store.get("max_concurrent_downloads", settings.max_concurrent_downloads))
        self._sem = asyncio.Semaphore(max(1, limit))
        # Recover: any job left "downloading"/"queued" from a previous run is stale.
        with SessionLocal() as s:
            for job in s.query(Job).filter(
                Job.status.in_(["downloading", "queued", "caching"])
            ).all():
                job.status = "failed"
                job.error = "Interrupted by server restart"
            s.commit()

    # ---- public API -----------------------------------------------------
    async def add(
        self,
        type_: str,
        source: str,
        title: str = "",
        referer: str = "",
        link: DownloadLinkMeta | None = None,
    ) -> dict:
        job_id = uuid.uuid4().hex
        with SessionLocal() as s:
            job = Job(
                id=job_id,
                type=type_,
                source=source,
                title=title or "(resolving…)",
                status="queued",
            )
            apply_link_meta_to_job(job, link)
            s.add(job)
            s.commit()
            data = job.to_dict()
        await hub.broadcast("download_update", data)
        self._tasks[job_id] = asyncio.create_task(self._run(job_id, referer))
        return data

    async def add_torbox_cache(
        self,
        magnet: str,
        title: str = "",
        file_idx: int | None = None,
        filename_hint: str = "",
        size_bytes: int = 0,
        link: DownloadLinkMeta | None = None,
    ) -> dict:
        job_id = uuid.uuid4().hex
        with SessionLocal() as s:
            job = Job(
                id=job_id,
                type="torrent",
                source=magnet,
                title=title or "Caching on TorBox…",
                status="caching",
            )
            apply_link_meta_to_job(job, link)
            s.add(job)
            s.commit()
            data = job.to_dict()
        self._cache_meta[job_id] = {
            "file_idx": file_idx,
            "filename_hint": filename_hint or "",
            "size_bytes": int(size_bytes or 0),
        }
        await hub.broadcast("download_update", data)
        self._tasks[job_id] = asyncio.create_task(self._run_torbox_cache(job_id))
        return data

    async def add_torbox_playback_cache(
        self,
        playback_url: str,
        title: str = "",
        file_idx: int | None = None,
        filename_hint: str = "",
        size_bytes: int = 0,
        link: DownloadLinkMeta | None = None,
    ) -> dict:
        """Cache via AIOStreams playback URL (ElfHosted hides magnets in stream JSON)."""
        job_id = uuid.uuid4().hex
        with SessionLocal() as s:
            job = Job(
                id=job_id,
                type="torrent",
                source=playback_url,
                title=title or "Caching on TorBox…",
                status="caching",
            )
            apply_link_meta_to_job(job, link)
            s.add(job)
            s.commit()
            data = job.to_dict()
        self._cache_meta[job_id] = {
            "file_idx": file_idx,
            "filename_hint": filename_hint or "",
            "size_bytes": int(size_bytes or 0),
            "playback": True,
        }
        await hub.broadcast("download_update", data)
        self._tasks[job_id] = asyncio.create_task(self._run_torbox_playback_cache(job_id))
        return data

    async def cancel(self, job_id: str) -> bool:
        self._cancelled.add(job_id)
        proc = self._procs.get(job_id)
        if proc is not None:
            _kill_tree(proc.pid)
        # If it never started (still queued), mark cancelled now.
        with SessionLocal() as s:
            job = s.get(Job, job_id)
            if job and job.status in ("queued", "caching"):
                job.status = "cancelled"
                s.commit()
                data = job.to_dict()
                await hub.broadcast("download_update", data)
        return True

    async def restart(self, job_id: str) -> dict | None:
        with SessionLocal() as s:
            job = s.get(Job, job_id)
            if not job:
                return None
            type_, source, title = job.type, job.source, job.title
            link = job_link_meta(job)
            link_obj = DownloadLinkMeta(**link) if link else None
        return await self.add(type_, source, title=title, link=link_obj)

    async def remove(self, job_id: str) -> bool:
        if job_id in self._procs:
            await self.cancel(job_id)
        with SessionLocal() as s:
            job = s.get(Job, job_id)
            if job:
                s.delete(job)
                s.commit()
        await hub.broadcast("download_removed", {"id": job_id})
        return True

    def list_jobs(self) -> list[dict]:
        with SessionLocal() as s:
            jobs = s.query(Job).order_by(Job.created_at.desc()).limit(100).all()
            return [j.to_dict() for j in jobs]

    # ---- internals ------------------------------------------------------
    def _build_cmd(self, type_: str, source: str, out_dir: Path, referer: str,
                   out_name: str = "") -> list[str]:
        ytdlp = settings.ytdlp_path
        if out_name:
            # User/search-provided name -> clean, predictable filename.
            out_tmpl = str(out_dir / f"{_safe_filename(out_name)}.%(ext)s")
        else:
            # Cap title AND id lengths: some sources (HLS tokens) have enormous
            # ids that blow past the Windows MAX_PATH limit and break file writes.
            out_tmpl = str(out_dir / "%(title).80B [%(id).16B].%(ext)s")
        cmd = [
            ytdlp,
            "--newline",
            "--no-playlist",
            "--no-mtime",
            "--no-color",
            "--progress-template",
            PROGRESS_TEMPLATE,
            "--no-simulate",
            "--print",
            "after_move:VRCFILE|%(filepath)s",
            "-o",
            out_tmpl,
        ]
        # Only pass --ffmpeg-location when it's a real path; otherwise yt-dlp
        # treats a bare name as a missing path and silently disables merging.
        ff = settings.ffmpeg_path
        if ff and (os.path.isabs(ff) or os.sep in ff or "/" in ff):
            cmd += ["--ffmpeg-location", ff]
        if type_ == "youtube":
            cmd += ["-f", "bv*+ba/b", "--merge-output-format", "mkv"]
            if bool(settings_store.get("use_deno", settings.use_deno)):
                cmd += ["--js-runtimes", "deno"]
        else:  # torrent / direct url (yt-dlp fallback)
            cmd += [
                "--merge-output-format",
                "mkv",
                "--remux-video",
                "mkv",
                "--hls-use-mpegts",
                "--postprocessor-args",
                "Merger+ffmpeg_i:-map 0:v:0? -map 0:a:0? -sn -dn -ignore_unknown "
                "-fflags +genpts -max_muxing_queue_size 1024",
            ]
        cmd.append(source)
        return cmd

    async def _run(self, job_id: str, referer: str) -> None:
        assert self._sem is not None
        async with self._sem:
            if job_id in self._cancelled:
                await self._finish(job_id, "cancelled")
                return

            with SessionLocal() as s:
                job = s.get(Job, job_id)
                if not job:
                    return
                job.status = "downloading"
                s.commit()
                await hub.broadcast("download_update", job.to_dict())

            await self._execute_download(job_id, referer)

    async def _run_torbox_cache(self, job_id: str) -> None:
        assert self._sem is not None
        from ..torbox.client import (
            TorboxClient,
            TorboxError,
            pick_file_id,
            wait_for_torrent,
        )

        async with self._sem:
            if job_id in self._cancelled:
                await self._finish(job_id, "cancelled")
                return

            meta = self._cache_meta.get(job_id, {})
            file_idx = meta.get("file_idx")
            filename_hint = meta.get("filename_hint", "")

            try:
                api_key = str(settings_store.get("torbox_api_key", "") or "")
                client = TorboxClient(api_key)

                with SessionLocal() as s:
                    job = s.get(Job, job_id)
                    if not job:
                        return
                    magnet = job.source
                    display_title = job.title

                created = await client.create_torrent(magnet, display_title)
                torrent_id = int(created["torrent_id"])

                async def on_progress(torrent: dict, pct: float) -> None:
                    if job_id in self._cancelled:
                        return
                    with SessionLocal() as s:
                        job = s.get(Job, job_id)
                        if not job:
                            return
                        job.percent = min(pct, 99.0)
                        job.speed = _fmt_speed(float(torrent.get("download_speed") or 0))
                        eta_raw = torrent.get("eta")
                        job.eta = _fmt_eta(float(eta_raw)) if eta_raw else ""
                        s.commit()
                        await hub.broadcast("download_update", job.to_dict())

                torrent = await wait_for_torrent(
                    client,
                    torrent_id,
                    on_progress=on_progress,
                    should_cancel=lambda: job_id in self._cancelled,
                )

                if job_id in self._cancelled:
                    await self._finish(job_id, "cancelled")
                    return

                file_id = pick_file_id(torrent, file_idx, filename_hint)
                download_url = await client.request_download_link(torrent_id, file_id)

                with SessionLocal() as s:
                    job = s.get(Job, job_id)
                    if not job:
                        return
                    job.source = download_url
                    job.status = "downloading"
                    job.percent = 0.0
                    job.speed = ""
                    job.eta = ""
                    s.commit()
                    await hub.broadcast("download_update", job.to_dict())

                await self._execute_download(job_id, "")

            except TorboxError as exc:
                await self._finish(job_id, "failed", error=str(exc))
            except Exception as exc:  # noqa: BLE001
                await self._finish(job_id, "failed", error=f"TorBox cache failed: {exc}")
            finally:
                self._cache_meta.pop(job_id, None)

    async def _run_torbox_playback_cache(self, job_id: str) -> None:
        assert self._sem is not None
        from ..torbox.client import (
            TorboxClient,
            TorboxError,
            pick_file_id,
            trigger_playback_prewarm,
            wait_for_new_torrent,
            wait_for_torrent,
        )

        async with self._sem:
            if job_id in self._cancelled:
                await self._finish(job_id, "cancelled")
                return

            meta = self._cache_meta.get(job_id, {})
            file_idx = meta.get("file_idx")
            filename_hint = meta.get("filename_hint", "")
            size_bytes = int(meta.get("size_bytes") or 0)

            try:
                api_key = str(settings_store.get("torbox_api_key", "") or "")
                client = TorboxClient(api_key)

                with SessionLocal() as s:
                    job = s.get(Job, job_id)
                    if not job:
                        return
                    playback_url = job.source

                before = {int(t["id"]) for t in await client.list_torrents() if t.get("id")}
                await trigger_playback_prewarm(playback_url)

                async def on_progress(torrent: dict, pct: float) -> None:
                    if job_id in self._cancelled:
                        return
                    with SessionLocal() as s:
                        job = s.get(Job, job_id)
                        if not job:
                            return
                        job.percent = min(pct, 99.0)
                        job.speed = _fmt_speed(float(torrent.get("download_speed") or 0))
                        eta_raw = torrent.get("eta")
                        job.eta = _fmt_eta(float(eta_raw)) if eta_raw else ""
                        s.commit()
                        await hub.broadcast("download_update", job.to_dict())

                found = await wait_for_new_torrent(
                    client,
                    before_ids=before,
                    filename_hint=filename_hint,
                    size_bytes=size_bytes,
                    should_cancel=lambda: job_id in self._cancelled,
                )
                torrent_id = int(found["id"])

                torrent = await wait_for_torrent(
                    client,
                    torrent_id,
                    on_progress=on_progress,
                    should_cancel=lambda: job_id in self._cancelled,
                )

                if job_id in self._cancelled:
                    await self._finish(job_id, "cancelled")
                    return

                file_id = pick_file_id(torrent, file_idx, filename_hint)
                download_url = await client.request_download_link(torrent_id, file_id)

                with SessionLocal() as s:
                    job = s.get(Job, job_id)
                    if not job:
                        return
                    job.source = download_url
                    job.status = "downloading"
                    job.percent = 0.0
                    job.speed = ""
                    job.eta = ""
                    s.commit()
                    await hub.broadcast("download_update", job.to_dict())

                await self._execute_download(job_id, "")

            except TorboxError as exc:
                await self._finish(job_id, "failed", error=str(exc))
            except Exception as exc:  # noqa: BLE001
                await self._finish(job_id, "failed", error=f"TorBox cache failed: {exc}")
            finally:
                self._cache_meta.pop(job_id, None)

    async def _execute_download(self, job_id: str, referer: str) -> None:
        with SessionLocal() as s:
            job = s.get(Job, job_id)
            if not job:
                return
            type_, source = job.type, job.source
            provided = job.title if job.title and job.title not in (
                "(resolving…)",
                "Caching on TorBox…",
            ) else ""

        out_dir = settings.folder_for(type_)
        out_dir.mkdir(parents=True, exist_ok=True)

        try:
            kind = "hls" if type_ == "m3u8" else await asyncio.to_thread(
                _probe_download_kind, source, referer
            )
            if kind == "hls":
                rc, final_path, err = await self._run_hls(
                    job_id, source, out_dir, referer, provided
                )
            elif kind == "direct":
                rc, final_path, err = await self._run_direct_http(
                    job_id, source, out_dir, referer, provided
                )
            else:
                rc, final_path, err = await self._run_ytdlp(
                    job_id, type_, source, out_dir, referer, provided
                )
        except Exception as exc:  # noqa: BLE001
            rc, final_path, err = 1, "", f"download error: {exc}"

        self._procs.pop(job_id, None)

        if job_id in self._cancelled:
            _cleanup_temp(out_dir)
            self._remove_partial(job_id)
            await self._finish(job_id, "cancelled")
            self._hls_out.pop(job_id, None)
            return

        if rc == 0:
            await self._finish(job_id, "completed", output_path=final_path, percent=100.0)
            from ..library.scanner import scan_folder

            try:
                await asyncio.to_thread(scan_folder, type_)
                await self._apply_job_library_link(job_id, final_path)
            except Exception:
                pass
        else:
            await self._finish(job_id, "failed", error=err)
        self._hls_out.pop(job_id, None)

    async def _run_ytdlp(self, job_id: str, type_: str, source: str, out_dir: Path,
                         referer: str, provided: str) -> tuple[int, str, str]:
        cmd = self._build_cmd(type_, source, out_dir, referer, provided)
        # yt-dlp is frozen CPython; force unbuffered stdout so progress lines
        # stream to us immediately instead of being block-buffered.
        child_env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=child_env,
            )
        except FileNotFoundError as exc:
            return 1, "", f"yt-dlp not found: {exc}"

        self._procs[job_id] = proc
        final_path = ""
        last_emit = 0.0
        tail: list[str] = []

        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if not line:
                continue
            if line.startswith("VRCPROG|"):
                last_emit = await self._handle_progress(job_id, line, last_emit)
            elif line.startswith("VRCFILE|"):
                final_path = line.split("|", 1)[1].strip()
            else:
                tail.append(line)
                if len(tail) > 15:
                    tail.pop(0)

        rc = await proc.wait()
        if rc == 0:
            return 0, final_path, ""
        err = "\n".join(tail[-6:]) or f"yt-dlp exited with code {rc}"
        return rc, "", err

    def _hls_output_path(self, out_dir: Path, provided: str) -> Path:
        base = _safe_filename(provided).replace("%%", "%") if provided else "stream"
        out_path = out_dir / f"{base}.mkv"
        i = 1
        while out_path.exists():
            out_path = out_dir / f"{base} ({i}).mkv"
            i += 1
        return out_path

    def _build_ffmpeg_hls_cmd(
        self,
        target: str,
        referer: str,
        out_path: Path,
        *,
        mode: str,
    ) -> list[str]:
        """mode: copy_va | transcode_a | transcode_va"""
        ff = settings.ffmpeg_path
        cmd = [
            ff,
            "-hide_banner",
            "-loglevel",
            "error",
            "-extension_picky",
            "0",
            "-protocol_whitelist",
            "file,http,https,tcp,tls,crypto",
            "-fflags",
            "+genpts+discardcorrupt",
        ]
        if referer:
            cmd += ["-headers", f"Referer: {referer}\r\n"]
        cmd += ["-i", target]
        maps = ["-map", "0:v:0?", "-map", "0:a:0?", "-sn", "-dn", "-ignore_unknown"]
        if mode == "copy_va":
            cmd += maps + ["-c", "copy"]
        elif mode == "transcode_a":
            cmd += maps + ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]
        else:  # transcode_va
            cmd += maps + [
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
            ]
        cmd += [
            "-max_muxing_queue_size",
            "1024",
            "-progress",
            "pipe:1",
            "-nostats",
            "-y",
            str(out_path),
        ]
        return cmd

    async def _run_hls(self, job_id: str, source: str, out_dir: Path, referer: str,
                       provided: str) -> tuple[int, str, str]:
        """Download an HLS (.m3u8) VOD straight with ffmpeg.

        yt-dlp's native downloader intermittently misflags these as "live" and
        refuses, and many sites disguise segments as .css/.js/.html which trips
        ffmpeg's extension whitelist. Driving ffmpeg ourselves with
        -extension_picky 0 handles both, and we compute progress from total_size
        against a duration*bitrate size estimate (these streams report no
        out_time/speed).

        Output is MKV (not MP4) because copy-muxing MPEG-TS HLS into MP4 often
        fails with bitstream-filter errors on AAC/HEVC (TorBox CDN, etc.).
        """
        info = await asyncio.to_thread(self._probe_hls, source, referer)
        target = info["url"]
        duration = info["duration"]
        est_bytes = info["est_bytes"]

        out_path = self._hls_output_path(out_dir, provided)
        self._hls_out[job_id] = str(out_path)

        last_err = ""
        for idx, mode in enumerate(("copy_va", "transcode_a", "transcode_va")):
            if idx > 0:
                try:
                    out_path.unlink(missing_ok=True)
                except OSError:
                    pass
            rc, err = await self._run_ffmpeg_hls_pass(
                job_id, target, referer, out_path, duration, est_bytes, mode
            )
            if rc == 0:
                return 0, str(out_path), ""
            last_err = err
            if idx < 2 and _ffmpeg_hls_retryable(err):
                continue
            break

        return 1, "", last_err

    async def _run_direct_http(
        self,
        job_id: str,
        source: str,
        out_dir: Path,
        referer: str,
        provided: str,
    ) -> tuple[int, str, str]:
        """Download a single file over HTTP(S) without ffmpeg (TorBox CDN, etc.)."""
        headers = {"Referer": referer} if referer else {}
        out_path: Path | None = None
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=None) as client:
                async with client.stream("GET", source, headers=headers) as resp:
                    if resp.status_code >= 400:
                        body = await resp.aread()
                        return 1, "", f"HTTP {resp.status_code}: {body[:200]!r}"
                    ext = _ext_from_response(resp.headers, str(resp.url))
                    base = _safe_filename(provided) if provided else "download"
                    out_path = out_dir / f"{base}{ext}"
                    i = 1
                    while out_path.exists():
                        out_path = out_dir / f"{base} ({i}){ext}"
                        i += 1

                    total = int(resp.headers.get("content-length") or 0)
                    if total:
                        with SessionLocal() as s:
                            job = s.get(Job, job_id)
                            if job:
                                job.total = total
                                s.commit()

                    downloaded = 0
                    last_emit = 0.0
                    t0 = time.time()
                    last_dl = 0

                    with open(out_path, "wb") as fh:
                        async for chunk in resp.aiter_bytes(chunk_size=1024 * 256):
                            if job_id in self._cancelled:
                                return 1, "", "Cancelled"
                            fh.write(chunk)
                            downloaded += len(chunk)
                            now = time.time()
                            if now - last_emit >= 0.5:
                                speed = (downloaded - last_dl) / (now - t0) if now > t0 else 0
                                last_dl = downloaded
                                t0 = now
                                pct = (
                                    min(downloaded / total * 100.0, 99.9)
                                    if total
                                    else 0.0
                                )
                                with SessionLocal() as s:
                                    job = s.get(Job, job_id)
                                    if job:
                                        job.percent = pct
                                        job.speed = _fmt_speed(speed)
                                        if speed > 0 and total:
                                            job.eta = _fmt_eta(
                                                (total - downloaded) / speed
                                            )
                                        s.commit()
                                        await hub.broadcast(
                                            "download_update", job.to_dict()
                                        )
                                last_emit = now

            return 0, str(out_path), ""
        except Exception as exc:  # noqa: BLE001
            if out_path:
                try:
                    out_path.unlink(missing_ok=True)
                except OSError:
                    pass
            return 1, "", f"Direct download failed: {exc}"

    async def _run_ffmpeg_hls_pass(
        self,
        job_id: str,
        target: str,
        referer: str,
        out_path: Path,
        duration: float,
        est_bytes: int,
        mode: str,
    ) -> tuple[int, str]:
        cmd = self._build_ffmpeg_hls_cmd(target, referer, out_path, mode=mode)

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except FileNotFoundError as exc:
            return 1, f"ffmpeg not found: {exc}"

        self._procs[job_id] = proc
        if est_bytes:
            with SessionLocal() as s:
                job = s.get(Job, job_id)
                if job:
                    job.total = est_bytes
                    s.commit()

        tail: list[str] = []
        kv: dict[str, str] = {}
        state = {"last_size": 0.0, "last_t": time.time(), "last_emit": 0.0}

        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            if "=" in line and not line.startswith("["):
                key, _, val = line.partition("=")
                key = key.strip()
                kv[key] = val.strip()
                if key == "progress":
                    await self._emit_hls(job_id, kv, est_bytes, duration, state)
            else:
                tail.append(line)
                if len(tail) > 15:
                    tail.pop(0)

        rc = await proc.wait()
        if rc == 0:
            return 0, ""
        err = "\n".join(tail[-8:]) or f"ffmpeg exited with code {rc}"
        if mode != "copy_va":
            err = f"{err}\n(ffmpeg remux mode: {mode})"
        return rc, err

    async def _emit_hls(self, job_id: str, kv: dict, est_bytes: int,
                        duration: float, state: dict) -> None:
        now = time.time()
        status = kv.get("progress", "")
        if now - state["last_emit"] < 0.5 and status != "end":
            return
        total_size = _to_num(kv.get("total_size", "")) or 0.0
        out_time_us = _to_num(kv.get("out_time_us", ""))

        dt = now - state["last_t"]
        speed_bps = None
        if dt > 0 and total_size >= state["last_size"]:
            speed_bps = (total_size - state["last_size"]) / dt

        if out_time_us and duration:
            percent = min(out_time_us / 1_000_000 / duration * 100.0, 99.9)
        elif est_bytes and total_size:
            percent = min(total_size / est_bytes * 100.0, 99.9)
        else:
            percent = 0.0
        if status == "end":
            percent = 100.0

        eta = None
        if speed_bps and speed_bps > 0 and est_bytes and total_size:
            eta = max(est_bytes - total_size, 0) / speed_bps

        with SessionLocal() as s:
            job = s.get(Job, job_id)
            if not job:
                return
            job.downloaded = int(total_size)
            if est_bytes:
                job.total = est_bytes
            job.percent = percent
            job.speed = _fmt_speed(speed_bps)
            job.eta = _fmt_eta(eta)
            s.commit()
            data = job.to_dict()
        state.update(last_size=total_size, last_t=now, last_emit=now)
        await hub.broadcast("download_update", data)

    def _probe_hls(self, source: str, referer: str) -> dict:
        """Resolve the best variant URL + duration + estimated byte size."""
        headers = {"Referer": referer} if referer else {}
        target = source
        est_bw = 0
        try:
            text = httpx.get(
                source, headers=headers, timeout=30.0, follow_redirects=True
            ).text
            if "#EXT-X-STREAM-INF" in text:
                lines = text.splitlines()
                best_bw, best_url = -1, ""
                for idx, ln in enumerate(lines):
                    if ln.startswith("#EXT-X-STREAM-INF"):
                        m = re.search(r"BANDWIDTH=(\d+)", ln)
                        bw = int(m.group(1)) if m else 0
                        for nxt in lines[idx + 1:]:
                            nxt = nxt.strip()
                            if nxt and not nxt.startswith("#"):
                                if bw > best_bw:
                                    best_bw, best_url = bw, nxt
                                break
                if best_url:
                    target = urljoin(source, best_url)
                    est_bw = best_bw
        except Exception:
            pass

        duration = self._ffprobe_duration(target, referer)
        if not est_bw:
            est_bw = self._ffprobe_bitrate(target, referer)
        est_bytes = int(duration * est_bw / 8) if (duration and est_bw) else 0
        return {"url": target, "duration": duration, "est_bytes": est_bytes}

    def _ffprobe_duration(self, url: str, referer: str) -> float:
        cmd = [settings.ffprobe_path, "-v", "error", "-extension_picky", "0"]
        if referer:
            cmd += ["-headers", f"Referer: {referer}\r\n"]
        cmd += [
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", url,
        ]
        try:
            res = subprocess.run(
                cmd, capture_output=True, text=True, timeout=60,
                creationflags=0x08000000,
            )
            return float((res.stdout or "0").strip() or 0)
        except Exception:
            return 0.0

    def _ffprobe_bitrate(self, url: str, referer: str) -> int:
        cmd = [settings.ffprobe_path, "-v", "error", "-extension_picky", "0"]
        if referer:
            cmd += ["-headers", f"Referer: {referer}\r\n"]
        cmd += [
            "-show_entries", "format=bit_rate",
            "-of", "default=noprint_wrappers=1:nokey=1", url,
        ]
        try:
            res = subprocess.run(
                cmd, capture_output=True, text=True, timeout=60,
                creationflags=0x08000000,
            )
            return int(float((res.stdout or "0").strip() or 0))
        except Exception:
            return 0

    def _remove_partial(self, job_id: str) -> None:
        path = self._hls_out.get(job_id)
        if path:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass

    async def _handle_progress(self, job_id: str, line: str, last_emit: float) -> float:
        parts = line.split("|")
        # VRCPROG|status|downloaded|total|total_est|speed|eta|frag_idx|frag_cnt|title
        if len(parts) < 10:
            return last_emit
        downloaded = _to_num(parts[2]) or 0
        total_real = _to_num(parts[3]) or 0
        total_est = _to_num(parts[4]) or 0
        speed = _to_num(parts[5])
        eta = _to_num(parts[6])
        frag_idx = _to_num(parts[7])
        frag_cnt = _to_num(parts[8])
        title = parts[9].strip()

        if frag_cnt and frag_cnt > 0 and frag_idx is not None:
            # Fragmented (HLS/DASH): downloaded_bytes resets per fragment, so
            # the real progress is fragment index / count. Derive a believable
            # byte readout from the size estimate.
            percent = frag_idx / frag_cnt * 100.0
            total = total_est or total_real or 0
            downloaded = int(total * frag_idx / frag_cnt) if total else 0
        else:
            total = total_real or total_est or 0
            percent = (downloaded / total * 100.0) if total else 0.0

        now = time.time()
        if now - last_emit < 0.4 and percent < 100:
            return last_emit

        with SessionLocal() as s:
            job = s.get(Job, job_id)
            if not job:
                return now
            job.downloaded = int(downloaded)
            job.total = int(total)
            job.percent = min(percent, 100.0)
            job.speed = _fmt_speed(speed)
            job.eta = _fmt_eta(eta)
            if title and (not job.title or job.title == "(resolving…)"):
                job.title = title
            s.commit()
            data = job.to_dict()
        await hub.broadcast("download_update", data)
        return now

    async def _finish(self, job_id: str, status_: str, *, output_path: str = "",
                      percent: float | None = None, error: str = "") -> None:
        with SessionLocal() as s:
            job = s.get(Job, job_id)
            if not job:
                return
            job.status = status_
            if output_path:
                job.output_path = output_path
                if output_path:
                    job.title = Path(output_path).stem or job.title
            if percent is not None:
                job.percent = percent
            if error:
                job.error = error
            if status_ in ("completed", "failed", "cancelled"):
                job.speed = ""
                job.eta = ""
            s.commit()
            data = job.to_dict()
        self._cancelled.discard(job_id)
        await hub.broadcast("download_update", data)

    async def _apply_job_library_link(self, job_id: str, output_path: str) -> None:
        from ..library.linking import apply_tmdb_link

        path = str(Path(output_path).resolve())
        with SessionLocal() as s:
            job = s.get(Job, job_id)
            if not job or not job.link_tmdb_id:
                return
            lib = s.query(LibraryItem).filter(LibraryItem.path == path).first()
            if not lib:
                return
            try:
                await apply_tmdb_link(
                    s,
                    lib,
                    tmdb_id=job.link_tmdb_id,
                    media_type=job.link_media_type or "movie",
                    season=job.link_season,
                    episode=job.link_episode,
                    watchlist_item_id=job.link_watchlist_id,
                )
                s.commit()
                linked_title = lib.display_title()
            except Exception:
                s.rollback()
                return

        from ..playqueue.manager import manager as queue_manager

        await hub.broadcast("library_update", {"reason": "download_linked", "title": linked_title})
        await queue_manager.broadcast()


def _kill_tree(pid: int) -> None:
    try:
        parent = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return
    children = parent.children(recursive=True)
    for child in children:
        try:
            child.kill()
        except psutil.NoSuchProcess:
            pass
    try:
        parent.kill()
    except psutil.NoSuchProcess:
        pass


def _cleanup_temp(folder: Path) -> None:
    try:
        for f in folder.iterdir():
            name = f.name.lower()
            if f.is_file() and any(marker in name for marker in TEMP_MARKERS):
                try:
                    f.unlink()
                except OSError:
                    pass
    except OSError:
        pass


manager = DownloadManager()
