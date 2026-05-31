from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# app/config.py -> app -> backend -> project root
BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Auth
    app_password: str = "changeme"
    secret_key: str = "please-change-this-to-a-long-random-string"

    # OBS WebSocket
    obs_host: str = "localhost"
    obs_port: int = 4455
    obs_password: str = ""
    obs_media_input: str = "VRStream"
    obs_scene: str = ""

    # Metadata / search
    tmdb_api_key: str = ""
    aiostreams_base: str = ""
    torbox_api_key: str = ""

    # Downloads
    max_concurrent_downloads: int = 2
    use_deno: bool = True
    skip_small: int = 5
    skip_large: int = 10

    # Queue / OBS playback
    queue_loop: bool = True
    obs_media_volume: float = 1.0

    # Tool paths
    ytdlp_path: str = "yt-dlp"
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    aria2c_path: str = "aria2c"

    # Filesystem
    library_root: str = str(PROJECT_ROOT / "library")
    data_dir: str = str(BACKEND_DIR / "data")

    @property
    def library_path(self) -> Path:
        return Path(self.library_root)

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir)

    @property
    def thumbnails_path(self) -> Path:
        return self.data_path / "thumbnails"

    def folder_for(self, kind: str) -> Path:
        mapping = {
            "youtube": self.library_path / "youtube",
            "m3u8": self.library_path / "m3u8",
            "torrent": self.library_path / "torrents",
        }
        return mapping.get(kind, self.library_path / "torrents")


settings = Settings()

# Ensure folders exist
for _p in (
    settings.data_path,
    settings.thumbnails_path,
    settings.library_path / "youtube",
    settings.library_path / "m3u8",
    settings.library_path / "torrents",
):
    _p.mkdir(parents=True, exist_ok=True)
