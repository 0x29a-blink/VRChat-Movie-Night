/**
 * Run Cloudflare Tunnel via the npm `cloudflared` package (auto-downloads the binary).
 *
 * cloudflare/.env (pick one style):
 *   Single tunnel, two hostnames in dashboard:
 *     CF_TUNNEL_TOKEN=<token>
 *
 *   Two separate tunnels (one per service):
 *     CF_TUNNEL_TOKEN_APP=<web app token>      → localhost:8000
 *     CF_TUNNEL_TOKEN_STREAM=<HLS token>       → localhost:8888
 *
 *   Or config.yml named tunnel + credentials.json
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bin, install } from "cloudflared";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function ensureBinary() {
  if (!fs.existsSync(bin)) {
    console.log("[tunnel] Downloading cloudflared binary (first run only)...");
    await install(bin);
  }
  return bin;
}

function collectTokenRuns() {
  const app = (process.env.CF_TUNNEL_TOKEN_APP || "").trim();
  const stream = (process.env.CF_TUNNEL_TOKEN_STREAM || "").trim();
  if (app || stream) {
    const runs = [];
    if (app) runs.push({ label: "app", token: app });
    if (stream) runs.push({ label: "stream", token: stream });
    return runs;
  }

  const single = (process.env.CF_TUNNEL_TOKEN || "").trim();
  if (single) return [{ label: "tunnel", token: single }];

  const configPath = path.join(ROOT, "config.yml");
  if (fs.existsSync(configPath)) {
    return [{ label: "config", configPath }];
  }

  return null;
}

function printHelp() {
  console.error(`
Missing tunnel credentials in cloudflare/.env

Option A — one tunnel, two hostnames (one token):
  CF_TUNNEL_TOKEN=<token from Cloudflare dashboard>

Option B — two separate tunnels (two tokens):
  CF_TUNNEL_TOKEN_APP=<token for movienight subdomain → :8000>
  CF_TUNNEL_TOKEN_STREAM=<token for stream subdomain → :8888>

Option C — named tunnel:
  Copy config.yml.example to config.yml
`);
}

loadEnvFile(path.join(ROOT, ".env"));

const runs = collectTokenRuns();
if (!runs?.length) {
  printHelp();
  process.exit(1);
}

const binary = await ensureBinary();
const children = [];

console.log("[tunnel] Starting — keep this window open with start-stack.cmd");
console.log("[tunnel] Press Ctrl+C to stop all tunnels\n");

for (const run of runs) {
  let args;
  if (run.configPath) {
    console.log("[tunnel] Using cloudflare/config.yml");
    args = ["tunnel", "--config", run.configPath, "run"];
  } else {
    console.log(`[tunnel] Starting ${run.label} connector`);
    args = ["tunnel", "run", "--token", run.token];
  }

  const child = spawn(binary, args, { stdio: "inherit", cwd: ROOT });
  children.push(child);
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, stopAll);
}

let exited = 0;
for (const child of children) {
  child.on("exit", (code, signal) => {
    exited += 1;
    if (signal && exited >= children.length) process.exit(1);
    if (code && code !== 0) stopAll();
    if (exited >= children.length) process.exit(code ?? 0);
  });
}
