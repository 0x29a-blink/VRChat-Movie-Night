from datetime import datetime, timedelta, timezone

from app.models import (
    User,
    UserRating,
    UserWatchStatus,
    WatchlistComment,
    WatchlistItem,
    WatchlistItemUserExclusion,
)
from app.routers.watchlist_routes import _enrich_item
from app.watchlist.exclusions import ExclusionContext, is_hidden_from_item, users_for_item_stats


def test_set_global_user_exclusion(client, db):
    guest = User(username="guest", password_hash="x", role="member", watchlist_stats_excluded=False)
    db.add(guest)
    db.commit()

    res = client.put(f"/api/users/{guest.id}/watchlist-stats-excluded", json={"excluded": True})
    assert res.status_code == 200
    assert res.json()["user"]["watchlist_stats_excluded"] is True

    db.refresh(guest)
    assert guest.watchlist_stats_excluded is True
    assert guest.watchlist_stats_excluded_at is not None


def test_global_exclusion_grandfathers_prior_activity(db):
    now = datetime.now(timezone.utc)
    alice = User(username="alice", password_hash="x", role="member")
    bob = User(
        username="bob",
        password_hash="x",
        role="member",
        watchlist_stats_excluded=True,
        watchlist_stats_excluded_at=now - timedelta(days=1),
    )
    db.add_all([alice, bob])
    db.flush()

    watched = WatchlistItem(kind="movie", title="Old Movie", media_type="movie")
    untouched = WatchlistItem(kind="movie", title="New Movie", media_type="movie")
    db.add_all([watched, untouched])
    db.flush()

    db.add(
        UserWatchStatus(
            user_id=bob.id,
            item_id=watched.id,
            watched=True,
            watched_at=now - timedelta(days=3),
        )
    )
    db.commit()

    watched_enriched = _enrich_item(db, watched, alice.id, [alice, bob])
    assert {u["username"] for u in watched_enriched["user_watch"]} == {"alice", "bob"}
    assert any(u["username"] == "bob" and u["watched"] for u in watched_enriched["user_watch"])

    untouched_enriched = _enrich_item(db, untouched, alice.id, [alice, bob])
    assert [u["username"] for u in untouched_enriched["user_watch"]] == ["alice"]


def test_global_exclusion_shows_user_after_new_activity(db):
    now = datetime.now(timezone.utc)
    alice = User(username="alice", password_hash="x", role="member")
    bob = User(
        username="bob",
        password_hash="x",
        role="member",
        watchlist_stats_excluded=True,
        watchlist_stats_excluded_at=now - timedelta(days=1),
    )
    db.add_all([alice, bob])
    db.flush()

    movie = WatchlistItem(kind="movie", title="Movie", media_type="movie")
    db.add(movie)
    db.commit()

    enriched = _enrich_item(db, movie, alice.id, [alice, bob])
    assert [u["username"] for u in enriched["user_watch"]] == ["alice"]

    db.add(UserRating(user_id=bob.id, item_id=movie.id, stars=4, rated_at=now))
    db.commit()

    enriched = _enrich_item(db, movie, alice.id, [alice, bob])
    assert {u["username"] for u in enriched["user_watch"]} == {"alice", "bob"}


def test_per_item_exclusion(db):
    now = datetime.now(timezone.utc)
    alice = User(username="alice", password_hash="x", role="member")
    bob = User(username="bob", password_hash="x", role="member")
    db.add_all([alice, bob])
    db.flush()

    movie = WatchlistItem(kind="movie", title="One", media_type="movie")
    db.add(movie)
    db.flush()
    db.add(
        WatchlistItemUserExclusion(
            item_id=movie.id,
            user_id=bob.id,
            created_at=now - timedelta(hours=1),
        )
    )
    db.add(
        UserWatchStatus(
            user_id=bob.id,
            item_id=movie.id,
            watched=True,
            watched_at=now - timedelta(days=2),
        )
    )
    db.commit()

    ctx = ExclusionContext.load(db)
    assert is_hidden_from_item(ctx, db, bob, movie, [movie.id]) is True

    enriched = _enrich_item(db, movie, alice.id, [alice, bob])
    assert [u["username"] for u in enriched["user_watch"]] == ["alice"]


def test_excluded_viewer_still_sees_self_in_badges(db):
    bob = User(username="bob", password_hash="x", role="member", watchlist_stats_excluded=True)
    db.add(bob)
    db.flush()
    movie = WatchlistItem(kind="movie", title="Movie", media_type="movie")
    db.add(movie)
    db.commit()

    ctx = ExclusionContext.load(db)
    visible = users_for_item_stats(ctx, db, [bob], movie, [movie.id], viewer_user_id=bob.id)
    assert [u.id for u in visible] == [bob.id]


def test_item_stats_exclusion_api(client, db):
    guest = User(username="guest", password_hash="x", role="member")
    db.add(guest)
    db.flush()
    movie = WatchlistItem(kind="movie", title="Movie", media_type="movie")
    db.add(movie)
    db.commit()

    listed = client.get(f"/api/watchlist/items/{movie.id}/stats-exclusions")
    assert listed.status_code == 200
    guest_row = next(u for u in listed.json()["users"] if u["username"] == "guest")
    assert guest_row["excluded_on_item"] is False

    updated = client.put(
        f"/api/watchlist/items/{movie.id}/stats-exclusions/{guest.id}",
        json={"excluded": True},
    )
    assert updated.status_code == 200
    assert [u["username"] for u in updated.json()["user_watch"]] == ["admin"]

    listed = client.get(f"/api/watchlist/items/{movie.id}/stats-exclusions")
    guest_row = next(u for u in listed.json()["users"] if u["username"] == "guest")
    assert guest_row["excluded_on_item"] is True


def test_comment_brings_excluded_user_back(db):
    now = datetime.now(timezone.utc)
    bob = User(
        username="bob",
        password_hash="x",
        role="member",
        watchlist_stats_excluded=True,
        watchlist_stats_excluded_at=now - timedelta(hours=2),
    )
    db.add(bob)
    db.flush()
    movie = WatchlistItem(kind="movie", title="Movie", media_type="movie")
    db.add(movie)
    db.flush()
    db.add(
        WatchlistComment(
            user_id=bob.id,
            item_id=movie.id,
            body="Great",
            created_at=now,
        )
    )
    db.commit()

    enriched = _enrich_item(db, movie, bob.id, [bob])
    assert enriched["user_watch"][0]["username"] == "bob"
    assert enriched["comment_count"] == 1
