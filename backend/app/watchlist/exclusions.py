"""Hide inactive users from group watchlist stats unless they participate on a title."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import (
    User,
    UserRating,
    UserWatchStatus,
    WatchlistComment,
    WatchlistItem,
    WatchlistItemUserExclusion,
)


def _children_of(db: Session, parent_id: int) -> list[WatchlistItem]:
    return (
        db.query(WatchlistItem)
        .filter(WatchlistItem.parent_id == parent_id)
        .order_by(WatchlistItem.sort_order, WatchlistItem.id)
        .all()
    )


def participation_scope_ids(
    db: Session,
    item: WatchlistItem,
    children: list[WatchlistItem] | list[dict] | None = None,
    nested_by_parent: dict[int, list[WatchlistItem]] | None = None,
) -> list[int]:
    """Item ids used to decide whether an excluded user still appears on this title."""
    ids = [item.id]
    if item.kind == "series":
        if children:
            if isinstance(children[0], dict):
                ids.extend(int(c["id"]) for c in children)
            else:
                ids.extend(c.id for c in children)
        else:
            ids.extend(c.id for c in _children_of(db, item.id))
        return ids

    if item.kind == "collection":
        kids: list[WatchlistItem | dict]
        if children:
            kids = children
        else:
            kids = _children_of(db, item.id)
        for child in kids:
            if isinstance(child, dict):
                cid = int(child["id"])
                ckind = child.get("kind")
                ids.append(cid)
                if ckind == "series":
                    nested = child.get("children") or []
                    ids.extend(int(e["id"]) for e in nested)
            else:
                ids.append(child.id)
                if child.kind == "series":
                    if nested_by_parent is not None:
                        eps = nested_by_parent.get(child.id, [])
                    else:
                        eps = _children_of(db, child.id)
                    ids.extend(e.id for e in eps)
        return ids

    return ids


def _epoch() -> datetime:
    return datetime.min.replace(tzinfo=timezone.utc)


def exclusion_cutoff(
    ctx: ExclusionContext,
    db: Session,
    user_id: int,
    item_id: int,
) -> datetime | None:
    if not is_excluded_from_item(ctx, item_id, user_id):
        return None
    cutoffs: list[datetime] = []
    if user_id in ctx.global_excluded:
        user = db.get(User, user_id)
        if user and user.watchlist_stats_excluded_at:
            cutoffs.append(user.watchlist_stats_excluded_at)
    if (item_id, user_id) in ctx.item_exclusions:
        row = (
            db.query(WatchlistItemUserExclusion)
            .filter(
                WatchlistItemUserExclusion.item_id == item_id,
                WatchlistItemUserExclusion.user_id == user_id,
            )
            .first()
        )
        if row and row.created_at:
            cutoffs.append(row.created_at)
    return max(cutoffs) if cutoffs else _epoch()


def user_participated_on_items_before(
    db: Session,
    user_id: int,
    item_ids: list[int],
    before: datetime,
) -> bool:
    """Activity recorded before an exclusion cutoff (grandfathered for global exclusions)."""
    if not item_ids:
        return False
    if (
        db.query(UserWatchStatus)
        .filter(
            UserWatchStatus.user_id == user_id,
            UserWatchStatus.item_id.in_(item_ids),
            UserWatchStatus.watched.is_(True),
            or_(
                UserWatchStatus.watched_at.is_(None),
                UserWatchStatus.watched_at < before,
            ),
        )
        .first()
    ):
        return True
    if (
        db.query(UserRating)
        .filter(
            UserRating.user_id == user_id,
            UserRating.item_id.in_(item_ids),
            UserRating.stars > 0,
            or_(
                UserRating.rated_at.is_(None),
                UserRating.rated_at < before,
            ),
        )
        .first()
    ):
        return True
    if (
        db.query(WatchlistComment)
        .filter(
            WatchlistComment.user_id == user_id,
            WatchlistComment.item_id.in_(item_ids),
            WatchlistComment.created_at < before,
        )
        .first()
    ):
        return True
    return False


def user_participated_on_items(
    db: Session,
    user_id: int,
    item_ids: list[int],
    since: datetime,
) -> bool:
    if not item_ids:
        return False
    if (
        db.query(UserWatchStatus)
        .filter(
            UserWatchStatus.user_id == user_id,
            UserWatchStatus.item_id.in_(item_ids),
            UserWatchStatus.watched.is_(True),
            UserWatchStatus.watched_at.isnot(None),
            UserWatchStatus.watched_at >= since,
        )
        .first()
    ):
        return True
    if (
        db.query(UserRating)
        .filter(
            UserRating.user_id == user_id,
            UserRating.item_id.in_(item_ids),
            UserRating.stars > 0,
            UserRating.rated_at.isnot(None),
            UserRating.rated_at >= since,
        )
        .first()
    ):
        return True
    if (
        db.query(WatchlistComment)
        .filter(
            WatchlistComment.user_id == user_id,
            WatchlistComment.item_id.in_(item_ids),
            WatchlistComment.created_at >= since,
        )
        .first()
    ):
        return True
    return False


@dataclass
class ExclusionContext:
    global_excluded: set[int]
    item_exclusions: set[tuple[int, int]]

    @classmethod
    def load(cls, db: Session) -> ExclusionContext:
        global_excluded = {
            u.id for u in db.query(User).filter(User.watchlist_stats_excluded.is_(True)).all()
        }
        item_exclusions = {
            (row.item_id, row.user_id) for row in db.query(WatchlistItemUserExclusion).all()
        }
        return cls(global_excluded=global_excluded, item_exclusions=item_exclusions)


def is_excluded_from_item(ctx: ExclusionContext, item_id: int, user_id: int) -> bool:
    return user_id in ctx.global_excluded or (item_id, user_id) in ctx.item_exclusions


def is_hidden_from_item(
    ctx: ExclusionContext,
    db: Session,
    user: User,
    item: WatchlistItem,
    scope_ids: list[int],
) -> bool:
    if not is_excluded_from_item(ctx, item.id, user.id):
        return False

    per_item = (item.id, user.id) in ctx.item_exclusions
    globally = user.id in ctx.global_excluded

    if per_item:
        cutoff = exclusion_cutoff(ctx, db, user.id, item.id)
        if cutoff is None:
            return True
        # Per-title hide: suppress unless they re-engage after being removed from this title.
        return not user_participated_on_items(db, user.id, scope_ids, cutoff)

    if globally:
        cutoff = exclusion_cutoff(ctx, db, user.id, item.id)
        if cutoff is None:
            return True
        if user_participated_on_items_before(db, user.id, scope_ids, cutoff):
            return False
        if user_participated_on_items(db, user.id, scope_ids, cutoff):
            return False
        return True

    return False


def users_for_item_stats(
    ctx: ExclusionContext,
    db: Session,
    all_users: list[User],
    item: WatchlistItem,
    scope_ids: list[int],
    *,
    viewer_user_id: int | None = None,
) -> list[User]:
    visible: list[User] = []
    for user in all_users:
        if user.id == viewer_user_id or not is_hidden_from_item(ctx, db, user, item, scope_ids):
            visible.append(user)
    return visible


def filter_ratings_for_item(
    ctx: ExclusionContext,
    db: Session,
    item: WatchlistItem,
    scope_ids: list[int],
    ratings: list[tuple[UserRating, User]],
) -> list[dict]:
    out: list[dict] = []
    for rating, user in ratings:
        if is_hidden_from_item(ctx, db, user, item, scope_ids):
            continue
        out.append({"user_id": user.id, "username": user.username, "stars": rating.stars})
    return out


def visible_comment_count(
    ctx: ExclusionContext,
    db: Session,
    item: WatchlistItem,
    scope_ids: list[int],
) -> int:
    comments = db.query(WatchlistComment).filter(WatchlistComment.item_id == item.id).all()
    if not comments:
        return 0
    user_ids = {c.user_id for c in comments}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    return sum(
        1
        for comment in comments
        if (user := users.get(comment.user_id))
        and not is_hidden_from_item(ctx, db, user, item, scope_ids)
    )
