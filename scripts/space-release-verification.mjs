#!/usr/bin/env node

/**
 * Repeatable, non-destructive release gate for the space operations journey.
 *
 * The default checks use isolated test doubles and do not mutate a database.
 * Pass --live with SPACE_RELEASE_API_URL to additionally check the deployed
 * API's health and database readiness. The live check is intentionally limited
 * to read-only endpoints; role and inbox checks are performed with the
 * disposable accounts described in the runbook.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

const args = new Set(process.argv.slice(2));
const liveRequested = args.has("--live");
const reportArgIndex = process.argv.indexOf("--report");
const reportPath =
  reportArgIndex >= 0 && process.argv[reportArgIndex + 1]
    ? process.argv[reportArgIndex + 1]
    : `/tmp/space-release-verification-${Date.now()}.json`;

const checks = [
  {
    name: "api-space-journey-contracts",
    command: "pnpm",
    args: [
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/lib/inboxPrivacy.test.ts",
      "src/lib/scheduledSendProcessor.test.ts",
      "src/routes/spaces.join.api.test.ts",
      "src/routes/spaces.scheduled-sends.api.test.ts",
      "src/routes/spaces.letter-visibility.api.test.ts",
    ],
  },
  {
    name: "client-space-date-and-visibility-contracts",
    command: "pnpm",
    args: [
      "--filter",
      "@workspace/friction",
      "exec",
      "vitest",
      "run",
      "lib/kstDate.test.ts",
      "lib/spaceJoinValidation.test.ts",
      "lib/spaceRoundPresentation.test.ts",
      "lib/spaceScheduledSendPresentation.test.ts",
    ],
  },
  {
    name: "release-publication-guards",
    command: "pnpm",
    args: ["--filter", "@workspace/friction", "run", "test:release-publication-guards"],
  },
];

function runCommand(check) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(check.command, check.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      resolve({
        name: check.name,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
    });
    child.once("exit", (code, signal) => {
      resolve({
        name: check.name,
        status: code === 0 ? "passed" : "failed",
        durationMs: Date.now() - startedAt,
        ...(code === 0 ? {} : { exitCode: code, signal }),
      });
    });
  });
}

async function checkLiveApi() {
  const configuredUrl = process.env.SPACE_RELEASE_API_URL?.trim();
  if (!configuredUrl) {
    return {
      name: "live-api-readiness",
      status: "failed",
      durationMs: 0,
      error: "SPACE_RELEASE_API_URL is required when --live is used",
    };
  }

  let apiUrl;
  try {
    apiUrl = new URL(configuredUrl);
    if (!["http:", "https:"].includes(apiUrl.protocol)) throw new Error("invalid protocol");
  } catch {
    return {
      name: "live-api-readiness",
      status: "failed",
      durationMs: 0,
      error: "SPACE_RELEASE_API_URL must be an HTTP(S) URL",
    };
  }

  const apiBase = apiUrl.pathname.replace(/\/+$/, "").endsWith("/api")
    ? apiUrl
    : new URL(`${apiUrl.toString().replace(/\/+$/, "")}/api`);
  const startedAt = Date.now();
  const endpointResults = [];

  for (const endpoint of ["/healthz", "/readyz"]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const endpointUrl = `${apiBase.toString().replace(/\/+$/, "")}${endpoint}`;
      const response = await fetch(endpointUrl, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => null);
      endpointResults.push({
        endpoint,
        statusCode: response.status,
        ok: response.ok && (body?.status === "ok" || body?.status === "ready"),
      });
    } catch {
      endpointResults.push({ endpoint, statusCode: null, ok: false });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    name: "live-api-readiness",
    status: endpointResults.every((result) => result.ok) ? "passed" : "failed",
    durationMs: Date.now() - startedAt,
    host: apiBase.hostname,
    endpoints: endpointResults,
  };
}

async function main() {
  console.log("Space operations release verification");
  console.log("Read-only contract checks; no production data is created or deleted.");

  const results = [];
  for (const check of checks) {
    console.log(`\n▶ ${check.name}`);
    results.push(await runCommand(check));
  }
  if (liveRequested) {
    console.log("\n▶ live-api-readiness");
    results.push(await checkLiveApi());
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: liveRequested ? "contract-and-live-readiness" : "contract-only",
    status: results.every((result) => result.status === "passed") ? "passed" : "blocked",
    checks: results,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`\n${report.status === "passed" ? "PASS" : "BLOCKED"}: ${reportPath}`);
  if (report.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error("Space release verification could not complete.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});