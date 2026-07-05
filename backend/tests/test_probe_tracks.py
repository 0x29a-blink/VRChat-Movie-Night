"""ffprobe track probing (FFmpeg 8+ compatibility)."""


from app.config import settings
from app.library.playback import probe_media_tracks


def test_probe_attack_on_titan_sample_if_present():
    lib = settings.library_path / "torrents"
    candidates = list(lib.glob("Attack on Titan*.mkv"))
    if not candidates:
        return
    result = probe_media_tracks(candidates[0])
    assert not result.get("error"), result.get("error")
    assert len(result["audio"]) >= 1
