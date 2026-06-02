import statistics
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..models import User, UserRating, UserWatchStatus, WatchlistComment, WatchlistItem, WatchlistGroup
from ..watchlist.exclusions import (
    ExclusionContext,
    filter_ratings_for_item,
    is_hidden_from_item,
    participation_scope_ids,
    users_for_item_stats,
)
from .watchlist_routes import (
    _container_children_maps,
    _item_base,
    _series_children,
    _user_root_watched,
    _user_watched_item,
)

router = APIRouter(prefix="/api/stats", tags=["stats"], dependencies=[Depends(auth.require_auth)])

LIST_LIMIT = 12


def _comment_count_for_users(
    ctx: ExclusionContext,
    db: Session,
    item: WatchlistItem,
    scope_ids: list[int],
    allowed_user_ids: set[int],
) -> int:
    if not allowed_user_ids:
        return 0
    comments = db.query(WatchlistComment).filter(WatchlistComment.item_id == item.id).all()
    if not comments:
        return 0
    user_ids = {c.user_id for c in comments}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    return sum(
        1
        for comment in comments
        if comment.user_id in allowed_user_ids
        and (user := users.get(comment.user_id))
        and not is_hidden_from_item(ctx, db, user, item, scope_ids)
    )


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
    elif item.kind == "collection":
        for c in children:
            item_ids.append(c.id)
            if c.kind == "series":
                item_ids.extend(e.id for e in _series_children(db, c.id))

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
    exclusion_ctx: ExclusionContext,
    nested_by_parent: dict[int, list[WatchlistItem]] | None = None,
) -> dict:
    base = _item_base(item)
    scope_ids = participation_scope_ids(db, item, children, nested_by_parent)
    stats_users = users_for_item_stats(exclusion_ctx, db, all_users, item, scope_ids)

    watched_count = sum(
        1 for u in stats_users if _user_root_watched(db, u.id, item, children)
    )
    everyone_watched = len(stats_users) > 0 and watched_count == len(stats_users)

    completion_times = [
        t
        for u in stats_users
        if (t := _user_completion_at(db, u.id, item, children)) is not None
    ]
    latest_watched_at = max(completion_times).isoformat() if completion_times else None

    ratings = (
        db.query(UserRating, User)
        .join(User, User.id == UserRating.user_id)
        .filter(UserRating.item_id == item.id, UserRating.stars > 0)
        .all()
    )
    filtered_ratings = filter_ratings_for_item(exclusion_ctx, db, item, scope_ids, ratings)
    stats_user_ids = {u.id for u in stats_users}
    filtered_ratings = [r for r in filtered_ratings if r["user_id"] in stats_user_ids]
    rating_values = [r["stars"] for r in filtered_ratings]
    rating_count = len(rating_values)
    avg_stars = sum(rating_values) / rating_count if rating_count else None
    rating_stddev = statistics.pstdev(rating_values) if rating_count >= 2 else None
    unanimous_five = rating_count > 0 and all(v == 5.0 for v in rating_values)

    comment_count = _comment_count_for_users(
        exclusion_ctx, db, item, scope_ids, stats_user_ids
    )

    group_episode_progress = None
    if item.kind in ("series", "collection") and children:
        ep_any = sum(
            1
            for c in children
            if any(_user_watched_item(db, u.id, c.id) for u in stats_users)
        )
        group_episode_progress = f"{ep_any}/{len(children)}"

    return {
        **base,
        "watched_count": watched_count,
        "everyone_watched": everyone_watched,
        "latest_watched_at": latest_watched_at,
        "group_episode_progress": group_episode_progress,
        "ratings": filtered_ratings,
        "rating_count": rating_count,
        "avg_stars": round(avg_stars, 2) if avg_stars is not None else None,
        "rating_stddev": round(rating_stddev, 2) if rating_stddev is not None else None,
        "unanimous_five": unanimous_five,
        "comment_count": comment_count,
    }


def _user_rating_stars(db: Session, user_id: int, item_id: int) -> float | None:
    row = (
        db.query(UserRating)
        .filter(UserRating.user_id == user_id, UserRating.item_id == item_id)
        .first()
    )
    if row and row.stars > 0:
        return row.stars
    return None


def _user_commented_on_item(db: Session, user_id: int, item_id: int) -> bool:
    return (
        db.query(WatchlistComment)
        .filter(WatchlistComment.user_id == user_id, WatchlistComment.item_id == item_id)
        .first()
        is not None
    )


def _build_profile_title(
    db: Session,
    user_id: int,
    item: WatchlistItem,
    children: list[WatchlistItem],
    nested_by_parent: dict[int, list[WatchlistItem]] | None = None,
) -> dict | None:
    child_nested = nested_by_parent if item.kind == "collection" else None
    watched = _user_root_watched(db, user_id, item, children, child_nested)
    rating = _user_rating_stars(db, user_id, item.id)
    commented = _user_commented_on_item(db, user_id, item.id)
    if not watched and rating is None and not commented:
        return None

    watched_at = _user_completion_at(db, user_id, item, children)
    return {
        **_item_base(item),
        "user_watched": watched,
        "user_rating": rating,
        "user_watched_at": watched_at.isoformat() if watched_at else None,
        "user_commented": commented,
        "user_needs_rating": watched and rating is None,
    }


def _build_user_profile(
    db: Session,
    user: User,
    roots: list[WatchlistItem],
    by_parent: dict[int, list[WatchlistItem]],
    nested: dict[int, list[WatchlistItem]],
) -> dict:
    titles: list[dict] = []
    for root in roots:
        children = by_parent.get(root.id, []) if root.kind in ("series", "collection") else []
        row = _build_profile_title(
            db,
            user.id,
            root,
            children,
            nested if root.kind == "collection" else None,
        )
        if row:
            titles.append(row)

    ratings = [t["user_rating"] for t in titles if t["user_rating"] is not None]
    return {
        "user_id": user.id,
        "username": user.username,
        "watched_count": sum(1 for t in titles if t["user_watched"]),
        "ratings_given": len(ratings),
        "avg_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        "comments_given": sum(1 for t in titles if t["user_commented"]),
        "needs_rating_count": sum(1 for t in titles if t["user_needs_rating"]),
        "titles": titles,
    }


def _top(items: list[dict], key, *, reverse=True, limit=LIST_LIMIT) -> list[dict]:
    return sorted(items, key=key, reverse=reverse)[:limit]


@router.get("")
def get_stats(
    db: Session = Depends(get_db),
    _: auth.CurrentUser = Depends(auth.require_auth),
    group_id: int | None = Query(None, description="Filter by watchlist group; omit for all groups"),
    user_ids: str | None = Query(
        None,
        description="Comma-separated user ids to include in group stats; omit for all users",
    ),
):
    all_users = db.query(User).order_by(User.id).all()
    selected_ids: set[int] | None = None
    if user_ids is not None and user_ids.strip():
        try:
            selected_ids = {int(x.strip()) for x in user_ids.split(",") if x.strip()}
        except ValueError as exc:
            raise HTTPException(400, "user_ids must be comma-separated integers") from exc
        if not selected_ids:
            selected_ids = None
    stats_users_all = all_users
    if selected_ids is not None:
        stats_users_all = [u for u in all_users if u.id in selected_ids]
        if not stats_users_all:
            raise HTTPException(400, "No matching users for user_ids")

    exclusion_ctx = ExclusionContext.load(db)
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
    by_parent, nested = _container_children_maps(db, roots)

    titles: list[dict] = []
    for root in roots:
        children = by_parent.get(root.id, []) if root.kind in ("series", "collection") else []
        titles.append(
            _build_title_stats(
                db,
                root,
                stats_users_all,
                children,
                exclusion_ctx,
                nested if root.kind == "collection" else None,
            )
        )

    watched_titles = [t for t in titles if t["watched_count"] > 0]
    rated_titles = [t for t in titles if t["rating_count"] > 0]

    all_rating_values = [r["stars"] for t in rated_titles for r in t["ratings"]]

    user_leaderboard = []
    root_ids = [r.id for r in roots]
    leaderboard_users = stats_users_all if selected_ids is not None else all_users
    for u in leaderboard_users:
        finished = 0
        for root in roots:
            children = by_parent.get(root.id, []) if root.kind in ("series", "collection") else []
            child_nested = nested if root.kind == "collection" else None
            if not _user_root_watched(db, u.id, root, children, child_nested):
                continue
            scope_ids = participation_scope_ids(db, root, children, child_nested)
            if is_hidden_from_item(exclusion_ctx, db, u, root, scope_ids):
                continue
            finished += 1

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
            for rating in given:
                item = db.get(WatchlistItem, rating.item_id)
                if not item:
                    continue
                child_list = by_parent.get(item.id, []) if item.kind in ("series", "collection") else []
                scope_ids = participation_scope_ids(
                    db,
                    item,
                    child_list,
                    nested if item.kind == "collection" else None,
                )
                if is_hidden_from_item(exclusion_ctx, db, u, item, scope_ids):
                    continue
                given_values.append(rating.stars)
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

    min_rated_for_lists = 1 if len(stats_users_all) <= 1 else 2
    min_divisive_ratings = min(3, max(2, len(stats_users_all)))

    profile = None
    if len(stats_users_all) == 1:
        profile = _build_user_profile(db, stats_users_all[0], roots, by_parent, nested)

    return {
        "group_id": group_id,
        "group_name": group_name,
        "users": [{"user_id": u.id, "username": u.username} for u in all_users],
        "selected_user_ids": sorted(selected_ids) if selected_ids is not None else None,
        "overview": {
            "total_titles": len(titles),
            "watched_by_anyone": len(watched_titles),
            "everyone_watched": sum(1 for t in titles if t["everyone_watched"]),
            "total_ratings": len(all_rating_values),
            "avg_stars_all": round(sum(all_rating_values) / len(all_rating_values), 2)
            if all_rating_values
            else None,
            "active_users": len(stats_users_all),
        },
        "top_rated": _top(
            [t for t in rated_titles if t["rating_count"] >= min_rated_for_lists],
            lambda t: (t["avg_stars"], t["rating_count"]),
        ),
        "worst_rated": _top(
            [t for t in rated_titles if t["rating_count"] >= min_rated_for_lists],
            lambda t: (t["avg_stars"], -t["rating_count"]),
            reverse=False,
        ),
        "perfect_scores": _top(
            [t for t in rated_titles if t["unanimous_five"] and t["rating_count"] >= min_rated_for_lists],
            lambda t: (t["rating_count"], t["avg_stars"]),
        ),
        "everyone_watched": _top(
            [t for t in titles if t["everyone_watched"]],
            lambda t: t["latest_watched_at"] or "",
        ),
        "most_divisive": _top(
            [t for t in rated_titles if t["rating_count"] >= min_divisive_ratings and t["rating_stddev"] is not None],
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
        "profile": profile,
    }
