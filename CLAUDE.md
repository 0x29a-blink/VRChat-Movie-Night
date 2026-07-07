# VRChat Movie Night — agent notes

Self-hosted Windows web app that drives VRChat movie nights: Webapp →
obs-websocket(4455) → OBS → RTMP(1935) → MediaMTX → HLS(8888) → VRChat.

## Commands

| Purpose | Command | Notes |
|---|---|---|
| Backend tests | `cd backend && pytest -q -m "not network"` | 195 passed, 1 known-failing (see Gotchas) |
| Backend lint | `cd backend && ruff check .` | if bare `ruff` isn't on PATH: `./.venv/Scripts/python.exe -m ruff check .` |
| Frontend build | `cd frontend && npm run build` | tsc -b && vite build |
| Frontend lint | `cd frontend && npm run lint` | eslint, `--max-warnings 60` |
| Frontend tests | `cd frontend && npm test` | vitest, 93+ tests |
| Dev (backend+frontend) | `run-dev.cmd` | launches servers — documented, not auto-run by agents |
| Full stack (+ OBS/MediaMTX) | `start-stack.cmd` | launches servers — documented, not auto-run by agents |

## Layout

`backend/app/`:
- `main.py` — FastAPI app; `lifespan()` starts DB, WS hub, download manager, player poller; `include_router` wires 17 routers
- `routers/` — 17 route modules (auth, backup, browse, downloads, health, library, mediamtx, obs, player, queue, search, settings, stats, stream, torbox, users, watchlist)
- `auth.py` — signed-cookie sessions, admin/member roles, `session_version` invalidation
- `settings_store.py` — runtime settings persisted in DB (env fallback in `config.py`)
- `downloads/manager.py` — yt-dlp/ffmpeg subprocesses, TorBox cache flows
- `playqueue/manager.py`, `obs/controller.py` — queue playback + OBS control
- `ws.py` — WS hub; broadcasts `download_update` / `queue_update` / `player_update` / `library_update` / `player_warning` etc.
- `models.py`, `db.py` — SQLAlchemy models, engine/session setup, `_migrate_schema()`

`frontend/src/`:
- `App.tsx` — tab-based SPA shell; lazy-loads each tab, lifts session/player/
  preflight state, renders the persistent `SessionStrip` above the shell
- `api.ts` — REST client
- `appRealtime.ts`, `ws.ts` — realtime/WebSocket hooks
- `appNav.ts` — URL nav state; `AppTab` union (`tonight` is default/home) plus
  a legacy-alias contract so old links keep working: `downloads`→`add`,
  `queue`→`tonight`, `checklist`→`tonight`; Add Media sub-sources use
  `?sub=` (+ `?src=` for Browse's inner Collections|AIOStreams choice), with
  legacy `sub=catalogs/collections/anime` mapping into the merged `browse`
- `capabilities.ts` — shared `canControlPlayer(user)` capability check
- `theme.ts` / `themeColors.ts` — runtime theme system. Four CSS themes
  (Velvet default + Graphite/Ember/Projector) live as `<html data-theme>`
  variable sets in `index.css`; ten more presets plus a user **Custom** theme
  are *derived* — `themeColors.deriveThemeVars(accent, surface)` expands an
  accent+surface hex pair into the full token set, injected as inline vars on
  `<html>` (which override the CSS themes; cleared when switching back to a
  CSS theme). Persisted in localStorage (`mn_theme`, `mn_theme_custom`),
  picked in Settings → Appearance. Tailwind palette (`tailwind.config.js`)
  resolves entirely to those variables — including the overridden `slate`
  scale (themed text) and `accent` aliasing `brand`
- `stripVisibility.ts`, `libraryView.ts` — pure helpers backing the strip and
  Library search/sort/state-filters, unit-tested without mounting components
- `swrCache.ts`, `watchlistCache.ts` — session-scoped stale-while-revalidate
  cache seeding Watchlist/Stats tabs; cleared on logout
- `types.ts` — shared TS types
- `components/` — 34 UI components, notably:
  - `Tonight.tsx` — default home tab: readiness summary, session cockpit
    (transport, queue, activity feed), pre-show checklist
  - `SessionStrip.tsx` — slim bottom strip on every other tab when a session
    is active or media is playing; now-playing + transport + tap-to-Tonight
  - `KebabMenu.tsx` — shared "⋯" overflow menu (portaled, keyboard/focus
    aware); used by Watchlist rows, `DownloadJobCard`, Library cards, and
    Tonight queue rows (touch)
  - `TabSkeleton.tsx` — per-tab loading skeleton shown while a lazy chunk loads
  - Browse, Search, Library, Downloads, Watchlist, Stats, SettingsPage, etc.
- `__tests__/` — vitest specs for pure-logic modules

## Conventions

- Routers gate access with FastAPI `Depends(auth.require_auth)` or `require_admin` at the router/route level.
- Runtime-editable settings go through `settings_store.py` (DB-backed); static/env-only config goes through `config.py`.
- WS events are named `<domain>_update` (`download_update`, `queue_update`, `player_update`, `library_update`) plus `player_warning`.
- Frontend error handling: `catch (err: unknown)` + `instanceof Error`; user-facing errors surface via the `useToast` hook.

## Gotchas

- Repo path contains spaces (`D:\games\vrc shit\...`) — always quote it in shell commands.
- Windows-first: `taskkill`, `.cmd` launchers, `CREATE_NO_WINDOW` subprocess flags.
- `AIOStreams/repo/` (vendored clone) and `cloudflare/.env` (and sibling credential files) are gitignored — never commit or lint them.
- `backend/tests/conftest.py` rebinds `SessionLocal` into a fixed list of already-imported modules (`_SESSIONLOCAL_MODULES`) for the in-memory test DB. Any new module that does `from ..db import SessionLocal` must be added to that tuple or it will silently use the real engine in tests.
- SQLite runs in WAL mode (`PRAGMA journal_mode = WAL` in `backend/app/db.py`) — `backend/data/app.db-wal` / `-shm` sidecar files are normal; a backup must checkpoint WAL first or copy all three files together, not just `app.db`.
- `test_preflight_authenticated` can fail locally if `.env` points `hls_url` at an `https://` tunnel base instead of a plain `http://` LAN address — the test asserts `http://`; this is an environmental mismatch, not a regression.
- `frontend/dist/` is a build artifact, not committed.
- The working tree routinely carries WIP from the maintainer — never `git add -A` or stage/commit unrelated files.
- `plans/` holds executor plans for in-flight work; status is tracked in `plans/README.md`.
