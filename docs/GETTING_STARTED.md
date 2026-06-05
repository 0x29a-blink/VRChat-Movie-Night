# Getting started (first movie night)

This guide is for someone setting up the project for the first time on Windows. Daily use after setup is mostly `start-stack.cmd` and the web UI.

## Quick path

| Step | What to run / do |
|------|------------------|
| 1 | Copy `backend\.env.example` → `backend\.env` — set `SECRET_KEY`, `OBS_PASSWORD`, and `APP_PASSWORD` |
| 2 | Install [OBS](https://obsproject.com/) 28+, enable **WebSocket** (port 4455) |
| 3 | Install **MediaMTX** (`scoop install mediamtx` or put `mediamtx.exe` in `MediaMTX\`) |
| 4 | Run **`startup.cmd`** — menu option **2** downloads yt-dlp/ffmpeg/ffprobe into `tools\` (optional but helpful) |
| 5 | Run **`AIOStreams\setup-aiostreams.cmd`** if you want torrent search (Node 24+, Git, pnpm) |
| 6 | In AIOStreams configure UI, add **TorBox**; in Movie Night **Settings**, paste TorBox key |
| 7 | **`startup.cmd`** → **3** builds the web UI (`frontend\dist`) |
| 8 | **`start-stack.cmd`** — MediaMTX + API + AIOStreams in one window |
| 9 | Open **http://localhost:8000**, sign in, open **Movie Night** tab until checklist is green |
| 10 | OBS: scene with media source **VRStream**, stream to `rtmp://localhost:1935/live` key `vrstream`, then **Go live** in the app |

See `scripts\STARTUP.txt` for which `.cmd` file does what.

## Accounts

- First login uses `APP_PASSWORD` from `.env` (bootstrap admin).
- Create a login for each friend under **Settings → Users**, then change the admin password.

## VRChat HLS URL

Friends watch:

`http://<your-lan-ip>:8888/live/vrstream/index.m3u8`

Set **Public / LAN IP** in Settings if auto-detect is wrong. Open port **8888** (and **8000** for the web app) on your firewall for remote guests.

## Troubleshooting

- **Red dot on Movie Night** — OBS offline, MediaMTX not running, or a tool missing. Run `startup.cmd` option **1** for checks.
- **Closed the stack window but HLS still works / port stuck** — run `stop-stack.cmd`.
- **UI is blank or old** — run `build-frontend.cmd`, then restart `start-stack.cmd`.
- **No torrent streams** — self-host AIOStreams; public instances disable Torrentio.

## Contributing / CI

Backend tests use an in-memory database (no `backend\data\app.db` required). From `backend\`:

```bash
pip install -r requirements.txt -r requirements-dev.txt
SECRET_KEY=test APP_PASSWORD=test pytest -q -m "not network"
```

Network-marked tests (`pytest -m network`) call live APIs and are skipped in GitHub Actions.
