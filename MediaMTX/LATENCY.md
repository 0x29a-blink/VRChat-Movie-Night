# MediaMTX latency tuning (VRChat Movie Night)

Your friends watch `http://<host>:8888/live/vrstream/index.m3u8` in a VRChat world player. Delay is the sum of several hops — not only MediaMTX.

```text
OBS encode + buffer → RTMP → MediaMTX HLS segments → VRChat AVPro buffer → picture
```

## What we changed in `mediamtx.yml`

| Setting | Before | Now | Why |
|---------|--------|-----|-----|
| `hlsSegmentDuration` | **4s** | **1s** | Biggest fix. Standard HLS clients buffer ~3 segments → was often **12s+** from packaging alone. |
| `hlsAlwaysRemux` | false | **true** | HLS muxer runs while OBS is live; first viewer avoids “wait for generation”. |
| `hlsSegmentCount` | 7 | **4** | Shorter DVR on the server (optional rewind), slightly leaner playlist. |
| `hlsVariant` | mpegts | **mpegts** (unchanged) | Best compatibility with VRChat; **lowLatency** LL-HLS often has **no audio on PC**. |

**Restart MediaMTX** after editing (`start-stack.cmd` or restart the MediaMTX process).

**Settings → MediaMTX HLS presets** (admin) applies the same values live via the Control API and updates `mediamtx.yml` on disk. Use **Compatibility** if viewers on slow internet stutter after 1s segments.

## OBS (match MediaMTX)

In **Settings → Stream quality** encoder presets we use `keyint_sec: 2`. In OBS encoder settings set **Keyframe interval ≈ 2 s** so each HLS segment can start on a keyframe. If keyframes are every 10s, MediaMTX may stretch segments and latency stays high.

Also reduce **GPU buffering** where possible; NVENC “lookahead” adds delay — disable for lowest latency.

## VRChat (often the rest of the delay)

Community reports (varies by world / AVPro version):

| Platform | Typical HLS delay |
|----------|-------------------|
| Quest / Android | ~1–3 s (after server tuning) |
| **PC** | Often **much higher** (10–35+ s) — AVPro / Media Foundation buffering |

So after MediaMTX is tuned, remaining lag on **PC** may be the world player, not your server. Test with the same URL on Quest or phone if possible.

World authors should enable **low latency** options on the AVPro player prefab when available.

## Optional: `lowLatency` (LL-HLS) — experimental for VRChat

```yaml
hlsVariant: lowLatency
hlsPartDuration: 200ms
hlsSegmentDuration: 1s
```

Can shave server-side delay further but **may break PC VRChat** (missing audio, black screen). Try in a test world before movie night.

## Optional: RTSP instead of HLS

MediaMTX also serves **RTSP** (e.g. `rtsp://host:8554/live/vrstream`). Some VRChat setups report lower delay with RTSP than HLS, but support is world- and platform-specific. HLS on port 8888 remains the default documented path.

## Realistic targets

| Goal | Approach |
|------|----------|
| **Good enough movie night** | 1s mpegts segments + `hlsAlwaysRemux` + OBS keyint 2s (current repo defaults) |
| **Lowest MediaMTX delay** | LL-HLS variant (test VRChat first) |
| **Lowest end-to-end** | RTSP-capable world + tuned OBS; or accept Quest-like clients fare better than PC |

## Verify

1. Put a clock in OBS on the stream.
2. Open the HLS URL in **VLC** on another device — compare delay to OBS.
3. Open the same URL in VRChat — if VRChat is much worse than VLC, focus on the world player / PC client.

If VLC is already many seconds behind OBS, tune OBS keyframes and segment duration further. If VLC is close but VRChat is not, MediaMTX is fine.
