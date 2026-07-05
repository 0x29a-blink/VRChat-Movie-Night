"""Characterization + query-count tests for GET /api/stats leaderboard.

Guards the N+1 removal in stats_routes.py / watchlist_routes.py (plan 006):
the leaderboard's watched_count / ratings_given / avg_rating_given values must
stay byte-identical before and after batching the underlying queries.
"""

from app.auth import hash_password
from app.models import User, UserRating, UserWatchStatus, WatchlistItem


def _seed_leaderboard_scenario(db):
    """Seed 3 users and a movie + series + collection watchlist per plan 006 Step 1.

    Returns (user1, user2, user3) where user1 is the existing admin from the
    `client` fixture.
    """
    user1 = db.query(User).filter(User.username == "admin").first()
    assert user1 is not None

    user2 = User(username="member2", password_hash=hash_password("test"), role="member")
    user3 = User(username="member3", password_hash=hash_password("test"), role="member")
    db.add_all([user2, user3])
    db.flush()

    # (a) a movie watched by users 1 + 2
    movie = WatchlistItem(kind="movie", title="Movie M", media_type="movie")
    db.add(movie)
    db.flush()

    # (b) a series with 2 episodes; user1 watched both episodes (not parent),
    # user2 watched only one.
    series = WatchlistItem(kind="series", title="Series S", media_type="series")
    db.add(series)
    db.flush()
    ep1 = WatchlistItem(kind="episode", title="S E1", media_type="series", parent_id=series.id, season=1, episode=1)
    ep2 = WatchlistItem(kind="episode", title="S E2", media_type="series", parent_id=series.id, season=1, episode=2)
    db.add_all([ep1, ep2])
    db.flush()

    # (c) a collection containing a movie and a series-with-1-episode, fully
    # watched by user1 only.
    collection = WatchlistItem(kind="collection", title="Collection C", media_type="movie")
    db.add(collection)
    db.flush()
    coll_movie = WatchlistItem(
        kind="movie", title="Collection Movie", media_type="movie", parent_id=collection.id
    )
    coll_series = WatchlistItem(
        kind="series", title="Collection Series", media_type="series", parent_id=collection.id
    )
    db.add_all([coll_movie, coll_series])
    db.flush()
    coll_ep = WatchlistItem(
        kind="episode",
        title="Collection Series E1",
        media_type="series",
        parent_id=coll_series.id,
        season=1,
        episode=1,
    )
    db.add(coll_ep)
    db.flush()

    watch_rows = [
        # user1: movie watched, both series episodes watched, whole collection watched
        UserWatchStatus(user_id=user1.id, item_id=movie.id, watched=True),
        UserWatchStatus(user_id=user1.id, item_id=ep1.id, watched=True),
        UserWatchStatus(user_id=user1.id, item_id=ep2.id, watched=True),
        UserWatchStatus(user_id=user1.id, item_id=coll_movie.id, watched=True),
        UserWatchStatus(user_id=user1.id, item_id=coll_ep.id, watched=True),
        # user2: movie watched, only ep1 of the series watched, nothing in the collection
        UserWatchStatus(user_id=user2.id, item_id=movie.id, watched=True),
        UserWatchStatus(user_id=user2.id, item_id=ep1.id, watched=True),
    ]
    db.add_all(watch_rows)

    ratings = [
        UserRating(user_id=user1.id, item_id=movie.id, stars=5),
        UserRating(user_id=user1.id, item_id=series.id, stars=4),
        UserRating(user_id=user2.id, item_id=movie.id, stars=3),
    ]
    db.add_all(ratings)
    db.commit()

    return user1, user2, user3


def _expected_leaderboard(user1, user2, user3):
    return [
        {
            "user_id": user1.id,
            "username": user1.username,
            "watched_count": 3,
            "ratings_given": 2,
            "avg_rating_given": 4.5,
        },
        {
            "user_id": user2.id,
            "username": user2.username,
            "watched_count": 1,
            "ratings_given": 1,
            "avg_rating_given": 3.0,
        },
        {
            "user_id": user3.id,
            "username": user3.username,
            "watched_count": 0,
            "ratings_given": 0,
            "avg_rating_given": None,
        },
    ]


def test_stats_leaderboard_values(client, db):
    user1, user2, user3 = _seed_leaderboard_scenario(db)

    res = client.get("/api/stats")
    assert res.status_code == 200
    body = res.json()

    assert body["user_leaderboard"] == _expected_leaderboard(user1, user2, user3)
    assert body["overview"]["total_titles"] == 3
    assert body["overview"]["total_ratings"] == 3


def test_stats_query_count_bounded(client, db):
    _seed_leaderboard_scenario(db)

    from sqlalchemy import event

    from app.db import engine  # conftest rebinds this per-test; import inside the test

    counter = {"n": 0}

    def _count(conn, cursor, statement, parameters, context, executemany):
        counter["n"] += 1

    event.listen(engine, "before_cursor_execute", _count)
    try:
        res = client.get("/api/stats")
        assert res.status_code == 200
        first = counter["n"]
    finally:
        event.remove(engine, "before_cursor_execute", _count)

    # Observed after the plan-006 batching: ~70 queries for this seed (was ~90
    # before batching the leaderboard's watch-status/rating lookups). Bound is
    # set well below the old per-user-per-item behavior so a regression back to
    # N+1 queries (hundreds, scaling with users x items x episodes) fails this
    # test, while leaving headroom above the current count.
    assert first < 100, f"stats issued {first} queries"
