from app.routers.watchlist_routes import ItemCreate, _episode_row_title, _series_title_from_payload


def test_series_title_from_em_dash_episode_display():
    body = ItemCreate(
        kind="episode",
        title="Attack on Titan — Wall: Assault on Stohess (3)",
        season=1,
        episode=25,
    )
    assert _series_title_from_payload(body) == "Attack on Titan"


def test_series_title_from_sxxexx():
    body = ItemCreate(
        kind="episode",
        title="Attack on Titan S01E25 — Wall",
        series_title="Attack on Titan",
        season=1,
        episode=25,
    )
    assert _series_title_from_payload(body) == "Attack on Titan"


def test_episode_row_title_uses_name():
    body = ItemCreate(kind="episode", title="25. Wall: Assault on Stohess (3)", season=1, episode=25)
    assert _episode_row_title(body, 1, 25) == "25. Wall: Assault on Stohess (3)"
