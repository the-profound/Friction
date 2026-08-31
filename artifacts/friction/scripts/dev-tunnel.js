#!/usr/bin/env node
/**
 * dev-tunnel.js — Start Metro dev server + expose via fixed ngrok static domain
 *
 * This script starts Expo in dev-client mode and tunnels Metro through your
 * reserved ngrok static domain so that the dev-client on any TestFlight-installed
 * device can always reach the same address, even across fresh Replit sessions.
 *
 * Prerequisites:
 *   - NGROK_AUTHTOKEN  : your ngrok account authtoken (set as a Replit Secret)
 *   - NGROK_STATIC_DOMAIN : your reserved static domain, e.g. "your-name.ngrok-free.app"
 *
 * Usage:
 *   pnpm dev:tunnel
 *
 * Once running, connect your dev-client by entering:
 *   https://<your-static-domain>
 * in the "Enter URL manually" field of the installed dev-client.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ngrok = require("@ngrok/ngrok");

const METRO_PORT = 8090;
const projectRoot = path.resolve(__dirname, "..");
const metroMarkerPath = path.join(
  projectRoot,
  ".expo",
  `friction-metro-${METRO_PORT}.json`,
);

// ── Validate env ──────────────────────────────────────────────────────────────
if (!process.env.NGROK_AUTHTOKEN) {
  console.error("❌  NGROK_AUTHTOKEN is not set. Add it as a Replit Secret.");
  process.exit(1);
}
if (!process.env.NGROK_STATIC_DOMAIN) {
  console.error(
    "❌  NGROK_STATIC_DOMAIN is not set. Add it as a Replit Secret (e.g. your-name.ngrok-free.app).",
  );
  process.exit(1);
}

const staticDomain = process.env.NGROK_STATIC_DOMAIN.replace(/^https?:\/\//, "");
const tunnelUrl = `https://${staticDomain}`;

// EXPO_PUBLIC_DOMAIN controls the API base URL inside the JS bundle.
// The ngrok tunnel only forwards Metro (bundle) traffic — API routes hit Metro
// and get back HTML 200, which customFetch parses as a string, causing
// "undefined is not a function" when the app calls .filter() on that string.
// Always point EXPO_PUBLIC_DOMAIN at the live deployed API server instead.
const API_DOMAIN = "friction-1.replit.app";

// ── Signal handling ───────────────────────────────────────────────────────────
let metroProcess = null;

const cleanup = () => {
  if (metroProcess) {
    console.log("\nStopping Metro...");
    metroProcess.kill();
  }
  ngrok.kill().catch(() => {});
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("SIGHUP", cleanup);

// ── Helpers ───────────────────────────────────────────────────────────────────
async function waitForMetro(timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${METRO_PORT}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const marker = JSON.parse(fs.readFileSync(metroMarkerPath, "utf8"));
        if (marker.bundleValidation === "passed") return true;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
    process.stdout.write(".");
  }
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log("=== Friction dev-client tunnel ===");
  console.log(`Metro port   : ${METRO_PORT}`);
  console.log(`Tunnel URL   : ${tunnelUrl}  (Metro bundles only)`);
  console.log(`API domain   : https://${API_DOMAIN}  (all /api/* calls)`);
  console.log("");

  // Start Metro (dev mode, no minify)
  console.log("Starting Metro…");
  metroProcess = spawn(
    process.execPath,
    [
      path.join(projectRoot, "scripts", "start-dev-metro.js"),
      "--dev-client",
      "--port",
      String(METRO_PORT),
    ],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Tell Metro/Expo its public address is the ngrok tunnel (bundle only).
        REACT_NATIVE_PACKAGER_HOSTNAME: staticDomain,
        EXPO_PACKAGER_PROXY_URL: tunnelUrl,
        // API calls must go to the live deployment, NOT through the ngrok
        // tunnel (which only forwards Metro port and returns HTML for /api/*).
        EXPO_PUBLIC_DOMAIN: API_DOMAIN,
      },
    },
  );

  metroProcess.stdout.on("data", (d) => {
    const line = d.toString().trimEnd();
    if (line) console.log(`[Metro] ${line}`);
  });
  metroProcess.stderr.on("data", (d) => {
    const line = d.toString().trimEnd();
    if (line) console.error(`[Metro] ${line}`);
  });
  metroProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Metro exited with code ${code}`);
      ngrok.kill().catch(() => {});
      process.exit(code ?? 1);
    }
  });

  process.stdout.write("Waiting for Metro to be ready");
  const ready = await waitForMetro();
  console.log(ready ? " ✓" : "");

  if (!ready) {
    console.error("❌  Metro did not become healthy within 2 minutes.");
    cleanup();
  }

  // Open ngrok tunnel on the static domain
  console.log("\nOpening ngrok tunnel…");
  const listener = await ngrok.forward({
    addr: METRO_PORT,
    authtoken_from_env: true,
    domain: staticDomain,
  });

  const actualUrl = listener.url();
  console.log("");
  console.log("✅  Tunnel ready!");
  console.log("─────────────────────────────────────────────────────────");
  console.log(`  Fixed address  : ${actualUrl}`);
  console.log("");
  console.log("  To connect your dev-client:");
  console.log(`    1. Open the Friction app (installed from TestFlight → dev-client build)`);
  console.log(`    2. Tap "Enter URL manually"`);
  console.log(`    3. Enter: ${actualUrl}`);
  console.log("");
  console.log("  (You only need to do step 3 once — the address never changes.)");
  console.log("─────────────────────────────────────────────────────────");

  // Keep the process alive while Metro + ngrok run
  await new Promise(() => {});
})().catch((err) => {
  console.error("dev-tunnel error:", err);
  cleanup();
});
