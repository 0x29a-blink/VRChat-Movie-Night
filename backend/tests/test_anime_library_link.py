import asyncio

from app.library.linking import apply_anime_link
from app.library.matching import find_library_by_stremio
from app.models import LibraryItem


def test_find_library_by_stremio_filename_fallback(db, tmp_path):
    lib = LibraryItem(
        path=str(tmp_path / "Attack on Titan S01E02 [1080p].mkv"),
        filename="Attack on Titan S01E02 [1080p].mkv",
        title="Attack on Titan S1E2 [1080p]",
        folder="torrents",
        size=1,
    )
    (tmp_path / lib.filename).write_bytes(b"x")
    db.add(lib)
    db.commit()

    found = find_library_by_stremio(db, "kitsu:7442", 1, 2)
    assert found is not None
    assert found.id == lib.id


def test_apply_anime_link_sets_stremio(db, tmp_path):
    lib = LibraryItem(
        path=str(tmp_path / "show.mkv"),
        filename="show.mkv",
        title="Downloaded",
        folder="torrents",
        size=1,
    )
    (tmp_path / "show.mkv").write_bytes(b"x")
    db.add(lib)
    db.commit()

    asyncio.run(
        apply_anime_link(
            db,
            lib,
            stremio_id="kitsu:7442",
            series_title="Attack on Titan",
            season=1,
            episode=2,
        )
    )
    db.commit()
    db.refresh(lib)
    assert lib.stremio_id == "kitsu:7442"
    assert lib.season == 1
    assert lib.episode == 2
    assert "Attack" in (lib.tmdb_title or lib.display_title())
