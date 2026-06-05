# VRChat Movie Night

[![CI](https://github.com/0x29a-blink/VRChat-Movie-Night/actions/workflows/ci.yml/badge.svg)](https://github.com/0x29a-blink/VRChat-Movie-Night/actions/workflows/ci.yml)

**New here?** See **[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** for a first-time checklist, then use **`startup.cmd`** (setup menu) and **`start-stack.cmd`** (daily stack).

A password-protected local web app for running VRChat movie nights with your friend group:

- **Download** videos at max quality from three sources:
  - **YouTube** (and anything yt-dlp supports)
  - **M3U8 / HLS** stream URLs (paste on Downloads, Search, or Watchlist streams)
  - **Movies & Shows** via TMDB search → AIOStreams (TorBox) with quality filters
- Live **progress bars, speeds, ETA**, plus cancel / restart on every download.
- A **Library** of everything you've downloaded (auto thumbnails + durations), split into
`youtube`, `m3u8`, and `torrents` folders. Link library files to TMDB for posters and metadata.
- A **Watchlist** shared across your group: movies, series, episodes, ratings, comments, and
per-user “watched” checkoffs. Organize titles into **groups** (e.g. “Horror month”).
- **Stats** tab: group favorites, perfect scores, divisive picks, leaderboard, episode progress
for series, and filters by watchlist group.
- A drag-to-reorder **Queue** and a **player** that drives OBS: play / pause, next / previous,
seek, and +/- 5s / 10s skips. Auto-advances to the next video when one ends.
- **Multi-user auth**: admin creates accounts for each friend; everyone signs in with their own password.

When a torrent or M3U8 download is started from Search or the Watchlist streams modal with TMDB
metadata attached, the finished file is **auto-linked** to that title in the library and watchlist.

Playback works by controlling an **OBS Media Source** over obs-websocket. OBS keeps a single
continuous stream alive to MediaMTX, so the feed your friends watch in VRChat
(`http://<your-ip>:8888/live/vrstream/index.m3u8`) never drops between videos.

```
Webapp ──(obs-websocket :4455)──> OBS ──(RTMP :1935)──> MediaMTX ──(HLS :8888)──> VRChat screen
```

## Requirements

- **Python 3.10+** (for the web app)
- **OBS 28+** with WebSocket enabled (port `4455`) — playback + RTMP stream
- **Node.js + npm** — build the web UI once; optional for AIOStreams torrent search
- **yt-dlp, ffmpeg, ffprobe** — install on PATH **or** bundle into `tools\` (see below)
- **MediaMTX** — `MediaMTX\mediamtx.exe` or `scoop install mediamtx` (HLS tuned for lower delay — see `MediaMTX/LATENCY.md`)
- `deno` is **optional** (`USE_DENO=false` in `.env` if missing)
- `aria2c` is **optional** (not required; downloads use yt-dlp's native downloader)

### Bundled tools (recommended)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\fetch-tools.ps1
```

Or use **`startup.cmd`** → option 2. Binaries go in `tools\` and `MediaMTX\`; the app picks them up automatically.
- **AIOStreams (self-hosted, recommended for torrent search):** Node.js **24+**, Git, and pnpm 11 (installed automatically by setup script). Public instances disable Torrentio and built-in search addons; your own instance unlocks them.

## First-time setup

1. Configure the backend:
  - Copy `backend\.env.example` to `backend\.env` if needed.
  - **Change `SECRET_KEY`** to a long random string.
  - **Change OBS WebSocket password** in both OBS and `.env` (do not leave defaults).
  - On first run, `bootstrap.py` creates an admin user from `APP_PASSWORD` — sign in, then create
  accounts for friends on **Settings → Users** and change the admin password.
  - Paste your **TMDB API key** if it isn't picked up from your environment.
2. **Self-host AIOStreams from source** (recommended — unlocks Torrentio, built-in indexers, no public rate limits):
   ```
   AIOStreams\setup-aiostreams.cmd
   ```
   This clones [Viren070/AIOStreams](https://github.com/Viren070/AIOStreams), runs `pnpm install`, `pnpm run build`, and creates `AIOStreams\.env` with a generated `SECRET_KEY`. Requires Node.js 24+ and Git on PATH.

   Start the addon (or use `start-stack.cmd`, which launches it automatically once built):
   ```
   AIOStreams\start-aiostreams.cmd
   ```
   Open **[http://localhost:3000/stremio/configure](http://localhost:3000/stremio/configure)** → enable marketplace addons and built-ins (Knaben, Zilean, Torrentio, etc.) → add your **TorBox** API key → save.

   Copy your Stremio manifest URL, remove `/manifest.json`, and paste into **Settings → AIOStreams base URL** (e.g. `http://localhost:3000/stremio/<your-config-id>`). **Or leave that field blank** — Movie Night auto-detects it from your local `AIOStreams\` install (reads `BASE_URL` + the saved configure UUID from SQLite). The same TorBox key goes in Movie Night Settings for cache-and-download.

   To update after upstream releases: re-run `AIOStreams\setup-aiostreams.cmd` (pulls latest, rebuilds). Do not change `SECRET_KEY` in `AIOStreams\.env` or existing addon configs become unreadable.

   Upstream docs: [Deployment from source](https://docs.aiostreams.viren070.me/getting-started/deployment/#from-source)
3. Build the frontend (once, and after any UI change):
  ```
   build-frontend.cmd
  ```
4. Start everything:
  ```
   start-stack.cmd
  ```
   One console: MediaMTX + optional AIOStreams + API (prefixed logs). Closing the window or Ctrl+C stops all services. If MediaMTX ever lingers in the background, run `stop-stack.cmd`. Setup menu: `startup.cmd`.
5. Open **[http://localhost:8000](http://localhost:8000)** (or `http://<your-ip>:8000` from another machine) and sign in.
6. Open the **Movie Night** sidebar tab and confirm the checklist is green before guests arrive.

### Firewall ports (if friends connect from other PCs)


| Port | Service                                              |
| ---- | ---------------------------------------------------- |
| 8000 | Web app + API                                        |
| 3000 | AIOStreams (self-hosted torrent search; optional)    |
| 8888 | MediaMTX HLS (VRChat stream URL)                     |
| 1935 | RTMP ingest (OBS → MediaMTX, usually localhost only) |
| 4455 | OBS WebSocket (usually localhost only)               |


### OBS setup (one time)

1. Create a scene with a **Media Source** named exactly **`VRStream`**
  (or change the name on the Settings page). Leave the file blank — the app sets it.
2. Settings → Stream → Service `Custom`, Server `rtmp://localhost:1935/live`,
  Stream Key `vrstream` (so the HLS URL is `.../live/vrstream/index.m3u8`).
3. Enable Tools → WebSocket Server (port `4455`, password matching `.env`).
4. In the app **Settings → OBS**, click **Test connection**, then **Apply stream defaults** if offered
   (sets Custom RTMP `rtmp://localhost:1935/live` / key `vrstream` and can create the `VRStream` media source).
5. In **Queue & Player**, click **Go live**, then play from your queue. Keep OBS streaming the whole session.

## Daily use

- `start-stack.cmd` → open the site → sign in → check **Movie Night** tab.
- `stop-stack.cmd` → kill stray MediaMTX/AIOStreams if a stack window was closed with X.
- A red dot on **Movie Night** in the sidebar means something needs attention (OBS offline, MediaMTX
down, missing tools, etc.). HLS inactive before Go live is normal and does not trigger the dot.
- **Get Videos** tab: paste a YouTube/M3U8 link, or search a movie/show and pick a stream.
- **Watchlist** tab: track what the group wants to watch, rate, comment, mark watched; open
**Streams** to grab torrents or paste M3U8. Rows show **In library** when a file is linked.
- **Library** tab: play now, add to queue, link/unlink TMDB metadata.
- **Stats** tab: group overview and ranked lists; filter by watchlist group.
- **Queue & Player** tab: reorder by dragging, then drive playback.

Deleting a library file removes the file and library row only — watchlist history, ratings, and
comments stay. The watchlist row clears its library link so Play/Streams no longer imply the file exists.

## Development mode (hot reload)

```
run-dev.cmd
```

Opens the API (`:8000`, `--reload`) and the Vite dev server (`:5173`). Use
**[http://localhost:5173](http://localhost:5173)** for the UI; Vite proxies `/api` and `/ws` to the backend.
You still need MediaMTX for HLS tests (`start-stack.cmd` or `mediamtx.cmd` for MediaMTX alone).

## Project structure

```
media_server_player/
  backend/            FastAPI app
    app/
      main.py         app wiring, WebSocket hub, static serving
      auth.py         multi-user session auth (admin + members)
      config.py       .env config
      settings_store.py  runtime-editable settings (DB-backed)
      tool_checks.py  yt-dlp/ffmpeg/ffprobe/deno preflight probes
      downloads/      yt-dlp download manager (progress/cancel/restart, TMDB auto-link)
      search/         TMDB + AIOStreams + stream metadata parsing
      library/        folder scanner, TMDB linking
      obs/            obs-websocket controller (playback engine)
      playqueue/      queue + player state
      routers/        REST endpoints (watchlist, stats, backup, health, …)
    .env              your secrets
    requirements.txt
  frontend/           React + Vite + Tailwind UI
  library/            youtube/  m3u8/  torrents/   (downloaded files)
  MediaMTX/           MediaMTX config (install mediamtx via scoop or releases locally)
  AIOStreams/         Self-hosted AIOStreams from source (setup-aiostreams.cmd)
  start-stack.cmd       Full stack (primary)
  stop-stack.cmd        Stop leftover MediaMTX / stack children
  startup.cmd           Setup menu (checks, tools, build UI)
  api-backend.cmd       API only (no MediaMTX)
  mediamtx.cmd          MediaMTX only (debug)
  scripts/              api-only, dev, preflight, stop-stack
  build-frontend.cmd    run-dev.cmd
  yt_downloader/      legacy clipboard helper (see below)
```

### Legacy: `yt_downloader/download.cmd`

This folder is **not part of the web app**. It is an old standalone helper from before Movie Night existed:

1. Copy a YouTube URL to your clipboard.
2. Double-click `yt_downloader/download.cmd`.
3. It reads the clipboard and runs `yt-dlp` into the current folder (uploader + title filename).

Use **Get Videos** in the web app instead — downloads go into `library/youtube/`, show progress, and appear in the Library automatically. Keep `yt_downloader/` only if you still want a quick one-off clip without starting the server.

## Notes

- Downloads cannot be resumed (by design) — only cancelled and restarted from scratch.
- The Settings page edits OBS connection, TMDB key, AIOStreams base, concurrency, skip
amounts, HLS public host, and user accounts live (no restart needed).
- Set **Public / LAN IP** in Settings if friends connect over the internet and auto-detect picks
the wrong address for the VRChat HLS URL.
- Admins can **export a JSON backup** (Settings → Backup) of watchlist data, ratings, and settings.
- AIOStreams returns thousands of streams; use the filter sidebar (resolution, codec, max
size, cached-only) to find the best one fast. Self-hosting (`AIOStreams\setup-aiostreams.cmd`) enables Torrentio and built-in indexers that public instances disable.
- WebSocket events refresh the library and watchlist when downloads finish or library items change;
  toasts notify when linked downloads complete. The sidebar shows live-update connection status.
- Run `build-frontend.cmd` before `api-backend.cmd` or `start-stack.cmd` in production — `frontend/dist/` is not committed; CI builds it on push.
- CI runs on every push/PR to `main` (backend pytest, frontend typecheck/build). Tests do not need a local `backend/data/app.db`.

## Legal notice

Self-hosted personal media server for private watch parties. This project does not ship torrent
files, magnet indexes, or debrid credentials. Torrent-related features require your own
[TorBox](https://torbox.app) API key and [AIOStreams](https://github.com/Viren070/AIOStreams)
(or compatible) manifest. Users are responsible for complying with copyright and local law and
may only download or stream content they have the right to access.