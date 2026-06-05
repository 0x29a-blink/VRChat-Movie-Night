"""Helpers for AIOStreams playback URLs (credentials are embedded in the path, not ?token=)."""

from __future__ import annotations


def playback_requires_token(url: str) -> bool:
    """True when URL is an AIOStreams playback/debrid route (for logging only)."""
    u = (url or "").lower()
    return "/playback/" in u or "/debrid/playback" in u or "/api/v1/debrid/" in u


def prepare_aiostreams_request_url(url: str) -> str:
    """Return the URL unchanged — AIOStreams debrid playback does not use a separate API key."""
    return url
