import asyncio
import logging
import time
from pathlib import Path

from .. import settings_store
from ..db import SessionLocal
from ..events import record_event
from ..library.playback import build_playback_file
from ..models import LibraryItem, QueueItem
from ..obs.controller import aio, controller
from ..ws import hub

logger = logging.getLogger(__name__)

CURRENT_KEY = "queue.current_index"

# Ignore auto-advance briefly after any intentional track change (covers remux + OBS swap).
_IGNORE_END_AFTER_PLAY_SEC = 12.0
# Minimum gap between successful auto-advances (event + poller can both fire).
_ADVANCE_DEBOUNCE_SEC = 2.0
# No cursor progress while "playing" → treat as frozen/corrupt and skip.
_STALL_NO_PROGRESS_SEC = 45.0
# OBS often reports duration=0 for broken tiny files — skip sooner.
_STALL_ZERO_DURATION_SEC = 20.0


class QueueManager:
    def __init__(self) -> None:
        self._advance_lock = asyncio.Lock()
        self._last_media_state = ""
        self._last_advance_at = 0.0
        self._ignore_end_until = 0.0
        self._stall_last_cursor: int | None = None
        self._stall_last_move_at = 0.0
        # Pre-remux "prepare queue" support (plan 013). Never more than one
        # background remux at a time — ffmpeg is heavy and live playback may
        # also need CPU. Status values: pending|preparing|ready|failed:<msg>.
        self._prepare_sem = asyncio.Semaphore(1)
        self._prepare: dict[int, str] = {}
        self._prepare_tasks: dict[int, asyncio.Task] = {}
        # Per-file locks so a background prepare and a play of the SAME item
        # never run ffmpeg against the same cache file concurrently
        # (build_playback_file has no internal locking).
        # Deadlock analysis: prepare acquires the global semaphore THEN the
        # item's file lock; play_index acquires ONLY the file lock and never
        # the semaphore — a single acquisition order with no cycle. All
        # lock/dict access happens on the event loop, so the dict itself
        # needs no extra synchronization.
        self._file_locks: dict[str, asyncio.Lock] = {}

    def _current_index(self) -> int:
        val = settings_store.get(CURRENT_KEY, -1)
        try:
            return int(val)
        except (TypeError, ValueError):
            return -1

    def _set_current_index(self, idx: int) -> None:
        settings_store.set_value(CURRENT_KEY, idx)

    def _begin_play_switch(self) -> None:
        """Suppress spurious end-of-playback while OBS loads the next file."""
        self._ignore_end_until = time.monotonic() + _IGNORE_END_AFTER_PLAY_SEC
        # Force the poller to observe a fresh transition into ENDED on the new file.
        self._last_media_state = ""
        self._reset_stall_watch()

    def _reset_stall_watch(self) -> None:
        self._stall_last_cursor = None
        self._stall_last_move_at = 0.0

    @staticmethod
    def _stall_timeout_sec(duration_ms: int) -> float:
        return _STALL_ZERO_DURATION_SEC if duration_ms <= 0 else _STALL_NO_PROGRESS_SEC

    @staticmethod
    def _cursor_moved(prev: int | None, cursor: int) -> bool:
        if prev is None:
            return True
        return cursor != prev

    def _should_auto_advance(self) -> bool:
        if self._current_index() < 0:
            return False
        return time.monotonic() >= self._ignore_end_until

    @staticmethod
    def _ended_looks_natural(status: dict) -> bool:
        """True when playback appears to have finished normally (not mid-switch)."""
        if status.get("media_state") != "OBS_MEDIA_STATE_ENDED":
            return False
        duration = int(status.get("duration") or 0)
        cursor = int(status.get("cursor") or 0)
        if duration <= 0:
            return False
        if cursor >= max(0, duration - 3000):
            return True
        return cursor / duration >= 0.92

    @staticmethod
    def _ended_looks_broken(status: dict) -> bool:
        """ENDED at the start or with no real timeline — typical for corrupt/empty files."""
        if status.get("media_state") != "OBS_MEDIA_STATE_ENDED":
            return False
        duration = int(status.get("duration") or 0)
        cursor = int(status.get("cursor") or 0)
        if duration <= 0:
            return True
        return cursor < 3000

    def _items(self, s) -> list[QueueItem]:
        return s.query(QueueItem).order_by(QueueItem.position.asc()).all()

    # ---- state ----------------------------------------------------------
    def snapshot(self) -> dict:
        with SessionLocal() as s:
            items = [i.to_dict() for i in self._items(s)]
        for item in items:
            item["prepare_status"] = self._prepare.get(item["id"], "")
        idx = self._current_index()
        if idx < 0 or idx >= len(items):
            idx = -1
        return {"items": items, "current_index": idx,
                "current": items[idx] if idx >= 0 else None}

    async def broadcast(self) -> None:
        await hub.broadcast("queue_update", self.snapshot())

    # ---- mutations ------------------------------------------------------
    def _add_item(self, s, library_path: str, title: str, thumbnail: str, duration: float,
                  user=None) -> QueueItem:
        last = s.query(QueueItem).order_by(QueueItem.position.desc()).first()
        pos = (last.position + 1) if last else 0
        item = QueueItem(
            library_path=library_path, title=title, thumbnail=thumbnail,
            duration=duration, position=pos,
            queued_by_user_id=getattr(user, "id", None),
            queued_by=getattr(user, "username", "") or "",
        )
        s.add(item)
        return item

    async def add_library_item(self, library_id: int, user=None) -> dict:
        with SessionLocal() as s:
            lib = s.get(LibraryItem, library_id)
            if not lib:
                raise ValueError("Library item not found")
            title = lib.display_title()
            self._add_item(s, lib.path, title,
                           lib.display_poster(), lib.duration, user=user)
            s.commit()
        record_event("queue_add", title, user=user)
        await self.broadcast()
        return self.snapshot()

    async def add_path(self, path: str, title: str = "", user=None) -> dict:
        with SessionLocal() as s:
            final_title = title or Path(path).stem
            self._add_item(s, path, final_title, "", 0.0, user=user)
            s.commit()
        record_event("queue_add", final_title, user=user)
        await self.broadcast()
        return self.snapshot()

    async def remove(self, item_id: int, user=None) -> dict:
        with SessionLocal() as s:
            item = s.get(QueueItem, item_id)
            if item:
                items = self._items(s)
                removed_pos = next((n for n, it in enumerate(items) if it.id == item_id), None)
                removed_title = item.title
                s.delete(item)
                s.commit()
                # fix current index if needed
                idx = self._current_index()
                if removed_pos is not None and removed_pos < idx:
                    self._set_current_index(idx - 1)
                self._renumber()
                record_event("queue_remove", removed_title, user=user)
                self._prepare.pop(item_id, None)
                self._prepare_tasks.pop(item_id, None)
        await self.broadcast()
        return self.snapshot()

    async def clear(self, user=None) -> dict:
        with SessionLocal() as s:
            s.query(QueueItem).delete()
            s.commit()
        self._set_current_index(-1)
        record_event("queue_clear", "Queue", user=user)
        self._prepare.clear()
        self._prepare_tasks.clear()
        await self.broadcast()
        return self.snapshot()

    def _renumber(self) -> None:
        with SessionLocal() as s:
            for n, item in enumerate(self._items(s)):
                item.position = n
            s.commit()

    async def reorder(self, ordered_ids: list[int]) -> dict:
        with SessionLocal() as s:
            items = {i.id: i for i in self._items(s)}
            # remember current item id to keep pointer on the same item
            current_id = None
            idx = self._current_index()
            ordered_now = self._items(s)
            if 0 <= idx < len(ordered_now):
                current_id = ordered_now[idx].id
            for n, item_id in enumerate(ordered_ids):
                if item_id in items:
                    items[item_id].position = n
            s.commit()
            if current_id is not None:
                new_idx = next((n for n, i in enumerate(ordered_ids) if i == current_id), idx)
                self._set_current_index(new_idx)
        await self.broadcast()
        return self.snapshot()

    # ---- prepare (pre-remux) ---------------------------------------------
    def _file_lock(self, path: str) -> asyncio.Lock:
        """Per-library-path lock (created on demand, kept for process life —
        never dropped while a holder may exist)."""
        lock = self._file_locks.get(path)
        if lock is None:
            lock = asyncio.Lock()
            self._file_locks[path] = lock
        return lock

    async def prepare_item(self, item_id: int) -> dict:
        """Kick off a background remux for one queue item so play-time gets an
        instant cache hit. No-op if already ready or in flight; a failed item
        may be retried."""
        status = self._prepare.get(item_id, "")
        existing = self._prepare_tasks.get(item_id)
        if status in ("pending", "preparing", "ready") or (existing and not existing.done()):
            return self.snapshot()

        with SessionLocal() as s:
            item = s.get(QueueItem, item_id)
            if not item:
                raise ValueError("Queue item not found")
            lib = s.query(LibraryItem).filter(
                LibraryItem.path == item.library_path).first()
            title = item.title
            library_path = item.library_path

        if not lib:
            # Raw path with no library entry — play_index opens it as-is, so
            # there is nothing to remux.
            self._prepare[item_id] = "ready"
            await self.broadcast()
            return self.snapshot()

        self._prepare[item_id] = "pending"
        await self.broadcast()
        task = asyncio.create_task(self._run_prepare(item_id, lib, library_path, title))
        self._prepare_tasks[item_id] = task
        return self.snapshot()

    async def _run_prepare(self, item_id: int, lib: LibraryItem,
                           library_path: str, title: str) -> None:
        # Acquisition order: global semaphore FIRST, then the per-item file
        # lock (play_index takes only the file lock) — see __init__ comment
        # for the deadlock analysis.
        async with self._prepare_sem:
            if item_id not in self._prepare:
                return  # removed from queue while waiting for the semaphore
            self._prepare[item_id] = "preparing"
            await self.broadcast()
            try:
                async with self._file_lock(library_path):
                    await asyncio.to_thread(build_playback_file, lib)
            except Exception as exc:
                status = f"failed:{exc}"
                logger.warning("Prepare failed for %s (queue item %s): %s",
                               title, item_id, exc)
            else:
                status = "ready"
                record_event("queue_prepare", title)
            if item_id in self._prepare:  # skip if removed mid-remux
                self._prepare[item_id] = status
            await self.broadcast()

    async def prepare_all(self) -> dict:
        with SessionLocal() as s:
            item_ids = [i.id for i in self._items(s)]
        for item_id in item_ids:
            status = self._prepare.get(item_id, "")
            existing = self._prepare_tasks.get(item_id)
            if status in ("pending", "preparing", "ready") or (existing and not existing.done()):
                continue
            await self.prepare_item(item_id)
        return self.snapshot()

    # ---- playback -------------------------------------------------------
    async def play_index(self, idx: int) -> dict:
        self._begin_play_switch()
        with SessionLocal() as s:
            items = self._items(s)
            if idx < 0 or idx >= len(items):
                raise ValueError("Index out of range")
            target = items[idx]
            lib = s.query(LibraryItem).filter(LibraryItem.path == target.library_path).first()
            if lib:
                try:
                    # Coordinate with background prepares of the SAME file:
                    # takes only the per-item lock, never the prepare
                    # semaphore (see __init__ deadlock analysis).
                    async with self._file_lock(target.library_path):
                        path = await asyncio.to_thread(build_playback_file, lib)
                except Exception as exc:
                    raise ValueError(f"Could not prepare playback: {exc}") from exc
            else:
                path = target.library_path
        self._set_current_index(idx)
        # Note: we intentionally do NOT auto-start the OBS stream here. The
        # continuous stream is controlled by the explicit "Go live" button so
        # that playing a file never triggers a surprise RTMP reconnect.
        await aio(controller.play_file, path)
        await self.broadcast()
        await self.broadcast_player()
        return self.snapshot()

    async def play_current_or_first(self) -> dict:
        idx = self._current_index()
        if idx < 0:
            idx = 0
        return await self.play_index(idx)

    async def next(self) -> dict:
        with SessionLocal() as s:
            count = len(self._items(s))
        if count == 0:
            return self.snapshot()
        idx = self._current_index() + 1
        if idx >= count:
            if settings_store.get("queue_loop", True):
                return await self.play_index(0)
            return self.snapshot()
        return await self.play_index(idx)

    async def prev(self) -> dict:
        idx = self._current_index() - 1
        if idx < 0:
            return self.snapshot()
        return await self.play_index(idx)

    def on_playback_ended(self) -> None:
        """Called from the OBS event thread; advance the queue."""
        from ..main import schedule

        schedule(self.advance_after_end())

    async def _auto_advance(self, reason: str) -> None:
        async with self._advance_lock:
            if not self._should_auto_advance():
                return
            now = time.monotonic()
            if now - self._last_advance_at < _ADVANCE_DEBOUNCE_SEC:
                return
            before = self.snapshot()
            skipped = before.get("current") or {}
            try:
                snap = await self.next()
            except Exception:
                self._last_media_state = ""
                self._reset_stall_watch()
                raise
            self._last_advance_at = now
            self._reset_stall_watch()
            cur_idx = snap.get("current_index", -1)
            cur = snap.get("current") or {}
            title = cur.get("title") or "next item"
            logger.info("Queue auto-advanced (%s) to index %s (%s)", reason, cur_idx, title)
            if reason != "playback ended":
                skipped_title = skipped.get("title") or "current item"
                record_event("auto_skip", skipped_title, detail=reason)
                await hub.broadcast(
                    "player_warning",
                    {
                        "reason": reason,
                        "title": skipped_title,
                    },
                )

    async def advance_after_end(self) -> None:
        """Advance queue when the current file finishes (event + poller)."""
        if not self._should_auto_advance():
            return
        now = time.monotonic()
        if now - self._last_advance_at < _ADVANCE_DEBOUNCE_SEC:
            return
        try:
            status = await aio(controller.status)
        except Exception:
            return
        if not self._ended_looks_natural(status):
            logger.debug(
                "Ignoring playback end (cursor=%s duration=%s)",
                status.get("cursor"),
                status.get("duration"),
            )
            return
        await self._auto_advance("playback ended")

    async def poll_playback_stall(self) -> None:
        """Skip to next when PLAYING but the timeline has not moved (corrupt/frozen file)."""
        if not self._should_auto_advance():
            return
        try:
            status = await aio(controller.status)
        except Exception:
            return

        state = status.get("media_state", "")
        cursor = int(status.get("cursor") or 0)
        duration = int(status.get("duration") or 0)

        if state == "OBS_MEDIA_STATE_PAUSED":
            self._stall_last_cursor = cursor
            self._stall_last_move_at = time.monotonic()
            return

        if state == "OBS_MEDIA_STATE_ERROR":
            logger.warning(
                "OBS media error (cursor=%s duration=%s), skipping",
                cursor,
                duration,
            )
            await self._auto_advance("media error")
            return

        if state in (
            "OBS_MEDIA_STATE_OPENING",
            "OBS_MEDIA_STATE_BUFFERING",
            "OBS_MEDIA_STATE_NONE",
        ):
            return

        if state != "OBS_MEDIA_STATE_PLAYING":
            self._reset_stall_watch()
            return

        now = time.monotonic()
        if self._stall_last_move_at <= 0:
            self._stall_last_move_at = now
            self._stall_last_cursor = cursor
            return

        if self._cursor_moved(self._stall_last_cursor, cursor):
            self._stall_last_cursor = cursor
            self._stall_last_move_at = now
            return

        limit = self._stall_timeout_sec(duration)
        if now - self._stall_last_move_at < limit:
            return

        logger.warning(
            "Playback stalled for %.0fs (cursor=%s duration=%s), skipping",
            now - self._stall_last_move_at,
            cursor,
            duration,
        )
        await self._auto_advance("playback stalled")

    async def poll_playback_end(self) -> None:
        """Fallback when OBS WebSocket end events do not fire."""
        try:
            status = await aio(controller.status)
        except Exception:
            return
        state = status.get("media_state", "")
        prev = self._last_media_state
        self._last_media_state = state
        if state != "OBS_MEDIA_STATE_ENDED" or prev == "OBS_MEDIA_STATE_ENDED":
            return
        if self._ended_looks_natural(status):
            await self.advance_after_end()
            return
        if self._ended_looks_broken(status):
            logger.warning(
                "Abnormal end (likely corrupt file) cursor=%s duration=%s, skipping",
                status.get("cursor"),
                status.get("duration"),
            )
            await self._auto_advance("broken media ended")

    async def broadcast_player(self) -> None:
        try:
            status = await aio(controller.status)
        except Exception:
            status = {"media_state": "", "duration": 0, "cursor": 0}
        snap = self.snapshot()
        vol = self._player_prefs()
        await hub.broadcast(
            "player_update",
            {
                "media_state": status.get("media_state", ""),
                "duration": status.get("duration", 0),
                "cursor": status.get("cursor", 0),
                "current": snap.get("current"),
                "current_index": snap.get("current_index"),
                **vol,
            },
        )

    def _player_prefs(self) -> dict:
        try:
            mul = float(settings_store.get("obs_media_volume", 1.0))
        except (TypeError, ValueError):
            mul = 1.0
        return {
            "volume_percent": max(0, min(100, round(mul * 100))),
            "queue_loop": bool(settings_store.get("queue_loop", True)),
        }


manager = QueueManager()
