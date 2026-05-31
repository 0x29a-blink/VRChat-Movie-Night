from app.downloads.iso_extract import _looks_like_game_installer
from app.downloads.manager import (
    _ext_from_url_or_hint,
    _is_disc_image,
    _probe_download_kind,
    _suffix_from_name,
)


def test_disc_image_detection():
    assert _is_disc_image("tn-thebackrooms.iso")
    assert not _is_disc_image("movie.mkv")
    assert _suffix_from_name("Backrooms [1080p].mkv") == ".mkv"


def test_probe_prefers_direct_for_iso_hint():
    assert (
        _probe_download_kind(
            "https://cdn.example.com/signed/file",
            "",
            "tn-thebackrooms.iso",
        )
        == "direct"
    )


def test_ext_from_hint_preserves_iso():
    assert _ext_from_url_or_hint({}, "https://x/y", "tn-thebackrooms.iso") == ".iso"


def test_game_iso_detected():
    rel = [
        "TiNYiSO/Backrooms_Data/Plugins/steam_api.dll",
        "setup.exe",
        "tinyiso.bin",
        "autorun.inf",
    ]
    assert _looks_like_game_installer(rel)
