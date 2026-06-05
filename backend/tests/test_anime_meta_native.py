import pytest

from app.search.anime_meta import (
    _anilist_synthetic_videos,
    default_video_id,
    episodes_for_season,
    meta_to_search_result,
    seasons_from_meta,
)


def test_default_video_id_kitsu_absolute_episode():
    meta = {
        "videos": [
            {"id": "kitsu:7442:1", "season": 1, "episode": 1},
            {"id": "kitsu:7442:2", "season": 1, "episode": 2},
        ]
    }
    assert default_video_id(meta, "kitsu:7442", 1, 2) == "kitsu:7442:2"
    assert default_video_id(meta, "kitsu:7442", 1, 99) == "kitsu:7442:99"


def test_anilist_synthetic_videos():
    vids = _anilist_synthetic_videos(21, 3)
    assert len(vids) == 3
    assert vids[0]["id"] == "anilist:21:1"


@pytest.mark.network
def test_fetch_kitsu_meta_integration():
    import asyncio

    from app.search.anime_meta import fetch_stremio_meta

    meta = asyncio.run(fetch_stremio_meta("kitsu:7442", "anime"))
    assert meta is not None
    assert meta.get("name")
    assert len(meta.get("videos") or []) >= 1
    assert meta["videos"][0]["id"].startswith("kitsu:7442:")
    row = meta_to_search_result(meta, "kitsu:7442")
    assert row["anime_native"] is True
    seasons = seasons_from_meta(meta)
    eps = episodes_for_season(meta, seasons[0]["season_number"])
    assert eps[0]["video_stremio_id"]
