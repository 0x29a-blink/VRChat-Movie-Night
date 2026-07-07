import { CheckCircle2, Copy, Download, Loader2, RotateCw, Save, Trash2, Upload, UserPlus, Wifi, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { buildHlsUrl, copyHlsUrl, resolveHlsUrl } from "../hlsUrl";
import { copyTextToClipboard } from "../clipboard";
import type { BackupImportPreview, ProviderCheckResult, Settings, UserInfo } from "../types";
import { MediaMtxSettings } from "./MediaMtxSettings";
import { StreamQualitySettings } from "./StreamQualitySettings";
import { ConfirmModal, PromptModal } from "./ConfirmModal";
import { useToast } from "./Toast";
import {
  THEMES,
  getStoredCustom,
  getStoredTheme,
  previewSwatch,
  setCustomTheme,
  setTheme,
  type CustomTheme,
  type ThemeId,
} from "../theme";
import { isHexColor } from "../themeColors";

const DEFAULT_HLS_REL_PATH = "live/vrstream/index.m3u8";
const OBS_RTMP_SERVER_URL = "rtmp://localhost:1935/live";

/** Stream key is the middle segment of the hls_stream_path setting, e.g. "live/<key>/index.m3u8". */
function deriveStreamKey(hlsStreamPath: string | undefined): string {
  const path = (hlsStreamPath || DEFAULT_HLS_REL_PATH).replace(/^\/+/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return "vrstream";
}

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
  const [usersError, setUsersError] = useState("");

  const generatePassword = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  };

  const load = () => {
    setLoading(true);
    setUsersError("");
    api
      .listUsers()
      .then((r) => setUsers(r.users))
      .catch((err: unknown) => setUsersError(err instanceof Error ? err.message : "Could not load users"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const create = async () => {
    if (!username.trim() || !password) return;
    const pw = password;
    setBusy(true);
    setCreatedPw("");
    try {
      await api.createUser(username.trim(), pw, role);
      setCreatedPw(pw);
      setUsername("");
      setPassword("");
      load();
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      load();
      pushToast("User deleted", "info");
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : "Could not delete user");
    }
  };

  const confirmReset = async () => {
    if (!resetTarget || !resetPw.trim()) return;
    const pw = resetPw.trim();
    setResetBusy(true);
    try {
      await api.resetUserPassword(resetTarget.id, pw);
      setCreatedPw(`Reset password: ${pw}`);
      setResetTarget(null);
      setResetPw("");
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setResetBusy(false);
    }
  };

  const toggleStatsExcluded = async (u: UserInfo) => {
    setBusy(true);
    try {
      await api.setUserWatchlistStatsExcluded(u.id, !u.watchlist_stats_excluded);
      load();
      pushToast(
        u.watchlist_stats_excluded
          ? `${u.username} included in group watchlist stats`
          : `${u.username} excluded from group watchlist stats`,
        "info",
      );
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : "Could not update user");
    } finally {
      setBusy(false);
    }
  };

  const toggleLocalDownload = async (u: UserInfo) => {
    setBusy(true);
    try {
      await api.setUserLocalDownload(u.id, !u.allow_local_download);
      load();
      pushToast(
        u.allow_local_download
          ? `${u.username} can no longer open TorBox download links`
          : `${u.username} can open TorBox download links (CDN only)`,
        "info",
      );
    } catch (err: unknown) {
      setUsersError(err instanceof Error ? err.message : "Could not update local download permission");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Users (admin)">
      <p className="text-xs text-slate-500">
        Create accounts for your friend group. Password is shown once after create/reset. Exclude inactive friends from
        group watched counts and ratings; they still reappear on a title if they rate, comment, or mark it watched.
        Per-account <span className="text-slate-300">TorBox download</span> (off by default) opens TorBox CDN links in the
        user&apos;s browser — no files are streamed from your PC. Server “Download” still copies to your library on disk.
      </p>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      ) : usersError ? (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {usersError}
          <button type="button" onClick={load} className="ml-3 underline">
            Retry
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm">
              <span>
                {u.username}{" "}
                <span className="chip ml-1 bg-white/5 text-slate-400">{u.role}</span>
                {u.watchlist_stats_excluded && (
                  <span className="chip ml-1 bg-amber-500/15 text-amber-300">stats excluded</span>
                )}
                {u.allow_local_download && (
                  <span className="chip ml-1 bg-sky-500/15 text-sky-300">TorBox DL</span>
                )}
              </span>
              <span className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggleLocalDownload(u)}
                  className="btn-ghost px-2 text-xs"
                >
                  {u.allow_local_download ? "Disable TorBox download" : "Allow TorBox download"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggleStatsExcluded(u)}
                  className="btn-ghost px-2 text-xs"
                >
                  {u.watchlist_stats_excluded ? "Include in stats" : "Exclude from stats"}
                </button>
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
          <div className="flex gap-2">
            <input
              type="text"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Generate or type"
            />
            <button type="button" onClick={() => setPassword(generatePassword())} className="btn-ghost shrink-0 text-xs">
              Generate
            </button>
          </div>
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
  const [previewBusy, setPreviewBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmImport, setConfirmImport] = useState(false);
  const [pendingImport, setPendingImport] = useState<unknown>(null);
  const [preview, setPreview] = useState<BackupImportPreview | null>(null);

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
      setError("");
      let data: unknown;
      try {
        const text = await file.text();
        data = JSON.parse(text);
      } catch {
        pushToast("Invalid backup file", "error");
        return;
      }
      setPreviewBusy(true);
      try {
        const p = await api.previewBackupImport(data);
        setPreview(p);
        setPendingImport(data);
        setConfirmImport(true);
      } catch (e: unknown) {
        pushToast(e instanceof Error ? e.message : "Backup file failed validation", "error");
      } finally {
        setPreviewBusy(false);
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
      setPreview(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  };

  const cancelImport = () => {
    setConfirmImport(false);
    setPendingImport(null);
    setPreview(null);
  };

  return (
    <Section title="Backup (admin)">
      <p className="text-xs text-slate-500">
        Export or restore watchlist, ratings, comments, groups, and settings. Video files are not included.
        Import replaces all watchlist data (library files on disk are kept). A snapshot of the current
        data is saved on the server before every import.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={exportBackup} disabled={busy} className="btn-ghost text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Export backup
        </button>
        <button type="button" onClick={pickImport} disabled={previewBusy} className="btn-ghost text-sm">
          {previewBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Import backup
        </button>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}

      <ConfirmModal
        open={confirmImport}
        title="Import backup?"
        message={
          preview ? (
            <div className="space-y-2">
              <p>This replaces all watchlist groups, titles, ratings, comments, and wheel presets.</p>
              <ul className="list-inside list-disc text-xs text-slate-400">
                <li>{preview.groups} groups, {preview.items} items</li>
                <li>{preview.ratings} ratings, {preview.watch_status} watch statuses, {preview.comments} comments</li>
                <li>{preview.wheel_presets} wheel presets</li>
                <li>{preview.users_matched} users matched to current accounts</li>
                <li>
                  {preview.library_links_resolvable} / {preview.library_items_total} library file links resolvable
                </li>
              </ul>
              {preview.users_unmatched.length > 0 && (
                <p className="text-xs text-amber-400">
                  Unmatched users (their ratings/comments will be dropped): {preview.users_unmatched.join(", ")}
                </p>
              )}
              <p className="text-xs text-slate-400">
                User accounts and library files on disk are not removed. A pre-import snapshot is saved
                on the server automatically.
              </p>
            </div>
          ) : (
            "This replaces all watchlist groups, titles, ratings, comments, and wheel presets. User accounts and library files on disk are not removed."
          )
        }
        confirmLabel="Import"
        danger
        busy={importBusy}
        onConfirm={runImport}
        onCancel={cancelImport}
      />
    </Section>
  );
}

function HlsCopyBlock({
  displayHlsUrl,
  onToast,
}: {
  displayHlsUrl: string;
  onToast: (message: string, type: "success" | "error") => void;
}) {
  return (
    <>
      <div className="rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-brand-200 break-all">
        {displayHlsUrl || "…"}
      </div>
      <button
        type="button"
        className="btn-ghost text-sm"
        onClick={async () => {
          try {
            await copyHlsUrl();
            onToast("HLS URL copied", "success");
          } catch {
            onToast("Could not copy URL", "error");
          }
        }}
      >
        <Copy className="h-4 w-4" /> Copy URL
      </button>
    </>
  );
}

type SettingsSection = "account" | "appearance" | "host" | "providers" | "users" | "backup";

const ADMIN_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "appearance", label: "Appearance" },
  { id: "host", label: "Host setup" },
  { id: "providers", label: "Providers" },
  { id: "users", label: "Users" },
  { id: "backup", label: "Backup" },
];

function ThemeSwatch({ swatch }: { swatch: [string, string, string, string] }) {
  return (
    <span
      className="grid h-10 w-14 shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-white/10"
      aria-hidden
    >
      {swatch.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

function AppearanceSection() {
  const [theme, setThemeState] = useState<ThemeId>(getStoredTheme);
  const [custom, setCustom] = useState<CustomTheme>(getStoredCustom);

  const pick = (id: ThemeId) => {
    setTheme(id);
    setThemeState(id);
  };

  const updateCustom = (patch: Partial<CustomTheme>) => {
    const next = { ...custom, ...patch };
    setCustom(next);
    setCustomTheme(next); // persists + re-applies live if Custom is active
    if (theme !== "custom") pick("custom");
  };

  const cardClass = (active: boolean) =>
    `flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
      active
        ? "border-brand-500/70 bg-brand-500/10 ring-1 ring-brand-500/40"
        : "border-white/10 bg-white/5 hover:bg-white/10"
    }`;

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Theme</h2>
        <p className="mt-1 text-xs text-slate-500">Applies to this browser only — each member picks their own.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            aria-pressed={theme === t.id}
            className={cardClass(theme === t.id)}
          >
            <ThemeSwatch swatch={t.swatch} />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-100">{t.label}</span>
              <span className="block truncate text-xs text-slate-500">{t.description}</span>
            </span>
          </button>
        ))}

        {/* Custom */}
        <button
          type="button"
          onClick={() => pick("custom")}
          aria-pressed={theme === "custom"}
          className={cardClass(theme === "custom")}
        >
          <ThemeSwatch swatch={previewSwatch(custom.accent, custom.surface)} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-100">Custom</span>
            <span className="block truncate text-xs text-slate-500">Pick your own accent &amp; background.</span>
          </span>
        </button>
      </div>

      {theme === "custom" && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField
              label="Accent"
              hint="Buttons, links, highlights"
              value={custom.accent}
              onChange={(accent) => updateCustom({ accent })}
            />
            <ColorField
              label="Background"
              hint="Works best with a dark color"
              value={custom.surface}
              onChange={(surface) => updateCustom({ surface })}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">Changes preview live across the app as you pick.</p>
        </div>
      )}
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
          aria-label={`${label} color`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (isHexColor(v)) onChange(v.startsWith("#") ? v : `#${v}`);
            else onChange(e.target.value);
          }}
          spellCheck={false}
          className="input py-1.5 font-mono text-xs uppercase"
        />
      </span>
      <span className="mt-1 block text-[10px] text-slate-500">{hint}</span>
    </label>
  );
}

function SettingsTabBar({
  section,
  onChange,
}: {
  section: SettingsSection;
  onChange: (s: SettingsSection) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-white/5 pb-3">
      {ADMIN_SECTIONS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={
            section === item.id
              ? "btn-primary text-sm"
              : "btn-ghost border border-white/10 text-sm"
          }
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function CopyObsSetupRow({
  label,
  value,
  onToast,
}: {
  label: string;
  value: string;
  onToast: (message: string, type: "success" | "error") => void;
}) {
  const copy = async () => {
    try {
      await copyTextToClipboard(value);
      onToast(`${label} copied`, "success");
    } catch {
      onToast(`Could not copy ${label.toLowerCase()}`, "error");
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
        <div className="truncate font-mono text-xs text-brand-200">{value || "…"}</div>
      </div>
      <button type="button" onClick={copy} className="btn-ghost shrink-0 text-xs">
        <Copy className="h-3.5 w-3.5" /> Copy
      </button>
    </div>
  );
}

function CopyObsSetupBlock({
  s,
  onToast,
}: {
  s: Settings;
  onToast: (message: string, type: "success" | "error") => void;
}) {
  const streamKey = deriveStreamKey(s.hls_stream_path);
  return (
    <div className="space-y-2 pt-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">Copy OBS setup values</p>
      <CopyObsSetupRow label="RTMP server URL" value={OBS_RTMP_SERVER_URL} onToast={onToast} />
      <CopyObsSetupRow label="Stream key" value={streamKey} onToast={onToast} />
      <CopyObsSetupRow label="Media source name" value={s.obs_media_input} onToast={onToast} />
    </div>
  );
}

function PasswordSection({
  password,
  message,
  onPasswordChange,
  onSubmit,
}: {
  password: string;
  message: string;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const error = message.toLowerCase().includes("failed") || message.toLowerCase().includes("error");
  return (
    <Section title="Change your password">
      <div className="flex items-end gap-3">
        <Field label="New password" className="flex-1">
          <input type="password" className="input" value={password} onChange={(e) => onPasswordChange(e.target.value)} />
        </Field>
        <button onClick={onSubmit} disabled={!password} className="btn-ghost">
          Update
        </button>
      </div>
      {message && <span className={`text-sm ${error ? "text-red-300" : "text-emerald-300"}`}>{message}</span>}
    </Section>
  );
}

export function SettingsPage({ user }: { user: UserInfo }) {
  const { push: pushToast } = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [displayHlsUrl, setDisplayHlsUrl] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{
    connected: boolean;
    error?: string;
    audit?: { recommendations?: string[] };
  } | null>(null);
  const [obsApplying, setObsApplying] = useState(false);
  const [testing, setTesting] = useState(false);
  const [aiostreamsBusy, setAiostreamsBusy] = useState(false);
  const [providerTesting, setProviderTesting] = useState<{ tmdb?: boolean; torbox?: boolean; aiostreams?: boolean }>({});
  const [providerResults, setProviderResults] = useState<{
    tmdb?: ProviderCheckResult;
    torbox?: ProviderCheckResult;
    aiostreams?: ProviderCheckResult;
  }>({});

  const [pw, setPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [section, setSection] = useState<SettingsSection>("account");
  const isAdmin = user.role === "admin";

  useEffect(() => {
    if (!isAdmin) {
      resolveHlsUrl().then(setDisplayHlsUrl).catch(() => setDisplayHlsUrl(buildHlsUrl()));
      return;
    }
    setSettingsError("");
    api
      .getSettings()
      .then(setS)
      .catch((e: unknown) => setSettingsError(e instanceof Error ? e.message : "Could not load settings"));
  }, [isAdmin]);

  useEffect(() => {
    if (!s) return;
    resolveHlsUrl()
      .then(setDisplayHlsUrl)
      .catch(() => setDisplayHlsUrl(buildHlsUrl()));
  }, [s?.hls_public_host, s]);

  const changePw = async () => {
    if (!pw) return;
    try {
      await api.changePassword(pw);
      setPw("");
      setPwMsg("Password updated.");
      setTimeout(() => setPwMsg(""), 2500);
    } catch (e: unknown) {
      setPwMsg(e instanceof Error ? e.message : "Password update failed.");
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">Account settings and movie-night stream info.</p>
        </div>

        <Section title="VRChat stream URL">
          <p className="text-xs text-slate-500">
            HLS feed on port <strong className="font-normal text-slate-300">8888</strong> (not the web app on
            8000). Ask the host if this URL does not load in VRChat.
          </p>
          <HlsCopyBlock displayHlsUrl={displayHlsUrl} onToast={pushToast} />
        </Section>

        <AppearanceSection />

        <PasswordSection password={pw} message={pwMsg} onPasswordChange={setPw} onSubmit={changePw} />
      </div>
    );
  }

  if (!s) {
    return (
      <div className="flex items-center gap-2 py-12 text-slate-400">
        {settingsError ? (
          <>
            <XCircle className="h-5 w-5 text-red-400" /> {settingsError}
          </>
        ) : (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> Loading settings…
          </>
        )}
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
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : "Could not save settings", "error");
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
    } catch (e: unknown) {
      setTestResult({ connected: false, error: e instanceof Error ? e.message : "OBS test failed" });
    } finally {
      setTesting(false);
    }
  };

  const applyObs = async () => {
    setObsApplying(true);
    try {
      const r = await api.applyObsDefaults();
      if (r.ok) pushToast("OBS defaults applied", "success");
      else pushToast(r.error || r.recommendations?.[0] || "Could not apply OBS defaults", "error");
      await test();
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : "Apply failed", "error");
    } finally {
      setObsApplying(false);
    }
  };

  const reloadAiostreams = async () => {
    setAiostreamsBusy(true);
    try {
      const r = await api.reloadAiostreamsConfig();
      setS((prev) => (prev ? { ...prev, ...r } : prev));
      pushToast(
        r.discovered ? "Reloaded AIOStreams config from local install" : "No local AIOStreams config found",
        r.discovered ? "success" : "error"
      );
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : "Reload failed", "error");
    } finally {
      setAiostreamsBusy(false);
    }
  };

  const resetAiostreamsAuto = async () => {
    setAiostreamsBusy(true);
    try {
      const next = await api.resetAiostreamsAuto();
      setS(next);
      pushToast("Switched to auto-detected AIOStreams URL", "success");
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : "Reset failed", "error");
    } finally {
      setAiostreamsBusy(false);
    }
  };

  const testProvider = async (
    key: "tmdb" | "torbox" | "aiostreams",
    run: () => Promise<ProviderCheckResult>
  ) => {
    setProviderTesting((prev) => ({ ...prev, [key]: true }));
    setProviderResults((prev) => ({ ...prev, [key]: undefined }));
    try {
      const r = await run();
      setProviderResults((prev) => ({ ...prev, [key]: r }));
    } catch (e: unknown) {
      setProviderResults((prev) => ({
        ...prev,
        [key]: { ok: false, detail: e instanceof Error ? e.message : "Test failed" },
      }));
    } finally {
      setProviderTesting((prev) => ({ ...prev, [key]: false }));
    }
  };

  const testTmdb = () => testProvider("tmdb", api.testTmdb);
  const testTorbox = () => testProvider("torbox", api.testTorbox);
  const testAiostreamsKey = () => testProvider("aiostreams", api.testAiostreams);

  const saveBar = (
    <div className="flex items-center gap-3">
      <button onClick={save} disabled={saving} className="btn-primary">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
      </button>
      {saved && <span className="text-sm text-emerald-300">Saved.</span>}
    </div>
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Connections and keys. Stored locally on your PC.</p>
      </div>

      <SettingsTabBar section={section} onChange={setSection} />

      {section === "account" && (
        <PasswordSection password={pw} message={pwMsg} onPasswordChange={setPw} onSubmit={changePw} />
      )}

      {section === "appearance" && <AppearanceSection />}

      {section === "host" && (
        <>
          <Section title="VRChat stream URL">
            <p className="text-xs text-slate-500">
              HLS feed on port <strong className="font-normal text-slate-300">8888</strong> (not the web app on
              8000). Use <strong className="font-normal text-slate-300">start-stack.cmd</strong> to launch
              MediaMTX + the app, then open the <strong className="font-normal text-slate-300">Movie Night</strong>{" "}
              tab to verify everything before Go live.
            </p>
            <Field label="Public / LAN IP for stream URL (optional)">
              <input
                className="input font-mono text-sm"
                value={s.hls_public_host ?? ""}
                onChange={(e) => update({ hls_public_host: e.target.value })}
                placeholder="e.g. 12.34.567.890 — leave blank to auto-detect"
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
            <HlsCopyBlock displayHlsUrl={displayHlsUrl} onToast={pushToast} />
          </Section>

          {user.role === "admin" && (
            <Section title="MediaMTX HLS presets">
              <MediaMtxSettings />
            </Section>
          )}

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
                autoComplete="new-password"
                className="input"
                value={s.obs_password}
                onChange={(e) => update({ obs_password: e.target.value })}
                placeholder={s.obs_password_set ? "•••••• saved — type to replace" : "Not set"}
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
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={test} disabled={testing} className="btn-ghost">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} Test connection
              </button>
              <button onClick={applyObs} disabled={obsApplying} className="btn-ghost text-sm">
                {obsApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Apply stream defaults
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
            {testResult?.audit?.recommendations && testResult.audit.recommendations.length > 0 && (
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-400">
                {testResult.audit.recommendations.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <CopyObsSetupBlock s={s} onToast={pushToast} />
          </Section>

          <Section title="Stream quality (OBS)">
            <StreamQualitySettings />
          </Section>

          {saveBar}
        </>
      )}

      {section === "providers" && (
        <>
          <Section title="Search & Torrents">
            <Field label="TMDB API key">
              <input
                type="password"
                autoComplete="new-password"
                className="input"
                value={s.tmdb_api_key}
                onChange={(e) => update({ tmdb_api_key: e.target.value })}
                placeholder={s.tmdb_api_key_set ? "•••••• saved — type to replace" : "from themoviedb.org"}
              />
              <ProviderTestButton busy={providerTesting.tmdb} result={providerResults.tmdb} onTest={testTmdb} />
            </Field>
            <Field label="AIOStreams">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={aiostreamsBusy}
                    onClick={resetAiostreamsAuto}
                    className={s.aiostreams_auto ? "btn-primary text-sm" : "btn-ghost border border-white/10 text-sm"}
                  >
                    Auto-detect (local)
                  </button>
                  <button
                    type="button"
                    disabled={aiostreamsBusy}
                    onClick={() => update({ aiostreams_auto: false })}
                    className={!s.aiostreams_auto ? "btn-primary text-sm" : "btn-ghost border border-white/10 text-sm"}
                  >
                    Manual URL
                  </button>
                  {s.aiostreams_auto && (
                    <button
                      type="button"
                      disabled={aiostreamsBusy}
                      onClick={reloadAiostreams}
                      className="btn-ghost border border-white/10 text-sm"
                    >
                      {aiostreamsBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCw className="h-4 w-4" />
                      )}
                      Reload config
                    </button>
                  )}
                </div>

                {s.aiostreams_auto ? (
                  <div className="rounded-lg bg-black/20 px-3 py-2 text-xs text-slate-400">
                    <span className="text-slate-500">Discovered from </span>
                    <code className="text-slate-300">AIOStreams\</code>
                    <span className="text-slate-500">:</span>
                    <div className="mt-1 break-all font-mono text-slate-300">
                      {s.aiostreams_base_discovered || "Not found — start AIOStreams and save /stremio/configure"}
                    </div>
                  </div>
                ) : (
                  <>
                    <input
                      className="input"
                      value={s.aiostreams_base}
                      onChange={(e) => update({ aiostreams_base: e.target.value, aiostreams_auto: false })}
                      placeholder="https://aiostreams.elfhosted.com/stremio/<config>"
                    />
                    <p className="text-xs text-slate-500">
                      Remote or third-party manifest base URL (without "/manifest.json"). Click Save settings below.
                    </p>
                    <button
                      type="button"
                      disabled={aiostreamsBusy}
                      onClick={resetAiostreamsAuto}
                      className="btn-ghost border border-white/10 text-sm"
                    >
                      Reset to auto-detect
                    </button>
                  </>
                )}

                <div className="text-xs text-slate-500">
                  Currently used for search/streams:{" "}
                  <span className="break-all font-mono text-emerald-300/90">
                    {s.aiostreams_base_effective || "Not configured"}
                  </span>
                </div>
                <ProviderTestButton
                  busy={providerTesting.aiostreams}
                  result={providerResults.aiostreams}
                  onTest={testAiostreamsKey}
                />
              </div>
            </Field>
            <Field label="TorBox API key">
              <input
                type="password"
                autoComplete="new-password"
                className="input"
                value={s.torbox_api_key}
                onChange={(e) => update({ torbox_api_key: e.target.value })}
                placeholder={
                  s.torbox_api_key_set ? "•••••• saved — type to replace" : "from torbox.app → Settings → API"
                }
              />
              <ProviderTestButton busy={providerTesting.torbox} result={providerResults.torbox} onTest={testTorbox} />
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
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={s.preserve_torrent_tracks !== false}
                onChange={(e) => update({ preserve_torrent_tracks: e.target.checked })}
                className="h-4 w-4 rounded accent-brand-500"
              />
              Keep all audio &amp; subtitle tracks in torrent downloads (default on)
            </label>
            <p className="text-xs text-slate-500">
              Off = yt-dlp keeps one audio track and drops subtitles (smaller file, no track picker). M3U8/YouTube
              unchanged.
            </p>
          </Section>

          {saveBar}
        </>
      )}

      {section === "users" && user.role === "admin" && <UsersAdmin />}

      {section === "backup" && user.role === "admin" && <BackupAdmin />}
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

function ProviderTestButton({
  busy,
  result,
  onTest,
}: {
  busy?: boolean;
  result?: ProviderCheckResult;
  onTest: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      <button type="button" onClick={onTest} disabled={busy} className="btn-ghost text-sm">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} Test
      </button>
      {result &&
        (result.ok ? (
          <span className="flex items-center gap-1 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> {result.detail || "OK"}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-sm text-red-300">
            <XCircle className="h-4 w-4" /> {result.detail || "Failed"}
          </span>
        ))}
    </div>
  );
}
