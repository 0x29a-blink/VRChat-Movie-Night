import json
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..library.matching import find_library_for_watchlist_item
from ..search import tmdb
from ..models import (
    LibraryItem,
    User,
    UserRating,
    UserWatchStatus,
    WatchlistComment,
    WatchlistGroup,
    WatchlistItem,
    WheelPreset,
)

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"], dependencies=[Depends(auth.require_auth)])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _find_library_match(db: Session, item: WatchlistItem) -> dict | None:
    return find_library_for_watchlist_item(db, item)


def _item_base(item: WatchlistItem) -> dict:
    return {
        "id": item.id,
        "group_id": item.group_id,
        "parent_id": item.parent_id,
        "kind": item.kind,
        "tmdb_id": item.tmdb_id,
        "media_type": item.media_type,
        "season": item.season,
        "episode": item.episode,
        "title": item.title,
        "poster": item.poster,
        "year": item.year,
        "overview": item.overview or "",
        "air_date": item.air_date or "",
        "library_item_id": item.library_item_id,
        "list_section": item.list_section,
        "sort_order": item.sort_order,
    }


def _build_user_watch(
    db: Session,
    item_id: int,
    all_users: list[User],
    children: list[dict] | None = None,
) -> list[dict]:
    watched_map = {
        row.user_id: bool(row.watched)
        for row in db.query(UserWatchStatus).filter(UserWatchStatus.item_id == item_id).all()
    }
    result: list[dict] = []
    for u in all_users:
        direct = watched_map.get(u.id, False)
        entry: dict = {
            "user_id": u.id,
            "username": u.username,
            "watched": direct,
        }
        if children:
            total = len(children)
            ep_watched = sum(
                1
                for child in children
                if any(
                    uw.get("user_id") == u.id and uw.get("watched")
                    for uw in child.get("user_watch", [])
                )
            )
            entry["episodes_watched"] = ep_watched
            entry["episodes_total"] = total
            if not direct and total > 0 and ep_watched >= total:
                entry["watched"] = True
        result.append(entry)
    return result


def _enrich_item(
    db: Session,
    item: WatchlistItem,
    user_id: int,
    all_users: list[User],
    children: list[dict] | None = None,
) -> dict:
    out = _item_base(item)
    status = (
        db.query(UserWatchStatus)
        .filter(UserWatchStatus.user_id == user_id, UserWatchStatus.item_id == item.id)
        .first()
    )
    rating = (
        db.query(UserRating)
        .filter(UserRating.user_id == user_id, UserRating.item_id == item.id)
        .first()
    )
    out["my_watched"] = bool(status and status.watched)
    out["my_rating"] = rating.stars if rating else None

    out["user_watch"] = _build_user_watch(db, item.id, all_users, children)
    out["watched_by"] = [u for u in out["user_watch"] if u["watched"]]
    out["everyone_watched"] = len(all_users) > 0 and all(u["watched"] for u in out["user_watch"])

    ratings = (
        db.query(UserRating, User)
        .join(User, User.id == UserRating.user_id)
        .filter(UserRating.item_id == item.id)
        .all()
    )
    out["ratings"] = [
        {"user_id": u.id, "username": u.username, "stars": r.stars} for r, u in ratings
    ]
    out["comment_count"] = (
        db.query(func.count(WatchlistComment.id))
        .filter(WatchlistComment.item_id == item.id)
        .scalar()
        or 0
    )
    out["library_match"] = _find_library_match(db, item)

    if children is not None:
        out["children"] = children
        watched_eps = sum(1 for c in children if c.get("my_watched"))
        if children and watched_eps >= len(children):
            out["my_watched"] = True
        out["my_episode_progress"] = f"{watched_eps}/{len(children)}" if children else None
        group_watched = sum(1 for u in out["user_watch"] if u["watched"])
        out["group_watch_progress"] = f"{group_watched}/{len(all_users)}" if all_users else None
        ep_any = sum(
            1
            for c in children
            if any(uw.get("watched") for uw in c.get("user_watch", []))
        )
        out["group_episode_progress"] = f"{ep_any}/{len(children)}" if children else None

    return out


def _upsert_user_watched(db: Session, user_id: int, item_id: int, watched: bool) -> None:
    row = (
        db.query(UserWatchStatus)
        .filter(UserWatchStatus.user_id == user_id, UserWatchStatus.item_id == item_id)
        .first()
    )
    if not row:
        row = UserWatchStatus(user_id=user_id, item_id=item_id)
        db.add(row)
    row.watched = watched
    row.watched_at = _now() if watched else None


def _user_root_watched(
    db: Session,
    user_id: int,
    item: WatchlistItem,
    children: list[WatchlistItem] | None = None,
) -> bool:
    """Whether this user has finished the title (movie, series, or all tracked episodes)."""
    if item.kind == "series":
        if _user_watched_item(db, user_id, item.id):
            return True
        eps = children if children is not None else _series_children(db, item.id)
        if eps:
            return all(_user_watched_item(db, user_id, c.id) for c in eps)
        return False
    return _user_watched_item(db, user_id, item.id)


def _children_by_parent(db: Session, series_ids: list[int]) -> dict[int, list[WatchlistItem]]:
    by_parent: dict[int, list[WatchlistItem]] = {}
    for c in _series_children_batch(db, series_ids):
        by_parent.setdefault(c.parent_id, []).append(c)
    return by_parent


def _counts_for_roots(
    db: Session,
    user_id: int,
    roots: list[WatchlistItem],
    by_parent: dict[int, list[WatchlistItem]],
) -> dict[str, int]:
    counts = {"to_watch": 0, "watched": 0}
    for item in roots:
        children = by_parent.get(item.id, []) if item.kind == "series" else []
        if _user_root_watched(db, user_id, item, children):
            counts["watched"] += 1
        else:
            counts["to_watch"] += 1
    return counts


def _group_counts(db: Session, group_id: int | None, user_id: int) -> dict[str, int]:
    q = db.query(WatchlistItem).filter(WatchlistItem.parent_id.is_(None))
    if group_id is None:
        q = q.filter(WatchlistItem.group_id.is_(None))
    else:
        q = q.filter(WatchlistItem.group_id == group_id)
    roots = q.order_by(WatchlistItem.sort_order, WatchlistItem.id).all()
    series_ids = [i.id for i in roots if i.kind == "series"]
    by_parent = _children_by_parent(db, series_ids)
    return _counts_for_roots(db, user_id, roots, by_parent)


def _series_children(db: Session, series_id: int) -> list[WatchlistItem]:
    return (
        db.query(WatchlistItem)
        .filter(WatchlistItem.parent_id == series_id)
        .order_by(WatchlistItem.season, WatchlistItem.episode, WatchlistItem.sort_order)
        .all()
    )


def _series_children_batch(db: Session, series_ids: list[int]) -> list[WatchlistItem]:
    if not series_ids:
        return []
    return (
        db.query(WatchlistItem)
        .filter(WatchlistItem.parent_id.in_(series_ids))
        .order_by(WatchlistItem.season, WatchlistItem.episode, WatchlistItem.sort_order)
        .all()
    )


def _user_watched_item(db: Session, user_id: int, item_id: int) -> bool:
    row = (
        db.query(UserWatchStatus)
        .filter(UserWatchStatus.user_id == user_id, UserWatchStatus.item_id == item_id)
        .first()
    )
    return bool(row and row.watched)


def _sync_series_from_episodes(db: Session, series_id: int) -> None:
    parent = db.get(WatchlistItem, series_id)
    if not parent or parent.kind != "series":
        return
    children = _series_children(db, series_id)
    if not children:
        return

    all_users = db.query(User).all()
    for u in all_users:
        all_eps = all(_user_watched_item(db, u.id, c.id) for c in children)
        _upsert_user_watched(db, u.id, series_id, all_eps)

    if all_users and all(
        all(_user_watched_item(db, u.id, c.id) for c in children) for u in all_users
    ):
        pass  # per-user tabs: do not move shared list_section


def _item_ids_for_section_sync(db: Session, item: WatchlistItem) -> list[int]:
    ids = [item.id]
    if item.kind == "series":
        ids.extend(r.id for r in _series_children(db, item.id))
    return ids


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class GroupPatch(BaseModel):
    name: str | None = None
    sort_order: int | None = None
    wheel_enabled: bool | None = None


class ItemCreate(BaseModel):
    kind: str = Field(pattern="^(movie|series|episode)$")
    tmdb_id: int | None = None
    media_type: str = "movie"
    season: int | None = None
    episode: int | None = None
    title: str = ""
    poster: str = ""
    year: str = ""
    overview: str = ""
    air_date: str = ""
    group_id: int | None = None
    parent_id: int | None = None
    library_item_id: int | None = None
    list_section: str = "to_watch"


class EpisodeBulk(BaseModel):
    episodes: list[dict]


class ItemPatch(BaseModel):
    group_id: int | None = None
    parent_id: int | None = None
    list_section: str | None = None
    sort_order: int | None = None
    title: str | None = None


class ReorderEntry(BaseModel):
    id: int
    sort_order: int
    parent_id: int | None = None
    group_id: int | None = None


class ReorderBody(BaseModel):
    items: list[ReorderEntry]


class WatchedBody(BaseModel):
    watched: bool


class RatingBody(BaseModel):
    stars: float = Field(ge=0, le=5)

    @field_validator("stars")
    @classmethod
    def half_star_steps(cls, v: float) -> float:
        if v == 0:
            return 0.0
        doubled = round(v * 2)
        if abs(v * 2 - doubled) > 1e-9 or doubled > 10:
            raise ValueError("stars must be in half-star increments from 0 to 5")
        return doubled / 2


class SectionBody(BaseModel):
    list_section: str = Field(pattern="^(to_watch|watched)$")


class CommentBody(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class WheelSpinBody(BaseModel):
    include_watched_by_me: bool = True
    include_unwatched_by_me: bool = True
    item_ids: list[int] | None = None


class CustomWheelBody(BaseModel):
    labels: list[str] = Field(min_length=1)


class WheelPresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    labels: list[str] = Field(min_length=1)


@router.get("/groups")
def list_groups(
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    groups = db.query(WatchlistGroup).order_by(WatchlistGroup.sort_order, WatchlistGroup.id).all()
    ungrouped = _group_counts(db, None, user.id)
    return {
        "groups": [
            {**g.to_dict(), "counts": _group_counts(db, g.id, user.id)} for g in groups
        ],
        "ungrouped_counts": ungrouped,
    }


@router.post("/groups")
def create_group(body: GroupCreate, db: Session = Depends(get_db)):
    max_order = db.query(func.max(WatchlistGroup.sort_order)).scalar() or 0
    g = WatchlistGroup(name=body.name.strip(), sort_order=max_order + 1)
    db.add(g)
    db.commit()
    db.refresh(g)
    return {**g.to_dict(), "counts": {"to_watch": 0, "watched": 0}}


@router.patch("/groups/{group_id}")
def patch_group(
    group_id: int,
    body: GroupPatch,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    g = db.get(WatchlistGroup, group_id)
    if not g:
        raise HTTPException(404, "Group not found")
    if body.name is not None:
        g.name = body.name.strip()
    if body.sort_order is not None:
        g.sort_order = body.sort_order
    if body.wheel_enabled is not None:
        g.wheel_enabled = body.wheel_enabled
    db.commit()
    return {**g.to_dict(), "counts": _group_counts(db, g.id, user.id)}


@router.delete("/groups/{group_id}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_admin),
):
    g = db.get(WatchlistGroup, group_id)
    if not g:
        raise HTTPException(404, "Group not found")
    db.query(WatchlistItem).filter(WatchlistItem.group_id == group_id).update(
        {WatchlistItem.group_id: None}
    )
    db.delete(g)
    db.commit()
    return {"ok": True}


@router.get("/groups/{group_id}/items")
def group_items(
    group_id: int,
    section: str | None = Query(None),
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    if group_id == 0:
        q = db.query(WatchlistItem).filter(WatchlistItem.group_id.is_(None))
    else:
        g = db.get(WatchlistGroup, group_id)
        if not g:
            raise HTTPException(404, "Group not found")
        q = db.query(WatchlistItem).filter(WatchlistItem.group_id == group_id)

    all_roots = (
        q.filter(WatchlistItem.parent_id.is_(None))
        .order_by(WatchlistItem.sort_order, WatchlistItem.id)
        .all()
    )
    series_ids = [i.id for i in all_roots if i.kind == "series"]
    by_parent = _children_by_parent(db, series_ids)
    counts = _counts_for_roots(db, user.id, all_roots, by_parent)

    if section:
        if section not in ("to_watch", "watched"):
            raise HTTPException(400, "section must be to_watch or watched")
        want_watched = section == "watched"
        items = [
            i
            for i in all_roots
            if _user_root_watched(db, user.id, i, by_parent.get(i.id, [])) == want_watched
        ]
    else:
        items = all_roots

    all_users = db.query(User).all()
    roots = items

    result = []
    for root in roots:
        children_raw = by_parent.get(root.id, [])
        children = [_enrich_item(db, c, user.id, all_users) for c in children_raw]
        result.append(_enrich_item(db, root, user.id, all_users, children if root.kind == "series" else None))

    return {"items": result, "counts": counts}


@router.get("/items/ungrouped")
def ungrouped_items(
    section: str | None = Query(None),
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    return group_items(0, section, db, user)


def _next_sort(db: Session, group_id: int | None, parent_id: int | None, section: str) -> int:
    q = db.query(func.max(WatchlistItem.sort_order)).filter(
        WatchlistItem.list_section == section,
        WatchlistItem.parent_id == parent_id if parent_id else WatchlistItem.parent_id.is_(None),
    )
    if group_id is None:
        q = q.filter(WatchlistItem.group_id.is_(None))
    else:
        q = q.filter(WatchlistItem.group_id == group_id)
    return (q.scalar() or 0) + 1


def _find_series(db: Session, tmdb_id: int, group_id: int | None) -> WatchlistItem | None:
    q = db.query(WatchlistItem).filter(
        WatchlistItem.kind == "series",
        WatchlistItem.tmdb_id == tmdb_id,
        WatchlistItem.parent_id.is_(None),
    )
    if group_id is None:
        q = q.filter(WatchlistItem.group_id.is_(None))
    else:
        q = q.filter(WatchlistItem.group_id == group_id)
    return q.first()


def _insert_episodes(db: Session, parent: WatchlistItem, episodes: list[dict]) -> list[WatchlistItem]:
    created: list[WatchlistItem] = []
    for ep in episodes:
        season = ep.get("season")
        episode = ep.get("episode")
        if season is None or episode is None:
            continue
        title = ep.get("title") or f"S{season}E{episode}"
        existing = (
            db.query(WatchlistItem)
            .filter(
                WatchlistItem.parent_id == parent.id,
                WatchlistItem.season == season,
                WatchlistItem.episode == episode,
            )
            .first()
        )
        if existing:
            continue
        sort = _next_sort(db, parent.group_id, parent.id, parent.list_section)
        item = WatchlistItem(
            group_id=parent.group_id,
            parent_id=parent.id,
            kind="episode",
            tmdb_id=parent.tmdb_id,
            media_type="series",
            season=season,
            episode=episode,
            title=title,
            poster=ep.get("still") or parent.poster,
            year=parent.year,
            overview=ep.get("overview") or "",
            air_date=ep.get("air_date") or "",
            list_section=parent.list_section,
            sort_order=sort,
        )
        db.add(item)
        created.append(item)
    return created


async def _sync_series_episodes_from_tmdb(db: Session, parent: WatchlistItem) -> list[WatchlistItem]:
    if not parent.tmdb_id:
        return []
    try:
        if not parent.overview:
            info = await tmdb.details(parent.tmdb_id, "series")
            parent.overview = info.get("overview") or ""
        episodes = await tmdb.all_episodes(parent.tmdb_id)
    except Exception:
        return []
    return _insert_episodes(db, parent, episodes)


def _series_response(db: Session, series: WatchlistItem, user_id: int) -> dict:
    all_users = db.query(User).all()
    children = [_enrich_item(db, c, user_id, all_users) for c in _series_children(db, series.id)]
    return _enrich_item(db, series, user_id, all_users, children)


@router.post("/items")
async def create_item(
    body: ItemCreate,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    if body.group_id is not None and not db.get(WatchlistGroup, body.group_id):
        raise HTTPException(400, "Invalid group_id")
    if body.parent_id is not None:
        parent = db.get(WatchlistItem, body.parent_id)
        if not parent or parent.kind != "series":
            raise HTTPException(400, "parent_id must reference a series item")

    parent_id = body.parent_id
    group_id = body.group_id
    list_section = body.list_section

    if body.kind == "series" and body.tmdb_id:
        existing = _find_series(db, body.tmdb_id, group_id)
        if existing:
            await _sync_series_episodes_from_tmdb(db, existing)
            db.commit()
            return _series_response(db, existing, user.id)

    if body.kind == "episode" and not parent_id and body.tmdb_id:
        parent = (
            db.query(WatchlistItem)
            .filter(
                WatchlistItem.kind == "series",
                WatchlistItem.tmdb_id == body.tmdb_id,
                WatchlistItem.parent_id.is_(None),
            )
            .first()
        )
        if not parent:
            parent = WatchlistItem(
                group_id=group_id,
                kind="series",
                tmdb_id=body.tmdb_id,
                media_type="series",
                title=body.title.split(" S")[0] if body.title else "",
                poster=body.poster,
                year=body.year,
                list_section=list_section,
                sort_order=_next_sort(db, group_id, None, list_section),
            )
            db.add(parent)
            db.flush()
        parent_id = parent.id
        if group_id is None:
            group_id = parent.group_id
        list_section = parent.list_section

    if body.kind == "episode" and parent_id:
        existing = (
            db.query(WatchlistItem)
            .filter(
                WatchlistItem.parent_id == parent_id,
                WatchlistItem.season == body.season,
                WatchlistItem.episode == body.episode,
            )
            .first()
        )
        if existing:
            all_users = db.query(User).all()
            return _enrich_item(db, existing, user.id, all_users)

    sort = _next_sort(db, group_id, parent_id, list_section)
    overview = body.overview
    air_date = body.air_date
    if body.kind == "movie" and body.tmdb_id and not overview:
        try:
            info = await tmdb.details(body.tmdb_id, "movie")
            overview = info.get("overview") or ""
        except Exception:
            overview = overview or ""

    item = WatchlistItem(
        group_id=group_id,
        parent_id=parent_id,
        kind=body.kind,
        tmdb_id=body.tmdb_id,
        media_type=body.media_type,
        season=body.season,
        episode=body.episode,
        title=body.title,
        poster=body.poster,
        year=body.year,
        overview=overview,
        air_date=air_date,
        library_item_id=body.library_item_id,
        list_section=list_section,
        sort_order=sort,
    )
    db.add(item)
    db.flush()

    if item.kind == "series" and item.tmdb_id:
        await _sync_series_episodes_from_tmdb(db, item)

    db.commit()
    db.refresh(item)
    if item.kind == "series":
        return _series_response(db, item, user.id)
    all_users = db.query(User).all()
    return _enrich_item(db, item, user.id, all_users)


@router.post("/items/{series_id}/episodes")
def add_episodes(
    series_id: int,
    body: EpisodeBulk,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    parent = db.get(WatchlistItem, series_id)
    if not parent or parent.kind != "series":
        raise HTTPException(400, "Not a series item")
    created = _insert_episodes(db, parent, body.episodes)
    db.commit()
    all_users = db.query(User).all()
    return {
        "created": [
            _enrich_item(db, i, user.id, all_users) for i in created
        ]
    }


@router.patch("/items/{item_id}")
def patch_item(
    item_id: int,
    body: ItemPatch,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    item = db.get(WatchlistItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    if body.group_id is not None:
        if body.group_id != 0 and not db.get(WatchlistGroup, body.group_id):
            raise HTTPException(400, "Invalid group_id")
        item.group_id = None if body.group_id == 0 else body.group_id
    if body.parent_id is not None:
        if body.parent_id == 0:
            item.parent_id = None
        else:
            parent = db.get(WatchlistItem, body.parent_id)
            if not parent or parent.kind != "series":
                raise HTTPException(400, "Invalid parent_id")
            item.parent_id = body.parent_id
    if body.list_section is not None:
        item.list_section = body.list_section
    if body.sort_order is not None:
        item.sort_order = body.sort_order
    if body.title is not None:
        item.title = body.title
    db.commit()
    all_users = db.query(User).all()
    return _enrich_item(db, item, user.id, all_users)


@router.post("/items/reorder")
def reorder_items(body: ReorderBody, db: Session = Depends(get_db)):
    for entry in body.items:
        item = db.get(WatchlistItem, entry.id)
        if not item:
            continue
        item.sort_order = entry.sort_order
        if entry.parent_id is not None:
            item.parent_id = None if entry.parent_id == 0 else entry.parent_id
        if entry.group_id is not None:
            item.group_id = None if entry.group_id == 0 else entry.group_id
    db.commit()
    return {"ok": True}


@router.delete("/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = db.get(WatchlistItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    child_ids = [c.id for c in db.query(WatchlistItem).filter(WatchlistItem.parent_id == item_id).all()]
    for cid in child_ids + [item_id]:
        db.query(UserWatchStatus).filter(UserWatchStatus.item_id == cid).delete()
        db.query(UserRating).filter(UserRating.item_id == cid).delete()
        db.query(WatchlistComment).filter(WatchlistComment.item_id == cid).delete()
    db.query(WatchlistItem).filter(WatchlistItem.parent_id == item_id).delete()
    db.delete(item)
    db.commit()
    return {"ok": True}


@router.post("/items/{item_id}/section")
def set_section(
    item_id: int,
    body: SectionBody,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    item = db.get(WatchlistItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    watched = body.list_section == "watched"
    for iid in _item_ids_for_section_sync(db, item):
        _upsert_user_watched(db, user.id, iid, watched)

    db.commit()
    all_users = db.query(User).all()
    return _enrich_item(db, item, user.id, all_users)


@router.put("/items/{item_id}/watched")
def set_watched(
    item_id: int,
    body: WatchedBody,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    item = db.get(WatchlistItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    _upsert_user_watched(db, user.id, item_id, body.watched)
    if item.kind == "series":
        for child in _series_children(db, item.id):
            _upsert_user_watched(db, user.id, child.id, body.watched)
    elif item.parent_id:
        _sync_series_from_episodes(db, item.parent_id)
    db.commit()
    all_users = db.query(User).all()
    return _enrich_item(db, item, user.id, all_users)


@router.put("/items/{item_id}/rating")
def set_rating(
    item_id: int,
    body: RatingBody,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    item = db.get(WatchlistItem, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    row = (
        db.query(UserRating)
        .filter(UserRating.user_id == user.id, UserRating.item_id == item_id)
        .first()
    )
    if body.stars == 0:
        if row:
            db.delete(row)
        db.commit()
        all_users = db.query(User).all()
        return _enrich_item(db, item, user.id, all_users)
    if not row:
        row = UserRating(user_id=user.id, item_id=item_id)
        db.add(row)
    row.stars = body.stars
    db.commit()
    all_users = db.query(User).all()
    return _enrich_item(db, item, user.id, all_users)


@router.get("/items/{item_id}/comments")
def list_comments(item_id: int, db: Session = Depends(get_db)):
    if not db.get(WatchlistItem, item_id):
        raise HTTPException(404, "Item not found")
    rows = (
        db.query(WatchlistComment, User)
        .join(User, User.id == WatchlistComment.user_id)
        .filter(WatchlistComment.item_id == item_id)
        .order_by(WatchlistComment.created_at.desc())
        .all()
    )
    return {
        "comments": [
            {
                "id": c.id,
                "body": c.body,
                "created_at": c.created_at.isoformat(),
                "user_id": u.id,
                "username": u.username,
            }
            for c, u in rows
        ]
    }


@router.post("/items/{item_id}/comments")
def add_comment(
    item_id: int,
    body: CommentBody,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    if not db.get(WatchlistItem, item_id):
        raise HTTPException(404, "Item not found")
    c = WatchlistComment(user_id=user.id, item_id=item_id, body=body.body.strip())
    db.add(c)
    db.commit()
    db.refresh(c)
    return {
        "id": c.id,
        "body": c.body,
        "created_at": c.created_at.isoformat(),
        "user_id": user.id,
        "username": user.username,
    }


@router.post("/groups/{group_id}/wheel")
def wheel_spin(
    group_id: int,
    body: WheelSpinBody = WheelSpinBody(),
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    if not body.include_watched_by_me and not body.include_unwatched_by_me:
        raise HTTPException(400, "Include at least one of watched or unwatched titles")

    if group_id == 0:
        q = db.query(WatchlistItem).filter(
            WatchlistItem.group_id.is_(None),
            WatchlistItem.parent_id.is_(None),
        )
    else:
        g = db.get(WatchlistGroup, group_id)
        if not g:
            raise HTTPException(404, "Group not found")
        if not g.wheel_enabled:
            raise HTTPException(400, "Wheel is disabled for this group")
        q = db.query(WatchlistItem).filter(
            WatchlistItem.group_id == group_id,
            WatchlistItem.parent_id.is_(None),
        )

    candidates = q.all()
    if body.item_ids:
        allowed = set(body.item_ids)
        candidates = [c for c in candidates if c.id in allowed]

    filtered: list[WatchlistItem] = []
    series_ids = [c.id for c in candidates if c.kind == "series"]
    by_parent = _children_by_parent(db, series_ids)
    for c in candidates:
        watched = _user_root_watched(db, user.id, c, by_parent.get(c.id, []))
        if watched and not body.include_watched_by_me:
            continue
        if not watched and not body.include_unwatched_by_me:
            continue
        filtered.append(c)
    candidates = filtered

    if not candidates:
        raise HTTPException(404, "No items available to spin")

    pick = random.choice(candidates)
    all_users = db.query(User).all()
    winner_index = next(i for i, c in enumerate(candidates) if c.id == pick.id)
    return {
        "item": _enrich_item(db, pick, user.id, all_users),
        "winner_index": winner_index,
        "winner_id": pick.id,
        "candidates": [
            {"id": c.id, "title": c.title or "Untitled", "poster": c.poster or ""}
            for c in candidates
        ],
    }


def _normalize_labels(labels: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in labels:
        label = raw.strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(label)
    return out


def _custom_wheel_response(labels: list[str]) -> dict:
    normalized = _normalize_labels(labels)
    if not normalized:
        raise HTTPException(400, "At least one non-empty label is required")
    winner_index = random.randrange(len(normalized))
    pick = normalized[winner_index]
    candidates = [
        {"id": -(i + 1), "title": label, "poster": ""} for i, label in enumerate(normalized)
    ]
    return {
        "item": {
            "id": -(winner_index + 1),
            "title": pick,
            "poster": "",
            "kind": "movie",
            "list_section": "to_watch",
        },
        "winner_index": winner_index,
        "winner_id": -(winner_index + 1),
        "candidates": candidates,
        "custom": True,
    }


@router.get("/wheel-presets")
def list_wheel_presets(db: Session = Depends(get_db)):
    rows = db.query(WheelPreset).order_by(WheelPreset.sort_order, WheelPreset.id).all()
    return {"presets": [r.to_dict() for r in rows]}


@router.post("/wheel-presets")
def create_wheel_preset(
    body: WheelPresetCreate,
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_auth),
):
    labels = _normalize_labels(body.labels)
    if not labels:
        raise HTTPException(400, "At least one label is required")
    max_order = db.query(func.max(WheelPreset.sort_order)).scalar() or 0
    row = WheelPreset(
        name=body.name.strip(),
        labels_json=json.dumps(labels),
        sort_order=max_order + 1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row.to_dict()


@router.delete("/wheel-presets/{preset_id}")
def delete_wheel_preset(
    preset_id: int,
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_auth),
):
    row = db.get(WheelPreset, preset_id)
    if not row:
        raise HTTPException(404, "Preset not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/wheel/custom")
def custom_wheel_spin(
    body: CustomWheelBody,
    _: auth.CurrentUser = Depends(auth.require_auth),
):
    return _custom_wheel_response(body.labels)


def _user_watched(db: Session, user_id: int, item_id: int) -> bool:
    row = db.query(UserWatchStatus).filter_by(user_id=user_id, item_id=item_id).first()
    return bool(row.watched) if row else False


def _group_roots(db: Session, group_id: int) -> list[WatchlistItem]:
    q = db.query(WatchlistItem).filter(WatchlistItem.parent_id.is_(None))
    if group_id == 0:
        q = q.filter(WatchlistItem.group_id.is_(None))
    else:
        q = q.filter(WatchlistItem.group_id == group_id)
    return q.order_by(WatchlistItem.sort_order, WatchlistItem.id).all()


def _collect_unwatched_library(db: Session, group_id: int, user_id: int) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for root in _group_roots(db, group_id):
        if root.kind == "series":
            children = (
                db.query(WatchlistItem)
                .filter_by(parent_id=root.id)
                .order_by(WatchlistItem.sort_order, WatchlistItem.id)
                .all()
            )
            for child in children:
                if _user_watched(db, user_id, child.id):
                    continue
                lib = _find_library_match(db, child)
                if lib:
                    out.append((lib["id"], child.title or root.title))
        else:
            if _user_watched(db, user_id, root.id):
                continue
            lib = _find_library_match(db, root)
            if lib:
                out.append((lib["id"], root.title))
    return out


@router.post("/groups/{group_id}/queue-unwatched")
async def queue_unwatched_in_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    from ..playqueue.manager import manager

    pairs = _collect_unwatched_library(db, group_id, user.id)
    added = 0
    skipped = 0
    for lib_id, _title in pairs:
        try:
            await manager.add_library_item(lib_id)
            added += 1
        except ValueError:
            skipped += 1
    return {"added": added, "skipped": skipped, "eligible": len(pairs)}


@router.post("/groups/{group_id}/play-next-unwatched")
async def play_next_unwatched_in_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_auth),
):
    from ..playqueue.manager import manager

    pairs = _collect_unwatched_library(db, group_id, user.id)
    if not pairs:
        raise HTTPException(404, "No unwatched in-library titles in this group")
    lib_id, title = pairs[0]
    snap = await manager.add_library_item(lib_id)
    await manager.play_index(len(snap["items"]) - 1)
    return {"title": title, "library_id": lib_id}
