import statistics
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..models import User, UserRating, UserWatchStatus, WatchlistComment, WatchlistItem, WatchlistGroup
from .watchlist_routes import _children_by_parent, _item_base, _user_root_watched, _user_watched_item

router = APIRouter(prefix="/api/stats", tags=["stats"], dependencies=[Depends(auth.require_auth)])

LIST_LIMIT = 12


def _user_completion_at(
    db: Session,
    user_id: int,
    item: WatchlistItem,
    children: list[WatchlistItem],
) -> datetime | None:
    if not _user_root_watched(db, user_id, item, children):
        return None

    item_ids = [item.id]
    if item.kind == "series":
        item_ids.extend(c.id for c in children)

    rows = (
        db.query(UserWatchStatus)
        .filter(
            UserWatchStatus.user_id == user_id,
            UserWatchStatus.item_id.in_(item_ids),
            UserWatchStatus.watched.is_(True),
            UserWatchStatus.watched_at.isnot(None),
        )
        .all()
    )
    times = [r.watched_at for r in rows if r.watched_at]
    return max(times) if times else None


def _build_title_stats(
    db: Session,
    item: WatchlistItem,
    all_users: list[User],
    children: list[WatchlistItem],
) -> dict:
    base = _item_base(item)
    watched_count = sum(
        1 for u in all_users if _user_root_watched(db, u.id, item, children)
    )
    everyone_watched = len(all_users) > 0 and watched_count == len(all_users)

    completion_times = [
        t
        for u in all_users
        if (t := _user_completion_at(db, u.id, item, children)) is not None
    ]
    latest_watched_at = max(completion_times).isoformat() if completion_times else None

    ratings = (
        db.query(UserRating, User)
        .join(User, User.id == UserRating.user_id)
        .filter(UserRating.item_id == item.id, UserRating.stars > 0)
        .all()
    )
    rating_values = [r.stars for r, _ in ratings]
    rating_count = len(rating_values)
    avg_stars = sum(rating_values) / rating_count if rating_count else None
    rating_stddev = statistics.pstdev(rating_values) if rating_count >= 2 else None
    unanimous_five = rating_count > 0 and all(v == 5.0 for v in rating_values)

    comment_count = (
        db.query(func.count(WatchlistComment.id))
        .filter(WatchlistComment.item_id == item.id)
        .scalar()
        or 0
    )

    group_episode_progress = None
    if item.kind == "series" and children:
        ep_any = sum(
            1 for c in children if any(_user_watched_item(db, u.id, c.id) for u in all_users)
        )
        group_episode_progress = f"{ep_any}/{len(children)}"

    return {
        **base,
        "watched_count": watched_count,
        "everyone_watched": everyone_watched,
        "latest_watched_at": latest_watched_at,
        "group_episode_progress": group_episode_progress,
        "ratings": [
            {"user_id": u.id, "username": u.username, "stars": r.stars} for r, u in ratings
        ],
        "rating_count": rating_count,
        "avg_stars": round(avg_stars, 2) if avg_stars is not None else None,
        "rating_stddev": round(rating_stddev, 2) if rating_stddev is not None else None,
        "unanimous_five": unanimous_five,
        "comment_count": comment_count,
    }


def _top(items: list[dict], key, *, reverse=True, limit=LIST_LIMIT) -> list[dict]:
    return sorted(items, key=key, reverse=reverse)[:limit]


@router.get("")
def get_stats(
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_auth),
    group_id: int | None = Query(None, description="Filter by watchlist group; omit for all groups"),
):
    all_users = db.query(User).order_by(User.id).all()
    q = db.query(WatchlistItem).filter(WatchlistItem.parent_id.is_(None))
    group_name = "All groups"
    if group_id is not None:
        if group_id == 0:
            q = q.filter(WatchlistItem.group_id.is_(None))
            group_name = "Ungrouped"
        else:
            grp = db.get(WatchlistGroup, group_id)
            if not grp:
                raise HTTPException(404, "Group not found")
            q = q.filter(WatchlistItem.group_id == group_id)
            group_name = grp.name
    roots = q.order_by(WatchlistItem.sort_order, WatchlistItem.id).all()
    series_ids = [i.id for i in roots if i.kind == "series"]
    by_parent = _children_by_parent(db, series_ids)

    titles: list[dict] = []
    for root in roots:
        children = by_parent.get(root.id, []) if root.kind == "series" else []
        titles.append(_build_title_stats(db, root, all_users, children))

    watched_titles = [t for t in titles if t["watched_count"] > 0]
    rated_titles = [t for t in titles if t["rating_count"] > 0]

    all_rating_values = [r["stars"] for t in rated_titles for r in t["ratings"]]

    user_leaderboard = []
    root_ids = [r.id for r in roots]
    for u in all_users:
        finished = sum(
            1
            for root in roots
            if _user_root_watched(
                db,
                u.id,
                root,
                by_parent.get(root.id, []) if root.kind == "series" else [],
            )
        )
        given_values: list[float] = []
        if root_ids:
            given = (
                db.query(UserRating)
                .join(WatchlistItem, WatchlistItem.id == UserRating.item_id)
                .filter(
                    UserRating.user_id == u.id,
                    UserRating.stars > 0,
                    WatchlistItem.parent_id.is_(None),
                    WatchlistItem.id.in_(root_ids),
                )
                .all()
            )
            given_values = [r.stars for r in given]
        user_leaderboard.append(
            {
                "user_id": u.id,
                "username": u.username,
                "watched_count": finished,
                "ratings_given": len(given_values),
                "avg_rating_given": round(sum(given_values) / len(given_values), 2)
                if given_values
                else None,
            }
        )

    user_leaderboard.sort(
        key=lambda r: (r["watched_count"], r["ratings_given"]),
        reverse=True,
    )

    return {
        "group_id": group_id,
        "group_name": group_name,
        "overview": {
            "total_titles": len(titles),
            "watched_by_anyone": len(watched_titles),
            "everyone_watched": sum(1 for t in titles if t["everyone_watched"]),
            "total_ratings": len(all_rating_values),
            "avg_stars_all": round(sum(all_rating_values) / len(all_rating_values), 2)
            if all_rating_values
            else None,
            "active_users": len(all_users),
        },
        "top_rated": _top(
            [t for t in rated_titles if t["rating_count"] >= 2],
            lambda t: (t["avg_stars"], t["rating_count"]),
        ),
        "worst_rated": _top(
            [t for t in rated_titles if t["rating_count"] >= 2],
            lambda t: (t["avg_stars"], -t["rating_count"]),
            reverse=False,
        ),
        "perfect_scores": _top(
            [t for t in rated_titles if t["unanimous_five"] and t["rating_count"] >= 2],
            lambda t: (t["rating_count"], t["avg_stars"]),
        ),
        "everyone_watched": _top(
            [t for t in titles if t["everyone_watched"]],
            lambda t: t["latest_watched_at"] or "",
        ),
        "most_divisive": _top(
            [t for t in rated_titles if t["rating_count"] >= 3 and t["rating_stddev"] is not None],
            lambda t: t["rating_stddev"],
        ),
        "recently_watched": _top(
            [t for t in watched_titles if t["latest_watched_at"]],
            lambda t: t["latest_watched_at"] or "",
        ),
        "most_commented": _top(
            [t for t in watched_titles if t["comment_count"] > 0],
            lambda t: t["comment_count"],
        ),
        "user_leaderboard": user_leaderboard,
    }
