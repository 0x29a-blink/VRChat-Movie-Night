"""Normalize upstream API validation errors for clients."""

from __future__ import annotations

from typing import Any


def format_api_detail(detail: Any) -> str:
    if detail is None:
        return ""
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        parts: list[str] = []
        for item in detail:
            if isinstance(item, dict):
                loc = ".".join(str(x) for x in item.get("loc", []) if x is not None)
                msg = item.get("msg") or item.get("message") or ""
                parts.append(f"{loc}: {msg}" if loc else str(msg))
            else:
                parts.append(str(item))
        return "; ".join(p for p in parts if p)
    if isinstance(detail, dict):
        return detail.get("message") or detail.get("msg") or str(detail)
    return str(detail)
