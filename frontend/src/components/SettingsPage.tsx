import { CheckCircle2, Copy, Download, Loader2, Save, Trash2, Upload, UserPlus, Wifi, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { buildHlsUrl, copyHlsUrl, resolveHlsUrl } from "../hlsUrl";
import type { Settings, UserInfo } from "../types";
import { ConfirmModal, PromptModal } from "./ConfirmModal";
import { useToast } from "./Toast";

function UsersAdmin() {
  const { push: pushToast } = useToast();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [createdPw, setCreatedPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserInfo | null>(null);
  const [resetTarget, setResetTarget] = useState<UserInfo | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .listUsers()
      .then((r) => setUsers(r.users))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    setCreatedPw("");
    try {
      const r = await api.createUser(username.trim(), password, role);
      setCreatedPw(r.password);
      setUsername("");
      setPassword("");
      load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    await api.deleteUser(deleteTarget.id);
    setDeleteTarget(null);
    load();
    pushToast("User deleted", "info");
  };

  const confirmReset = async () => {
    if (!resetTarget || !resetPw.trim()) return;
    setResetBusy(true);
    try {
      const r = await api.resetUserPassword(resetTarget.id, resetPw.trim());
      setCreatedPw(`Reset password: ${r.password}`);
      setResetTarget(null);
      setResetPw("");
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <Section title="Users (admin)">
      <p className="text-xs text-slate-500">Create accounts for your friend group. Password is shown once after create/reset.</p>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm">
              <span>
                {u.username} <span className="chip ml-1 bg-white/5 text-slate-400">{u.role}</span>
              </span>
              <span className="flex gap-2">
                <button type="button" onClick={() => { setResetTarget(u); setResetPw(""); }} className="btn-ghost px-2 text-xs">
                  Reset password
                </button>
                <button type="button" onClick={() => setDeleteTarget(u)} className="btn-ghost px-2 text-red-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <Field label="Username">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Password">
          <input
            type="text"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Generate or type"
          />
        </Field>
      </div>
      <Field label="Role">
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </Field>
      <button type="button" onClick={create} disabled={busy || !username || !password} className="btn-primary">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create user
      </button>
      {createdPw && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          <Copy className="h-4 w-4 shrink-0" />
          <span className="break-all">{createdPw}</span>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete user?"
        message={deleteTarget ? <>Remove account {deleteTarget.username}?</> : null}
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setDeleteTarget(null)}
      />

      <PromptModal
        open={!!resetTarget}
        title="Reset password"
        message={resetTarget ? <>New password for {resetTarget.username}</> : undefined}
        value={resetPw}
        onChange={setResetPw}
        confirmLabel="Reset"
        busy={resetBusy}
        onConfirm={confirmReset}
        onCancel={() => { setResetTarget(null); setResetPw(""); }}
      />
    </Section>
  );
}

function BackupAdmin() {
  const { push: pushToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmImport, setConfirmImport] = useState(false);
  const [pendingImport, setPendingImport] = useState<unknown>(null);

  const exportBackup = async () => {
    setBusy(true);
    setError("");
    try {
      await api.exportBackup();
      pushToast("Backup downloaded", "success");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const pickImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        setPendingImport(JSON.parse(text));
        setConfirmImport(true);
      } catch {
        pushToast("Invalid backup file", "error");
      }
    };
    input.click();
  };

  const runImport = async () => {
    if (!pendingImport) return;
    setImportBusy(true);
    setError("");
    try {
      const r = await api.importBackup(pendingImport);
      pushToast(
        `Restored ${r.items} watchlist items, ${r.groups} groups, ${r.ratings} ratings`,
        "success"
      );
      setConfirmImport(false);
      setPendingImport(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <Section title="Backup (admin)">
      <p className="text-xs text-slate-500">
        Export or restore watchlist, ratings, comments, groups, and settings. Video files are not included.
        Import replaces all watchlist data (library files on disk are kept).
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={exportBackup} disabled={busy} className="btn-ghost text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export backup
        </button>
        <button type="button" onClick={pickImport} disabled={importBusy} className="btn-ghost text-sm">
          {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Import backup
        </button>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}

      <ConfirmModal
        open={confirmImport}
        title="Import backup?"
        message="This replaces all watchlist groups, titles, ratings, comments, and wheel presets. User accounts and library files on disk are not removed."
        confirmLabel="Import"
        danger
        busy={importBusy}
        onConfirm={runImport}
        onCancel={() => { setConfirmImport(false); setPendingImport(null); }}
      />
    </Section>
  );
}

export function SettingsPage({ user }: { user: UserInfo }) {
  const { push: pushToast } = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [displayHlsUrl, setDisplayHlsUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ connected: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const [pw, setPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  useEffect(() => {
    api.getSettings().then(setS);
  }, []);

  useEffect(() => {
    if (!s) return;
    resolveHlsUrl()
      .then(setDisplayHlsUrl)
      .catch(() => setDisplayHlsUrl(buildHlsUrl()));
  }, [s?.hls_public_host, s]);

  if (!s) {
    return (
      <div className="flex items-center gap-2 py-12 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading settings…
      </div>
    );
  }

  const update = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const next = await api.saveSettings(s);
      setS(next);
      resolveHlsUrl().then(setDisplayHlsUrl).catch(() => {});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testObs();
      setTestResult(r);
    } finally {
      setTesting(false);
    }
  };

  const changePw = async () => {
    if (!pw) return;
    await api.changePassword(pw);
    setPw("");
    setPwMsg("Password updated.");
    setTimeout(() => setPwMsg(""), 2500);
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Connections and keys. Stored locally on your PC.</p>
      </div>

      {user.role === "admin" && <UsersAdmin />}
      {user.role === "admin" && <BackupAdmin />}

      <Section title="VRChat stream URL">
        <p className="text-xs text-slate-500">
          HLS feed on port <strong className="font-normal text-slate-300">8888</strong> (not the web app on
          8000). Use <strong className="font-normal text-slate-300">start-movie-night.cmd</strong> to launch
          MediaMTX + the app, then open the <strong className="font-normal text-slate-300">Movie Night</strong>{" "}
          tab to verify everything before Go live.
        </p>
        <Field label="Public / LAN IP for stream URL (optional)">
          <input
            className="input font-mono text-sm"
            value={s.hls_public_host ?? ""}
            onChange={(e) => update({ hls_public_host: e.target.value })}
            placeholder="e.g. 98.28.177.127 — leave blank to auto-detect"
          />
          <p className="mt-1 text-[10px] text-slate-500">
            Set this if friends connect over the internet and auto-detect picks the wrong address.
          </p>
        </Field>
        <Field label="HLS path override (advanced)">
          <input
            className="input font-mono text-sm"
            value={s.hls_stream_path ?? ""}
            onChange={(e) => update({ hls_stream_path: e.target.value })}
            placeholder="live/vrstream/index.m3u8"
          />
          <p className="mt-1 text-[10px] text-slate-500">
            Leave blank unless preflight shows a different MediaMTX path. Restart MediaMTX after enabling API in
            mediamtx.yml.
          </p>
        </Field>
        <div className="rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-brand-200 break-all">
          {displayHlsUrl || "…"}
        </div>
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={async () => {
            try {
              await copyHlsUrl();
              pushToast("HLS URL copied", "success");
            } catch {
              pushToast("Could not copy URL", "error");
            }
          }}
        >
          <Copy className="h-4 w-4" /> Copy URL
        </button>
      </Section>

      <Section title="OBS WebSocket">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Host">
            <input className="input" value={s.obs_host} onChange={(e) => update({ obs_host: e.target.value })} />
          </Field>
          <Field label="Port">
            <input
              type="number"
              className="input"
              value={s.obs_port}
              onChange={(e) => update({ obs_port: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field label="Password">
          <input
            type="password"
            className="input"
            value={s.obs_password}
            onChange={(e) => update({ obs_password: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Media Source name">
            <input
              className="input"
              value={s.obs_media_input}
              onChange={(e) => update({ obs_media_input: e.target.value })}
            />
          </Field>
          <Field label="Scene (optional)">
            <input className="input" value={s.obs_scene} onChange={(e) => update({ obs_scene: e.target.value })} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={test} disabled={testing} className="btn-ghost">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} Test connection
          </button>
          {testResult &&
            (testResult.connected ? (
              <span className="flex items-center gap-1 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-red-300">
                <XCircle className="h-4 w-4" /> {testResult.error || "Failed"}
              </span>
            ))}
        </div>
      </Section>

      <Section title="Search & Torrents">
        <Field label="TMDB API key">
          <input
            className="input"
            value={s.tmdb_api_key}
            onChange={(e) => update({ tmdb_api_key: e.target.value })}
            placeholder="from themoviedb.org"
          />
        </Field>
        <Field label="AIOStreams base URL">
          <input
            className="input"
            value={s.aiostreams_base}
            onChange={(e) => update({ aiostreams_base: e.target.value })}
            placeholder="https://aiostreams.elfhosted.com/stremio/<config>"
          />
          <p className="mt-1 text-xs text-slate-500">Your manifest URL with "/manifest.json" removed.</p>
        </Field>
        <Field label="TorBox API key">
          <input
            type="password"
            className="input"
            value={s.torbox_api_key}
            onChange={(e) => update({ torbox_api_key: e.target.value })}
            placeholder="from torbox.app → Settings → API"
          />
          <p className="mt-1 text-xs text-slate-500">
            Required for “Cache &amp; download” on uncached torrents (same key as in AIOStreams).
          </p>
        </Field>
      </Section>

      <Section title="Downloads & Playback">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Max concurrent">
            <input
              type="number"
              min={1}
              className="input"
              value={s.max_concurrent_downloads}
              onChange={(e) => update({ max_concurrent_downloads: Number(e.target.value) })}
            />
          </Field>
          <Field label="Small skip (s)">
            <input
              type="number"
              className="input"
              value={s.skip_small}
              onChange={(e) => update({ skip_small: Number(e.target.value) })}
            />
          </Field>
          <Field label="Large skip (s)">
            <input
              type="number"
              className="input"
              value={s.skip_large}
              onChange={(e) => update({ skip_large: Number(e.target.value) })}
            />
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={s.use_deno}
            onChange={(e) => update({ use_deno: e.target.checked })}
            className="h-4 w-4 rounded accent-brand-500"
          />
          Use Deno JS runtime for yt-dlp (YouTube)
        </label>
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
        </button>
        {saved && <span className="text-sm text-emerald-300">Saved.</span>}
      </div>

      <Section title="Change your password">
        <div className="flex items-end gap-3">
          <Field label="New password" className="flex-1">
            <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <button onClick={changePw} disabled={!pw} className="btn-ghost">
            Update
          </button>
        </div>
        {pwMsg && <span className="text-sm text-emerald-300">{pwMsg}</span>}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs text-slate-400 ${className}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
