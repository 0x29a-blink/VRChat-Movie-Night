import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy.orm import Session

from .. import auth, settings_store
from ..config import settings as env_settings
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
    WatchlistItemUserExclusion,
    WheelPreset,
)

router = APIRouter(prefix="/api/backup", tags=["backup"], dependencies=[Depends(auth.require_auth)])

SECRET_SETTING_KEYS = {"torbox_api_key", "tmdb_api_key", "obs_password"}


def _build_export_payload(db: Session) -> dict:
    """Build the full backup payload (version 1) from the current DB state.
    Shared by /export and the pre-import snapshot writer — keep in sync with
    BackupPayload and its nested schema models below."""
    users = [
        {
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "watchlist_stats_excluded": bool(u.watchlist_stats_excluded),
            "watchlist_stats_excluded_at": u.watchlist_stats_excluded_at.isoformat()
            if u.watchlist_stats_excluded_at
            else None,
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

    item_user_exclusions = [
        {"item_id": row.item_id, "user_id": row.user_id}
        for row in db.query(WatchlistItemUserExclusion).order_by(WatchlistItemUserExclusion.id).all()
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

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "version": 1,
        "users": users,
        "watchlist_groups": groups,
        "watchlist_items": items,
        "user_watch_status": watch_status,
        "user_ratings": ratings,
        "watchlist_comments": comments,
        "watchlist_item_user_exclusions": item_user_exclusions,
        "library_items": library,
        "wheel_presets": wheel_presets,
        "settings": settings,
    }


@router.get("/export")
def export_backup(
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_admin),
):
    payload = _build_export_payload(db)
    body = json.dumps(payload, indent=2, ensure_ascii=False)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="movie-night-backup-{stamp}.json"'},
    )


class _Lenient(BaseModel):
    """Base for backup schema models: ignore unknown fields (forward-compat)."""

    model_config = ConfigDict(extra="ignore")


class BackupUser(_Lenient):
    id: int
    username: str
    role: str = "member"
    watchlist_stats_excluded: bool = False
    watchlist_stats_excluded_at: str | None = None
    created_at: str | None = None


class BackupGroup(_Lenient):
    id: int
    name: str = "Group"
    sort_order: int = 0
    wheel_enabled: bool = True


class BackupItem(_Lenient):
    id: int
    group_id: int | None = None
    parent_id: int | None = None
    kind: str = "movie"
    tmdb_id: int | None = None
    media_type: str = "movie"
    season: int | None = None
    episode: int | None = None
    title: str = ""
    poster: str = ""
    year: str = ""
    overview: str = ""
    air_date: str = ""
    library_item_id: int | None = None
    list_section: str = "to_watch"
    sort_order: int = 0
    created_at: str | None = None


class BackupWatchStatus(_Lenient):
    user_id: int | None = None
    item_id: int | None = None
    watched: bool = False
    watched_at: str | None = None


class BackupRating(_Lenient):
    user_id: int | None = None
    item_id: int | None = None
    stars: float = 0


class BackupComment(_Lenient):
    id: int | None = None
    user_id: int | None = None
    item_id: int | None = None
    body: str = ""
    created_at: str | None = None


class BackupExclusion(_Lenient):
    item_id: int | None = None
    user_id: int | None = None


class BackupLibraryItem(_Lenient):
    id: int
    path: str
    filename: str = ""
    title: str = ""
    folder: str = ""
    tmdb_id: int | None = None
    media_type: str = ""
    season: int | None = None
    episode: int | None = None
    tmdb_title: str = ""
    tmdb_year: str = ""


class BackupWheelPreset(_Lenient):
    id: int | None = None
    name: str = "Preset"
    labels: list[str] = []
    sort_order: int = 0


class BackupPayload(_Lenient):
    exported_at: str | None = None
    version: int
    users: list[BackupUser] = []
    watchlist_groups: list[BackupGroup] = []
    watchlist_items: list[BackupItem] = []
    user_watch_status: list[BackupWatchStatus] = []
    user_ratings: list[BackupRating] = []
    watchlist_comments: list[BackupComment] = []
    watchlist_item_user_exclusions: list[BackupExclusion] = []
    library_items: list[BackupLibraryItem] = []
    wheel_presets: list[BackupWheelPreset] = []
    settings: dict = {}


class ImportBody(BaseModel):
    data: dict


def _parse_dt(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _validate_payload(data: dict) -> BackupPayload:
    try:
        return BackupPayload.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(422, {"message": "Invalid backup payload", "errors": exc.errors()}) from exc


def _match_users(payload: BackupPayload, db: Session) -> tuple[dict[int, int], list[str]]:
    """Map backup user ids -> current DB user ids by username; report unmatched usernames."""
    backup_users = {u.username: u for u in payload.users if u.username}
    user_id_map: dict[int, int] = {}
    matched_usernames: set[str] = set()
    for u in db.query(User).all():
        old = backup_users.get(u.username)
        if old:
            user_id_map[old.id] = u.id
            matched_usernames.add(u.username)
    unmatched = sorted(set(backup_users.keys()) - matched_usernames)
    return user_id_map, unmatched


def _match_library(payload: BackupPayload, db: Session) -> dict[int, int]:
    """Map backup library_item ids -> current DB library_item ids by path (only resolvable ones)."""
    lib_id_map: dict[int, int] = {}
    for lib in payload.library_items:
        if not lib.path:
            continue
        existing = db.query(LibraryItem).filter(LibraryItem.path == lib.path).first()
        if existing:
            lib_id_map[lib.id] = existing.id
    return lib_id_map


@router.post("/import-preview")
def import_preview(
    body: ImportBody,
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_admin),
):
    payload = _validate_payload(body.data)
    if payload.version != 1:
        raise HTTPException(400, "Unsupported backup version (expected version 1)")

    user_id_map, unmatched_users = _match_users(payload, db)
    lib_id_map = _match_library(payload, db)

    return {
        "ok": True,
        "exported_at": payload.exported_at,
        "users_matched": len(user_id_map),
        "users_unmatched": unmatched_users,
        "groups": len(payload.watchlist_groups),
        "items": len(payload.watchlist_items),
        "ratings": len(payload.user_ratings),
        "watch_status": len(payload.user_watch_status),
        "comments": len(payload.watchlist_comments),
        "watchlist_item_user_exclusions": len(payload.watchlist_item_user_exclusions),
        "wheel_presets": len(payload.wheel_presets),
        "library_items_total": len(payload.library_items),
        "library_links_resolvable": len(lib_id_map),
        "settings_keys": len(payload.settings),
    }


def _write_pre_import_snapshot(db: Session) -> str:
    """Serialize the CURRENT DB state (same shape as /export) to a timestamped
    file under the backups dir, before any import mutation. Returns filename."""
    snapshot = _build_export_payload(db)
    backups_dir = env_settings.data_path / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"pre-import-{stamp}.json"
    (backups_dir / filename).write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return filename


@router.post("/import")
def import_backup(
    body: ImportBody,
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_admin),
):
    payload = _validate_payload(body.data)
    if payload.version != 1:
        raise HTTPException(400, "Unsupported backup version (expected version 1)")

    # Snapshot BEFORE any mutation: the user loop below mutates User rows in
    # this same session, and the snapshot serializes live session objects.
    snapshot_file = _write_pre_import_snapshot(db)

    user_id_map, _unmatched_users = _match_users(payload, db)
    for u in db.query(User).all():
        old = next((bu for bu in payload.users if bu.username == u.username), None)
        if old:
            u.watchlist_stats_excluded = bool(old.watchlist_stats_excluded)
            if old.watchlist_stats_excluded_at:
                u.watchlist_stats_excluded_at = _parse_dt(old.watchlist_stats_excluded_at)
            elif not old.watchlist_stats_excluded:
                u.watchlist_stats_excluded_at = None

    lib_id_map = _match_library(payload, db)

    db.query(WatchlistComment).delete(synchronize_session=False)
    db.query(UserRating).delete(synchronize_session=False)
    db.query(UserWatchStatus).delete(synchronize_session=False)
    db.query(WatchlistItemUserExclusion).delete(synchronize_session=False)
    db.query(WatchlistItem).filter(WatchlistItem.parent_id.isnot(None)).delete(synchronize_session=False)
    db.query(WatchlistItem).filter(WatchlistItem.parent_id.is_(None)).delete(synchronize_session=False)
    db.query(WatchlistGroup).delete(synchronize_session=False)
    db.query(WheelPreset).delete(synchronize_session=False)
    db.flush()
    db.expunge_all()

    group_id_map: dict[int, int] = {}
    for g in payload.watchlist_groups:
        row = WatchlistGroup(
            name=g.name or "Group",
            sort_order=int(g.sort_order or 0),
            wheel_enabled=bool(g.wheel_enabled),
        )
        db.add(row)
        db.flush()
        group_id_map[g.id] = row.id

    items = payload.watchlist_items
    item_id_map: dict[int, int] = {}

    def _create_item(src: BackupItem) -> WatchlistItem:
        old_gid = src.group_id
        old_pid = src.parent_id
        old_lid = src.library_item_id
        row = WatchlistItem(
            group_id=group_id_map.get(old_gid) if old_gid else None,
            parent_id=item_id_map.get(old_pid) if old_pid else None,
            kind=src.kind or "movie",
            tmdb_id=src.tmdb_id,
            media_type=src.media_type or "movie",
            season=src.season,
            episode=src.episode,
            title=src.title or "",
            poster=src.poster or "",
            year=src.year or "",
            overview=src.overview or "",
            air_date=src.air_date or "",
            library_item_id=lib_id_map.get(old_lid) if old_lid else None,
            list_section=src.list_section or "to_watch",
            sort_order=int(src.sort_order or 0),
        )
        created = _parse_dt(src.created_at)
        if created:
            row.created_at = created
        db.add(row)
        db.flush()
        item_id_map[src.id] = row.id
        return row

    for src in items:
        if src.parent_id is not None:
            continue
        _create_item(src)

    for src in items:
        if src.parent_id is None:
            continue
        if src.parent_id not in item_id_map:
            continue
        _create_item(src)

    ratings_added = 0
    for r in payload.user_ratings:
        uid = user_id_map.get(r.user_id)
        iid = item_id_map.get(r.item_id)
        if uid and iid:
            db.add(UserRating(user_id=uid, item_id=iid, stars=float(r.stars or 0)))
            ratings_added += 1

    watch_added = 0
    for w in payload.user_watch_status:
        uid = user_id_map.get(w.user_id)
        iid = item_id_map.get(w.item_id)
        if uid and iid:
            db.add(
                UserWatchStatus(
                    user_id=uid,
                    item_id=iid,
                    watched=bool(w.watched),
                    watched_at=_parse_dt(w.watched_at),
                )
            )
            watch_added += 1

    comments_added = 0
    for c in payload.watchlist_comments:
        uid = user_id_map.get(c.user_id)
        iid = item_id_map.get(c.item_id)
        body_text = (c.body or "").strip()
        if uid and iid and body_text:
            row = WatchlistComment(user_id=uid, item_id=iid, body=body_text)
            created = _parse_dt(c.created_at)
            if created:
                row.created_at = created
            db.add(row)
            comments_added += 1

    exclusions_added = 0
    for ex in payload.watchlist_item_user_exclusions:
        uid = user_id_map.get(ex.user_id)
        iid = item_id_map.get(ex.item_id)
        if uid and iid:
            db.add(WatchlistItemUserExclusion(item_id=iid, user_id=uid))
            exclusions_added += 1

    presets_added = 0
    for p in payload.wheel_presets:
        labels = p.labels or []
        if not isinstance(labels, list):
            labels = []
        labels = [str(x).strip() for x in labels if str(x).strip()]
        if not labels:
            continue
        db.add(
            WheelPreset(
                name=(p.name or "Preset").strip(),
                labels_json=json.dumps(labels),
                sort_order=int(p.sort_order or 0),
            )
        )
        presets_added += 1

    settings_merged = 0
    for key, value in (payload.settings or {}).items():
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
        "watchlist_item_user_exclusions": exclusions_added,
        "wheel_presets": presets_added,
        "settings_merged": settings_merged,
        "users_mapped": len(user_id_map),
        "pre_import_snapshot": snapshot_file,
    }
