from app.search.anime_meta import (
    episodes_for_season,
    is_anime_stremio_id,
    meta_to_search_result,
    seasons_from_meta,
    sort_catalogs_for_display,
)


def test_is_anime_stremio_id():
    assert is_anime_stremio_id("kitsu:42")
    assert is_anime_stremio_id("mal:1")
    assert not is_anime_stremio_id("tt1234567")


def test_seasons_from_meta_videos():
    meta = {
        "name": "Test Anime",
        "videos": [
            {"id": "kitsu:1:1", "season": 1, "episode": 1, "title": "Ep 1"},
            {"id": "kitsu:1:2", "season": 1, "episode": 2, "title": "Ep 2"},
            {"id": "kitsu:1:3", "season": 2, "episode": 1, "title": "S2 Ep 1"},
        ],
    }
    seasons = seasons_from_meta(meta)
    assert len(seasons) == 2
    assert seasons[0]["episode_count"] == 2
    eps = episodes_for_season(meta, 1)
    assert len(eps) == 2
    assert eps[0]["video_stremio_id"] == "kitsu:1:1"


def test_meta_to_search_result_anime_native():
    row = meta_to_search_result({"name": "Show", "releaseInfo": "2020"}, "kitsu:9")
    assert row["anime_native"] is True
    assert row["stremio_id"] == "kitsu:9"
    assert row["tmdb_id"] == 0


def test_sort_catalogs_pins_anime():
    catalogs = [
        {"type": "movie", "id": "popular", "name": "Popular"},
        {"type": "anime", "id": "kitsu-trending", "name": "Trending"},
        {"type": "series", "id": "mal-top", "name": "MAL Top"},
    ]
    sorted_c = sort_catalogs_for_display(catalogs)
    assert sorted_c[0]["type"] == "anime"
