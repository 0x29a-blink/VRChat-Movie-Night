import asyncio
import time
from pathlib import Path

from .. import settings_store
from ..db import SessionLocal
from ..models import LibraryItem, QueueItem
from ..library.playback import build_playback_file
from ..obs.controller import aio, controller
from ..ws import hub

CURRENT_KEY = "queue.current_index"


class QueueManager:
    def __init__(self) -> None:
        self._advance_lock = asyncio.Lock()
        self._last_media_state = ""
        self._last_advance_at = 0.0

    def _current_index(self) -> int:
        val = settings_store.get(CURRENT_KEY, -1)
        try:
            return int(val)
        except (TypeError, ValueError):
            return -1

    def _set_current_index(self, idx: int) -> None:
        settings_store.set_value(CURRENT_KEY, idx)

    def _items(self, s) -> list[QueueItem]:
        return s.query(QueueItem).order_by(QueueItem.position.asc()).all()

    # ---- state ----------------------------------------------------------
    def snapshot(self) -> dict:
        with SessionLocal() as s:
            items = [i.to_dict() for i in self._items(s)]
        idx = self._current_index()
        if idx < 0 or idx >= len(items):
            idx = -1
        return {"items": items, "current_index": idx,
                "current": items[idx] if idx >= 0 else None}

    async def broadcast(self) -> None:
        await hub.broadcast("queue_update", self.snapshot())

    # ---- mutations ------------------------------------------------------
    def _add_item(self, s, library_path: str, title: str, thumbnail: str, duration: float) -> QueueItem:
        last = s.query(QueueItem).order_by(QueueItem.position.desc()).first()
        pos = (last.position + 1) if last else 0
        item = QueueItem(
            library_path=library_path, title=title, thumbnail=thumbnail,
            duration=duration, position=pos,
        )
        s.add(item)
        return item

    async def add_library_item(self, library_id: int) -> dict:
        with SessionLocal() as s:
            lib = s.get(LibraryItem, library_id)
            if not lib:
                raise ValueError("Library item not found")
            self._add_item(s, lib.path, lib.display_title(),
                           lib.display_poster(), lib.duration)
            s.commit()
        await self.broadcast()
        return self.snapshot()

    async def add_path(self, path: str, title: str = "") -> dict:
        with SessionLocal() as s:
            self._add_item(s, path, title or Path(path).stem, "", 0.0)
            s.commit()
        await self.broadcast()
        return self.snapshot()

    async def remove(self, item_id: int) -> dict:
        with SessionLocal() as s:
            item = s.get(QueueItem, item_id)
            if item:
                items = self._items(s)
                removed_pos = next((n for n, it in enumerate(items) if it.id == item_id), None)
                s.delete(item)
                s.commit()
                # fix current index if needed
                idx = self._current_index()
                if removed_pos is not None and removed_pos < idx:
                    self._set_current_index(idx - 1)
                self._renumber()
        await self.broadcast()
        return self.snapshot()

    async def clear(self) -> dict:
        with SessionLocal() as s:
            s.query(QueueItem).delete()
            s.commit()
        self._set_current_index(-1)
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

    # ---- playback -------------------------------------------------------
    async def play_index(self, idx: int) -> dict:
        with SessionLocal() as s:
            items = self._items(s)
            if idx < 0 or idx >= len(items):
                raise ValueError("Index out of range")
            target = items[idx]
            lib = s.query(LibraryItem).filter(LibraryItem.path == target.library_path).first()
            if lib:
                try:
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

    async def advance_after_end(self) -> None:
        """Advance queue when the current file finishes (event + poller)."""
        async with self._advance_lock:
            if self._current_index() < 0:
                return
            now = time.monotonic()
            if now - self._last_advance_at < 2.0:
                return
            self._last_advance_at = now
            await self.next()

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
        await self.advance_after_end()

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
