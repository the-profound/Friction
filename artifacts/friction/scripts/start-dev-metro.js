#!/usr/bin/env node
/**
 * Start the Friction development Metro server.
 *
 * Keep this entry point shared by the Replit preview and the fixed tunnel.
 * Metro caches and processes are deliberately not shared between those
 * workflows: every invocation clears the local graph and replaces an older
 * Friction Metro process on the same port.
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
let metroProcess = null;
let activeMarkerPath = null;
let activeLockPath = null;
let activeLockToken = null;
const fontContractSource = path.join(
  projectRoot,
  "components/shared/bodyTypographyFonts.ts",
);
const metroCacheDirs = [
  path.join(projectRoot, ".metro-cache"),
  path.join(projectRoot, "node_modules/.cache/metro"),
];

function getArgValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function readFontContractVersion() {
  try {
    const source = fs.readFileSync(fontContractSource, "utf8");
    return (
      source.match(/BODY_FONT_CONFIG_VERSION\s*=\s*["']([^"']+)["']/)?.[1] ??
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processCommand(pid) {
  try {
    return fs
      .readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replaceAll("\0", " ");
  } catch {
    return "";
  }
}

function processCwd(pid) {
  try {
    return fs.realpathSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

function getPortPids(port) {
  const result = spawnSync("lsof", ["-ti", `TCP:${port}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function isFrictionMetro(pid) {
  const command = processCommand(pid);
  const cwd = processCwd(pid);
  const args = command.trim().split(/\s+/);
  const startIndex = args.indexOf("start");
  const invokesExpo =
    startIndex > 0 &&
    args
      .slice(0, startIndex)
      .some(
        (arg) =>
          arg === "expo" ||
          arg.endsWith("/expo/bin/cli") ||
          arg.includes("/expo/bin/cli"),
      );
  return (
    invokesExpo &&
    (cwd === projectRoot || cwd.startsWith(`${projectRoot}${path.sep}`))
  );
}

function isFrictionLauncher(pid) {
  const cwd = processCwd(pid);
  return (
    processCommand(pid).includes("start-dev-metro.js") &&
    (cwd === projectRoot || cwd.startsWith(`${projectRoot}${path.sep}`))
  );
}

async function waitForProcessExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isAlive(pid);
}

async function acquireStartupLock(port) {
  const directory = path.join(projectRoot, ".expo");
  fs.mkdirSync(directory, { recursive: true });
  const lockPath = path.join(directory, `friction-metro-${port}.lock`);
  const token = `${process.pid}-${Date.now()}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        descriptor,
        JSON.stringify({ pid: process.pid, projectRoot, port, token }),
      );
      fs.closeSync(descriptor);
      return { lockPath, token };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    let holderPid = null;
    let observedLock = null;
    try {
      observedLock = fs.readFileSync(lockPath, "utf8");
      holderPid = JSON.parse(observedLock).pid;
    } catch {
      // A partial or stale lock is safe to discard below.
    }

    if (Number.isInteger(holderPid) && isAlive(holderPid)) {
      if (!isFrictionLauncher(holderPid)) {
        throw new Error(
          `Metro startup lock for port ${port} is held by another process.`,
        );
      }
      console.log(
        `[Friction Metro] Replacing previous launcher process: ${holderPid}`,
      );
      process.kill(holderPid, "SIGTERM");
      if (!(await waitForProcessExit(holderPid))) {
        process.kill(holderPid, "SIGKILL");
        await waitForProcessExit(holderPid);
      }
    }
    try {
      if (
        observedLock === null ||
        fs.readFileSync(lockPath, "utf8") === observedLock
      ) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch {
      // The previous owner removed its own lock.
    }
  }

  throw new Error(`Could not acquire the Metro startup lock for port ${port}.`);
}

function releaseStartupLock(lockPath, token) {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (lock.pid === process.pid && lock.token === token) {
      fs.rmSync(lockPath, { force: true });
    }
  } catch {
    // The lock may already have been removed by a replacing launcher.
  }
}

async function stopPreviousMetro(port) {
  const pids = getPortPids(port).filter((pid) => pid !== process.pid);
  if (pids.length === 0) return;

  const frictionPids = pids.filter(isFrictionMetro);
  const foreignPids = pids.filter((pid) => !isFrictionMetro(pid));
  if (foreignPids.length > 0) {
    throw new Error(
      `Port ${port} is already used by a process outside the Friction project. ` +
        "Stop that process before starting Metro.",
    );
  }

  console.log(
    `[Friction Metro] Replacing previous Metro process(es): ${frictionPids.join(", ")}`,
  );
  for (const pid of frictionPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // It may have exited between lsof and kill.
    }
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && frictionPids.some(isAlive)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const pid of frictionPids) {
    if (!isAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // It may have exited between the check and kill.
    }
  }

  const releaseDeadline = Date.now() + 5000;
  while (Date.now() < releaseDeadline && getPortPids(port).length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (getPortPids(port).length > 0) {
    throw new Error(`Previous Metro process did not release port ${port}.`);
  }
}

function clearMetroCaches() {
  for (const directory of metroCacheDirs) {
    if (fs.existsSync(directory)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  console.log("[Friction Metro] Cleared Metro caches.");
}

function writeServerMarker(serverId, port, kind) {
  const directory = path.join(projectRoot, ".expo");
  fs.mkdirSync(directory, { recursive: true });
  const markerPath = path.join(directory, `friction-metro-${port}.json`);
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        pid: process.pid,
        port,
        kind,
        serverId,
        fontContractVersion: readFontContractVersion(),
        bundleValidation: "pending",
        projectRoot,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return markerPath;
}

function markBundleValidationPassed(markerPath) {
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        ...marker,
        bundleValidation: "passed",
        bundleValidatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function removeServerMarker(markerPath) {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (marker.pid === process.pid) fs.rmSync(markerPath, { force: true });
  } catch {
    // The marker is diagnostic-only.
  }
}

async function waitForMetro(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // Metro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Metro did not become ready on port ${port}.`);
}

function validateNativeFontBundles(port) {
  return new Promise((resolve, reject) => {
    const validationProcess = spawn(
      process.execPath,
      [
        path.join(projectRoot, "scripts", "validate-dev-font-bundle.mjs"),
        "--port",
        String(port),
      ],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: "inherit",
      },
    );
    validationProcess.on("error", reject);
    validationProcess.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Native font bundle validation failed (code=${code}, signal=${signal}).`,
        ),
      );
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const port = getArgValue(args, "--port", process.env.PORT || "21672");
  const kind = args.includes("--dev-client") ? "tunnel" : "preview";
  const fontContractVersion = readFontContractVersion();
  const serverId = `friction-${kind}-${Date.now()}-${process.pid}`;

  const startupLock = await acquireStartupLock(port);
  activeLockPath = startupLock.lockPath;
  activeLockToken = startupLock.token;
  await stopPreviousMetro(port);
  clearMetroCaches();

  const markerPath = writeServerMarker(serverId, port, kind);
  activeMarkerPath = markerPath;
  console.log(
    `[Friction Metro] serverId=${serverId} kind=${kind} port=${port} ` +
      `fontContract=${fontContractVersion} root=${projectRoot} config=${path.join(projectRoot, "metro.config.js")}`,
  );
  console.log(
    "[Friction Metro] Starting with --clear for a fresh module graph.",
  );

  const expoArgs = ["exec", "expo", "start", "--clear", ...args];
  metroProcess = spawn("pnpm", expoArgs, {
    cwd: projectRoot,
    env: {
      ...process.env,
      EXPO_PUBLIC_FRICTION_DEV_SERVER_ID: serverId,
      EXPO_PUBLIC_FRICTION_DEV_FONT_CONTRACT_VERSION: fontContractVersion,
    },
    stdio: "inherit",
  });

  let shuttingDown = false;
  const cleanup = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    removeServerMarker(markerPath);
    if (metroProcess.exitCode === null) metroProcess.kill(signal);
  };
  process.on("SIGINT", () => cleanup("SIGINT"));
  process.on("SIGTERM", () => cleanup("SIGTERM"));
  process.on("SIGHUP", () => cleanup("SIGHUP"));

  metroProcess.on("exit", (code, signal) => {
    removeServerMarker(markerPath);
    releaseStartupLock(activeLockPath, activeLockToken);
    if (!shuttingDown) {
      process.exit(code ?? (signal ? 1 : 0));
    }
  });

  await waitForMetro(port);
  console.log(
    "[Friction Metro] Validating native WOFF2 modules in iOS and Android bundles.",
  );
  await validateNativeFontBundles(port);
  markBundleValidationPassed(markerPath);
  releaseStartupLock(activeLockPath, activeLockToken);
  console.log("[Friction Metro] Native font bundle validation passed.");
}

main().catch((error) => {
  console.error(`[Friction Metro] ${error.message}`);
  if (activeMarkerPath) removeServerMarker(activeMarkerPath);
  if (activeLockPath) releaseStartupLock(activeLockPath, activeLockToken);
  if (metroProcess?.exitCode === null) metroProcess.kill("SIGTERM");
  process.exit(1);
});
