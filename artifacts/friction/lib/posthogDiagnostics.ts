export type PostHogDiagnosticKind =
  | "missing_configuration"
  | "initialized"
  | "constructor_failure"
  | "network_failure"
  | "flush_failure"
  | "delivery_probe_flushed";

export interface PostHogDiagnostic {
  kind: PostHogDiagnosticKind;
  host: string | null;
  tokenFingerprint: string | null;
}

type DiagnosticSink = (diagnostic: PostHogDiagnostic) => void;

export function initializePostHogClient<T>(options: {
  token: string;
  create: (token: string) => T;
  report: (kind: PostHogDiagnosticKind) => void;
}): T | null {
  if (!options.token.trim()) {
    options.report("missing_configuration");
    return null;
  }
  try {
    const client = options.create(options.token);
    options.report("initialized");
    return client;
  } catch {
    options.report("constructor_failure");
    return null;
  }
}

export function createPostHogDiagnostics(options: {
  host: string | null;
  tokenFingerprint: string | null;
  sink?: DiagnosticSink;
}) {
  const report = (kind: PostHogDiagnosticKind): void => {
    const diagnostic = {
      kind,
      host: options.host,
      tokenFingerprint: options.tokenFingerprint,
    };
    (options.sink ?? defaultSink)(diagnostic);
  };

  return {
    report,
    async probeConnectivity(fetcher: typeof fetch): Promise<void> {
      if (!options.host) return;
      try {
        await fetcher(`https://${options.host}`, { method: "HEAD" });
      } catch {
        report("network_failure");
      }
    },
    async flush(client: { flush(): Promise<void> }): Promise<boolean> {
      try {
        await client.flush();
        report("delivery_probe_flushed");
        return true;
      } catch {
        report("flush_failure");
        return false;
      }
    },
  };
}

export async function captureAndFlushDeliveryProbe(options: {
  client: {
    capture(event: string, properties: Record<string, string | null>): void;
    flush(): Promise<void>;
  };
  properties: Record<string, string | null>;
  flush: (client: { flush(): Promise<void> }) => Promise<boolean>;
}): Promise<boolean> {
  options.client.capture("$friction_delivery_probe", options.properties);
  return options.flush(options.client);
}

function defaultSink(diagnostic: PostHogDiagnostic): void {
  const method =
    diagnostic.kind === "initialized" || diagnostic.kind === "delivery_probe_flushed"
      ? console.info
      : console.warn;
  method("[PostHog diagnostic]", diagnostic);
}