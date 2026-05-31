import asyncio
from typing import Any

from fastapi import WebSocket


class WSHub:
    """Broadcasts JSON events to all connected clients."""

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, event: str, data: Any) -> None:
        message = {"event": event, "data": data}
        dead: list[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)

    def broadcast_threadsafe(self, event: str, data: Any) -> None:
        """Safe to call from non-async threads (e.g. OBS event callbacks)."""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self.broadcast(event, data), self._loop)


hub = WSHub()
