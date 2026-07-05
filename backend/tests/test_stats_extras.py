"""Tests for plan 018: needs-rating group view + timeline stats endpoint."""

from datetime import datetime, timedelta, timezone

from app.auth import hash_password
from app.models import User, UserRating, UserWatchStatus, WatchlistItem


def _seed_needs_rating_scenario(db):
    """3 users, 3 movies:

    - movie A: user1 watched + rated, user2 watched + not rated, user3 untouched.
    - movie B: user1 watched + not rated, user2 not watched.
    - movie C: nobody watched.
    """
    user1 = db.query(User).filter(User.username == "admin").first()
    assert user1 is not None
    user2 = User(username="member2", password_hash=hash_password("test"), role="member")
    user3 = User(username="member3", password_hash=hash_password("test"), role="member")
    db.add_all([user2, user3])
    db.flush()

    movie_a = WatchlistItem(kind="movie", title="Movie A", media_type="movie")
    movie_b = WatchlistItem(kind="movie", title="Movie B", media_type="movie")
    movie_c = WatchlistItem(kind="movie", title="Movie C", media_type="movie")
    db.add_all([movie_a, movie_b, movie_c])
    db.flush()

    watched_at_a = datetime(2026, 1, 1, tzinfo=timezone.utc)
    watched_at_b = datetime(2026, 1, 5, tzinfo=timezone.utc)

    db.add_all(
        [
            UserWatchStatus(user_id=user1.id, item_id=movie_a.id, watched=True, watched_at=watched_at_a),
            UserWatchStatus(user_id=user2.id, item_id=movie_a.id, watched=True, watched_at=watched_at_a),
            UserWatchStatus(user_id=user1.id, item_id=movie_b.id, watched=True, watched_at=watched_at_b),
        ]
    )
    db.add(UserRating(user_id=user1.id, item_id=movie_a.id, stars=5))
    db.commit()

    return user1, user2, user3, movie_a, movie_b, movie_c


def test_needs_rating_payload(client, db):
    user1, user2, user3, movie_a, movie_b, movie_c = _seed_needs_rating_scenario(db)

    res = client.get("/api/stats")
    assert res.status_code == 200
    body = res.json()

    by_user = {row["user_id"]: row for row in body["needs_rating"]}

    # user1 watched A (rated) and B (not rated) -> only B shows up.
    assert user1.id in by_user
    user1_titles = by_user[user1.id]["titles"]
    assert [t["item_id"] for t in user1_titles] == [movie_b.id]
    assert user1_titles[0]["title"] == "Movie B"
    assert user1_titles[0]["watched_at"] is not None
    assert by_user[user1.id]["more"] == 0

    # user2 watched A only, and never rated it -> A shows up.
    assert user2.id in by_user
    user2_titles = by_user[user2.id]["titles"]
    assert [t["item_id"] for t in user2_titles] == [movie_a.id]
    assert by_user[user2.id]["more"] == 0

    # user3 watched nothing -> absent entirely (no empty entry noise).
    assert user3.id not in by_user


def test_needs_rating_cap_and_more_count(client, db):
    user1 = db.query(User).filter(User.username == "admin").first()
    movies = []
    for i in range(12):
        m = WatchlistItem(kind="movie", title=f"Movie {i:02d}", media_type="movie")
        db.add(m)
        db.flush()
        movies.append(m)
    db.add_all(
        [
            UserWatchStatus(
                user_id=user1.id,
                item_id=m.id,
                watched=True,
                watched_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=i),
            )
            for i, m in enumerate(movies)
        ]
    )
    db.commit()

    res = client.get("/api/stats")
    assert res.status_code == 200
    body = res.json()
    by_user = {row["user_id"]: row for row in body["needs_rating"]}
    assert user1.id in by_user
    entry = by_user[user1.id]
    assert len(entry["titles"]) == 10
    assert entry["more"] == 2
    # Capped list should be the most-recently-watched 10 (sorted desc by watched_at).
    assert entry["titles"][0]["title"] == "Movie 11"


def test_stats_leaderboard_unaffected_by_needs_rating(client, db):
    """Sanity: adding needs_rating must not change leaderboard/overview shape."""
    from tests.test_stats_leaderboard import _expected_leaderboard, _seed_leaderboard_scenario

    user1, user2, user3 = _seed_leaderboard_scenario(db)
    res = client.get("/api/stats")
    assert res.status_code == 200
    body = res.json()
    assert body["user_leaderboard"] == _expected_leaderboard(user1, user2, user3)
    assert "needs_rating" in body


def _seed_timeline_scenario(db):
    """Seed watched_at/rated_at timestamps across known dates.

    - 2 watches on day D, 1 watch on day D+1 (2 items involved twice for lag calc)
    - ratings: item1 rated 2 days after watched (lag=2), item2 rated 4 days after (lag=4)
    - one watch/rating pair outside the requested window is added by the test itself.
    """
    user1 = db.query(User).filter(User.username == "admin").first()
    assert user1 is not None
    user2 = User(username="member2", password_hash=hash_password("test"), role="member")
    db.add(user2)
    db.flush()

    item1 = WatchlistItem(kind="movie", title="Timeline Movie 1", media_type="movie")
    item2 = WatchlistItem(kind="movie", title="Timeline Movie 2", media_type="movie")
    item3 = WatchlistItem(kind="movie", title="Timeline Movie 3", media_type="movie")
    db.add_all([item1, item2, item3])
    db.flush()

    now = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    day0 = now - timedelta(days=10)
    day1 = day0 + timedelta(days=1)

    db.add_all(
        [
            UserWatchStatus(user_id=user1.id, item_id=item1.id, watched=True, watched_at=day0),
            UserWatchStatus(user_id=user2.id, item_id=item2.id, watched=True, watched_at=day0),
            UserWatchStatus(user_id=user1.id, item_id=item3.id, watched=True, watched_at=day1),
        ]
    )
    db.add_all(
        [
            UserRating(user_id=user1.id, item_id=item1.id, stars=4, rated_at=day0 + timedelta(days=2)),
            UserRating(user_id=user2.id, item_id=item2.id, stars=3, rated_at=day0 + timedelta(days=4)),
        ]
    )
    db.commit()
    return user1, user2, item1, item2, item3, day0, day1


def test_timeline_counts_and_busiest_day(client, db):
    _user1, _user2, _item1, _item2, _item3, day0, day1 = _seed_timeline_scenario(db)

    res = client.get("/api/stats/timeline?days=90")
    assert res.status_code == 200
    body = res.json()

    day0_key = day0.date().isoformat()
    day1_key = day1.date().isoformat()

    watch_by_day = {row["date"]: row["count"] for row in body["watch_counts"]}
    assert watch_by_day[day0_key] == 2
    assert watch_by_day[day1_key] == 1

    rating_by_day = {row["date"]: row["count"] for row in body["rating_counts"]}
    assert rating_by_day[(day0 + timedelta(days=2)).date().isoformat()] == 1
    assert rating_by_day[(day0 + timedelta(days=4)).date().isoformat()] == 1

    # day0 has 2 watches + 0 ratings = 2 combined; busiest day.
    assert body["busiest_day"]["date"] == day0_key
    assert body["busiest_day"]["count"] == 2


def test_timeline_rating_lag_median(client, db):
    _seed_timeline_scenario(db)

    res = client.get("/api/stats/timeline?days=90")
    assert res.status_code == 200
    body = res.json()

    # lags are 2 days and 4 days -> median 3.0
    assert body["rating_lag_days"] == 3.0


def test_timeline_respects_days_window(client, db):
    _seed_timeline_scenario(db)

    # Window of 1 day should exclude everything (seeded 10 days ago).
    res = client.get("/api/stats/timeline?days=1")
    assert res.status_code == 200
    body = res.json()
    assert body["watch_counts"] == []
    assert body["rating_counts"] == []
    assert body["busiest_day"] is None
    # rating_lag_days is computed globally (not windowed) per the implementation;
    # still reflects the seeded pairs regardless of the days filter.
    assert body["rating_lag_days"] == 3.0


def test_timeline_no_data(client, db):
    res = client.get("/api/stats/timeline?days=90")
    assert res.status_code == 200
    body = res.json()
    assert body["watch_counts"] == []
    assert body["rating_counts"] == []
    assert body["busiest_day"] is None
    assert body["rating_lag_days"] is None
