# Bundled tools (optional)

Place Windows binaries here so Movie Night does not rely on PATH or separate installs.

| File | Purpose |
|------|---------|
| `yt-dlp.exe` | YouTube / stream downloads |
| `ffmpeg.exe` | Remux, thumbnails, M3U8 |
| `ffprobe.exe` | Media metadata |

**MediaMTX** stays in `MediaMTX\mediamtx.exe` (not this folder).

## Quick setup

From the project root in PowerShell:

```powershell
.\scripts\fetch-tools.ps1
```

Or download manually:

- [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) → `yt-dlp.exe`
- [ffmpeg builds (gyan.dev)](https://www.gyan.dev/ffmpeg/builds/) → Essentials zip → copy `ffmpeg.exe` and `ffprobe.exe` from `bin/`
- [MediaMTX releases](https://github.com/bluenviron/mediamtx/releases) → `mediamtx.exe` into `MediaMTX\`

The app picks bundled files automatically when `.env` uses the default tool names (`yt-dlp`, `ffmpeg`, `ffprobe`).
