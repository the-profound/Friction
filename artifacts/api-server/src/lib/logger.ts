import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers",
    "req.body",
    "res.headers['set-cookie']",
    "*.authorization",
    "*.cookie",
    "*.token",
    "*.accessToken",
    "*.refreshToken",
    "*.email",
    "*.body",
    "*.content",
    "*.markdown",
    "*.password",
  ],
  serializers: {
    err(error: unknown) {
      if (!error || typeof error !== "object") return { type: "UnknownError" };
      const candidate = error as { name?: unknown; code?: unknown; status?: unknown };
      return {
        type:
          typeof candidate.name === "string" && /^[A-Za-z]+Error$/.test(candidate.name)
            ? candidate.name
            : "Error",
        code:
          typeof candidate.code === "string" && /^[A-Z0-9_]{2,40}$/.test(candidate.code)
            ? candidate.code
            : undefined,
        status: typeof candidate.status === "number" ? candidate.status : undefined,
      };
    },
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
