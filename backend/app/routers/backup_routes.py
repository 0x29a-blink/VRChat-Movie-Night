import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import auth, settings_store
from ..db import get_db
from ..models import (
    LibraryItem,
    Setting,
    User,
    UserRating,
    UserWatchStatus,
    WatchlistComment,
    WatchlistGroup,
    WatchlistItem,
    WheelPreset,
)

router = APIRouter(prefix="/api/backup", tags=["backup"], dependencies=[Depends(auth.require_auth)])

SECRET_SETTING_KEYS = {"torbox_api_key", "tmdb_api_key", "obs_password"}


@router.get("/export")
def export_backup(
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_admin),
):
    users = [
        {
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in db.query(User).order_by(User.id).all()
    ]

    groups = [
        {
            "id": g.id,
            "name": g.name,
            "sort_order": g.sort_order,
            "wheel_enabled": g.wheel_enabled,
        }
        for g in db.query(WatchlistGroup).order_by(WatchlistGroup.sort_order, WatchlistGroup.id).all()
    ]

    items = [
        {
            "id": i.id,
            "group_id": i.group_id,
            "parent_id": i.parent_id,
            "kind": i.kind,
            "tmdb_id": i.tmdb_id,
            "media_type": i.media_type,
            "season": i.season,
            "episode": i.episode,
            "title": i.title,
            "poster": i.poster,
            "year": i.year,
            "overview": i.overview,
            "air_date": i.air_date,
            "library_item_id": i.library_item_id,
            "list_section": i.list_section,
            "sort_order": i.sort_order,
            "created_at": i.created_at.isoformat() if i.created_at else None,
        }
        for i in db.query(WatchlistItem).order_by(WatchlistItem.sort_order, WatchlistItem.id).all()
    ]

    watch_status = [
        {
            "user_id": r.user_id,
            "item_id": r.item_id,
            "watched": r.watched,
            "watched_at": r.watched_at.isoformat() if r.watched_at else None,
        }
        for r in db.query(UserWatchStatus).all()
    ]

    ratings = [
        {"user_id": r.user_id, "item_id": r.item_id, "stars": r.stars}
        for r in db.query(UserRating).all()
    ]

    comments = [
        {
            "id": c.id,
            "user_id": c.user_id,
            "item_id": c.item_id,
            "body": c.body,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in db.query(WatchlistComment).order_by(WatchlistComment.id).all()
    ]

    library = [
        {
            "id": lib.id,
            "path": lib.path,
            "filename": lib.filename,
            "title": lib.title,
            "folder": lib.folder,
            "tmdb_id": lib.tmdb_id,
            "media_type": lib.media_type,
            "season": lib.season,
            "episode": lib.episode,
            "tmdb_title": lib.tmdb_title,
            "tmdb_year": lib.tmdb_year,
        }
        for lib in db.query(LibraryItem).order_by(LibraryItem.id).all()
    ]

    wheel_presets = [
        {
            "id": p.id,
            "name": p.name,
            "labels": json.loads(p.labels_json or "[]"),
            "sort_order": p.sort_order,
        }
        for p in db.query(WheelPreset).order_by(WheelPreset.sort_order, WheelPreset.id).all()
    ]

    settings = {}
    for row in db.query(Setting).all():
        if row.key in SECRET_SETTING_KEYS and row.value:
            settings[row.key] = "[redacted]"
        else:
            settings[row.key] = row.value

    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "version": 1,
        "users": users,
        "watchlist_groups": groups,
        "watchlist_items": items,
        "user_watch_status": watch_status,
        "user_ratings": ratings,
        "watchlist_comments": comments,
        "library_items": library,
        "wheel_presets": wheel_presets,
        "settings": settings,
    }

    body = json.dumps(payload, indent=2, ensure_ascii=False)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="movie-night-backup-{stamp}.json"'},
    )


class ImportBody(BaseModel):
    data: dict


def _parse_dt(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@router.post("/import")
def import_backup(
    body: ImportBody,
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_admin),
):
    payload = body.data
    if payload.get("version") != 1:
        raise HTTPException(400, "Unsupported backup version (expected version 1)")

    backup_users = {u["username"]: u for u in payload.get("users", []) if u.get("username")}
    user_id_map: dict[int, int] = {}
    for u in db.query(User).all():
        old = backup_users.get(u.username)
        if old:
            user_id_map[old["id"]] = u.id

    lib_id_map: dict[int, int] = {}
    for lib in payload.get("library_items", []):
        path = lib.get("path")
        if not path:
            continue
        existing = db.query(LibraryItem).filter(LibraryItem.path == path).first()
        if existing:
            lib_id_map[lib["id"]] = existing.id

    db.query(WatchlistComment).delete(synchronize_session=False)
    db.query(UserRating).delete(synchronize_session=False)
    db.query(UserWatchStatus).delete(synchronize_session=False)
    db.query(WatchlistItem).filter(WatchlistItem.parent_id.isnot(None)).delete(synchronize_session=False)
    db.query(WatchlistItem).filter(WatchlistItem.parent_id.is_(None)).delete(synchronize_session=False)
    db.query(WatchlistGroup).delete(synchronize_session=False)
    db.query(WheelPreset).delete(synchronize_session=False)
    db.flush()

    group_id_map: dict[int, int] = {}
    for g in payload.get("watchlist_groups", []):
        row = WatchlistGroup(
            name=g.get("name") or "Group",
            sort_order=int(g.get("sort_order") or 0),
            wheel_enabled=bool(g.get("wheel_enabled", True)),
        )
        db.add(row)
        db.flush()
        group_id_map[g["id"]] = row.id

    items = payload.get("watchlist_items", [])
    item_id_map: dict[int, int] = {}

    def _create_item(src: dict) -> WatchlistItem:
        old_gid = src.get("group_id")
        old_pid = src.get("parent_id")
        old_lid = src.get("library_item_id")
        row = WatchlistItem(
            group_id=group_id_map.get(old_gid) if old_gid else None,
            parent_id=item_id_map.get(old_pid) if old_pid else None,
            kind=src.get("kind") or "movie",
            tmdb_id=src.get("tmdb_id"),
            media_type=src.get("media_type") or "movie",
            season=src.get("season"),
            episode=src.get("episode"),
            title=src.get("title") or "",
            poster=src.get("poster") or "",
            year=src.get("year") or "",
            overview=src.get("overview") or "",
            air_date=src.get("air_date") or "",
            library_item_id=lib_id_map.get(old_lid) if old_lid else None,
            list_section=src.get("list_section") or "to_watch",
            sort_order=int(src.get("sort_order") or 0),
        )
        created = _parse_dt(src.get("created_at"))
        if created:
            row.created_at = created
        db.add(row)
        db.flush()
        item_id_map[src["id"]] = row.id
        return row

    for src in items:
        if src.get("parent_id") is not None:
            continue
        _create_item(src)

    for src in items:
        if src.get("parent_id") is None:
            continue
        if src.get("parent_id") not in item_id_map:
            continue
        _create_item(src)

    ratings_added = 0
    for r in payload.get("user_ratings", []):
        uid = user_id_map.get(r.get("user_id"))
        iid = item_id_map.get(r.get("item_id"))
        if uid and iid:
            db.add(UserRating(user_id=uid, item_id=iid, stars=float(r.get("stars") or 0)))
            ratings_added += 1

    watch_added = 0
    for w in payload.get("user_watch_status", []):
        uid = user_id_map.get(w.get("user_id"))
        iid = item_id_map.get(w.get("item_id"))
        if uid and iid:
            db.add(
                UserWatchStatus(
                    user_id=uid,
                    item_id=iid,
                    watched=bool(w.get("watched")),
                    watched_at=_parse_dt(w.get("watched_at")),
                )
            )
            watch_added += 1

    comments_added = 0
    for c in payload.get("watchlist_comments", []):
        uid = user_id_map.get(c.get("user_id"))
        iid = item_id_map.get(c.get("item_id"))
        body_text = (c.get("body") or "").strip()
        if uid and iid and body_text:
            row = WatchlistComment(user_id=uid, item_id=iid, body=body_text)
            created = _parse_dt(c.get("created_at"))
            if created:
                row.created_at = created
            db.add(row)
            comments_added += 1

    presets_added = 0
    for p in payload.get("wheel_presets", []):
        labels = p.get("labels") or []
        if not isinstance(labels, list):
            labels = []
        labels = [str(x).strip() for x in labels if str(x).strip()]
        if not labels:
            continue
        db.add(
            WheelPreset(
                name=(p.get("name") or "Preset").strip(),
                labels_json=json.dumps(labels),
                sort_order=int(p.get("sort_order") or 0),
            )
        )
        presets_added += 1

    settings_merged = 0
    for key, value in (payload.get("settings") or {}).items():
        if value == "[redacted]" or value is None or key not in settings_store.EDITABLE:
            continue
        try:
            parsed = json.loads(value) if isinstance(value, str) else value
        except json.JSONDecodeError:
            parsed = value
        settings_store.set_value(key, parsed)
        settings_merged += 1

    db.commit()

    return {
        "ok": True,
        "groups": len(group_id_map),
        "items": len(item_id_map),
        "ratings": ratings_added,
        "watch_status": watch_added,
        "comments": comments_added,
        "wheel_presets": presets_added,
        "settings_merged": settings_merged,
        "users_mapped": len(user_id_map),
    }
