import app from "./app";
import { logger } from "./lib/logger";
import { seedDevData } from "./seed";
import { startScheduler } from "./scheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const LISTEN_RETRY_ATTEMPTS = 5;
const LISTEN_RETRY_DELAY_MS = 1000;
const SHUTDOWN_FORCE_EXIT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type HttpServer = ReturnType<typeof app.listen>;

function listenOnce(p: number): Promise<HttpServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(p);
    server.once("listening", () => {
      server.removeAllListeners("error");
      resolve(server);
    });
    server.once("error", (err) => {
      reject(err);
    });
  });
}

async function listenWithRetry(p: number): Promise<HttpServer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= LISTEN_RETRY_ATTEMPTS; attempt++) {
    try {
      return await listenOnce(p);
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE") {
        throw err;
      }
      logger.warn(
        { port: p, attempt, maxAttempts: LISTEN_RETRY_ATTEMPTS },
        "Port in use (EADDRINUSE), retrying shortly...",
      );
      await sleep(LISTEN_RETRY_DELAY_MS);
    }
  }
  logger.error(
    { port: p, err: lastErr },
    `Failed to bind port ${p} after ${LISTEN_RETRY_ATTEMPTS} attempts: the port is still occupied by another process. ` +
      "Stop the stale process holding the port and restart the workflow.",
  );
  throw lastErr;
}

function registerShutdownHandlers(server: HttpServer): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Received shutdown signal, closing server...");

    const forceExitTimer = setTimeout(() => {
      logger.warn("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_FORCE_EXIT_MS);
    forceExitTimer.unref();

    server.close((err) => {
      if (err) {
        logger.error({ err }, "Error while closing server");
        process.exit(1);
      }
      logger.info("Server closed cleanly");
      process.exit(0);
    });
    // Stop keeping idle connections alive so close() can finish promptly.
    server.closeIdleConnections?.();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

async function main(): Promise<void> {
  const server = await listenWithRetry(port);
  registerShutdownHandlers(server);

  logger.info({ port }, "Server listening");

  startScheduler();

  seedDevData().catch((e) => {
    logger.error({ err: e }, "Impression folder backfill failed");
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
