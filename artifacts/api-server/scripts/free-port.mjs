#!/usr/bin/env node
// Pre-start cleanup: if a stale api-server instance is still holding $PORT,
// kill it (only if it looks like our own server process) and wait for the
// port to be released before the new instance starts.
import { execSync } from "node:child_process";
import net from "node:net";

const port = Number(process.env.PORT);
if (!Number.isFinite(port) || port <= 0) {
  console.error(`[free-port] Invalid or missing PORT: "${process.env.PORT}"`);
  process.exit(1);
}

function listenerPids(p) {
  try {
    const out = execSync(`lsof -t -iTCP:${p} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((pid) => pid !== process.pid);
  } catch {
    return []; // lsof exits non-zero when nothing is listening
  }
}

function cmdline(pid) {
  try {
    return execSync(`ps -p ${pid} -o args=`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function isOurServer(cmd) {
  // Previous instances run as `node ... dist/index.mjs` from this package.
  return /node/.test(cmd) && /api-server|dist\/index\.mjs/.test(cmd);
}

function portFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(p, "0.0.0.0");
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pids = listenerPids(port);
if (pids.length === 0) {
  process.exit(0);
}

for (const pid of pids) {
  const cmd = cmdline(pid);
  if (!isOurServer(cmd)) {
    console.error(
      `[free-port] Port ${port} is held by an unrelated process (pid ${pid}: ${cmd || "unknown"}). Refusing to kill it.`,
    );
    process.exit(1);
  }
  console.log(`[free-port] Killing stale api-server pid ${pid} on port ${port} (SIGTERM)`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}

// Wait up to ~5s for graceful release, then SIGKILL survivors.
let freed = false;
for (let i = 0; i < 25; i++) {
  await sleep(200);
  if (await portFree(port)) {
    freed = true;
    break;
  }
}

if (!freed) {
  for (const pid of listenerPids(port)) {
    console.log(`[free-port] Forcing kill of stale pid ${pid} (SIGKILL)`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    if (await portFree(port)) {
      freed = true;
      break;
    }
  }
}

if (!freed) {
  console.error(`[free-port] Port ${port} is still in use after cleanup attempts.`);
  process.exit(1);
}

console.log(`[free-port] Port ${port} is free.`);
