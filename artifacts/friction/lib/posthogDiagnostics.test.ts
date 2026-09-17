import { describe, expect, it, vi } from "vitest";
import {
  createPostHogDiagnostics,
  captureAndFlushDeliveryProbe,
  initializePostHogClient,
  type PostHogDiagnostic,
  type PostHogDiagnosticKind,
} from "./posthogDiagnostics";

function harness() {
  const events: PostHogDiagnostic[] = [];
  return {
    events,
    diagnostics: createPostHogDiagnostics({
      host: "us.i.posthog.com",
      tokenFingerprint: "0123456789abcdef",
      sink: (event) => events.push(event),
    }),
  };
}

describe("PostHog diagnostics", () => {
  it("classifies missing configuration and successful initialization", () => {
    const kinds: PostHogDiagnosticKind[] = [];
    const create = vi.fn(() => ({ client: true }));
    expect(initializePostHogClient({ token: "", create, report: (kind) => kinds.push(kind) })).toBeNull();
    expect(create).not.toHaveBeenCalled();

    expect(
      initializePostHogClient({
        token: "phc_not_logged",
        create,
        report: (kind) => kinds.push(kind),
      }),
    ).toEqual({ client: true });
    expect(kinds).toEqual(["missing_configuration", "initialized"]);
  });

  it("classifies a constructor failure without throwing", () => {
    const kinds: PostHogDiagnosticKind[] = [];
    expect(
      initializePostHogClient({
        token: "phc_not_logged",
        create: () => {
          throw new Error("native module unavailable");
        },
        report: (kind) => kinds.push(kind),
      }),
    ).toBeNull();
    expect(kinds).toEqual(["constructor_failure"]);
  });

  it("reports initialization without exposing a token", () => {
    const { diagnostics, events } = harness();
    diagnostics.report("initialized");
    expect(events).toEqual([{
      kind: "initialized",
      host: "us.i.posthog.com",
      tokenFingerprint: "0123456789abcdef",
    }]);
    expect(JSON.stringify(events)).not.toContain("phc_");
  });

  it("classifies network failures", async () => {
    const { diagnostics, events } = harness();
    await diagnostics.probeConnectivity(vi.fn().mockRejectedValue(new Error("offline")));
    expect(events.map(({ kind }) => kind)).toEqual(["network_failure"]);
  });

  it("probes the sanitized host as an absolute HTTPS URL", async () => {
    const { diagnostics, events } = harness();
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await diagnostics.probeConnectivity(fetcher);
    expect(fetcher).toHaveBeenCalledWith("https://us.i.posthog.com", { method: "HEAD" });
    expect(events).toEqual([]);
  });

  it("classifies rejected flushes and keeps them non-blocking", async () => {
    const { diagnostics, events } = harness();
    await expect(
      diagnostics.flush({ flush: vi.fn().mockRejectedValue(new Error("rejected")) }),
    ).resolves.toBe(false);
    expect(events.at(-1)?.kind).toBe("flush_failure");
  });

  it("records a successful explicit flush", async () => {
    const { diagnostics, events } = harness();
    await expect(diagnostics.flush({ flush: vi.fn().mockResolvedValue(undefined) })).resolves.toBe(true);
    expect(events.at(-1)?.kind).toBe("delivery_probe_flushed");
  });

  it("captures the controlled event before flushing it", async () => {
    const calls: string[] = [];
    const client = {
      capture: vi.fn(() => calls.push("capture")),
      flush: vi.fn(async () => {
        calls.push("flush");
      }),
    };
    await expect(
      captureAndFlushDeliveryProbe({
        client,
        properties: {
          release_track: "production",
          configuration_fingerprint: "release-fingerprint",
        },
        flush: async (value) => {
          await value.flush();
          return true;
        },
      }),
    ).resolves.toBe(true);
    expect(calls).toEqual(["capture", "flush"]);
    expect(client.capture).toHaveBeenCalledWith("$friction_delivery_probe", {
      release_track: "production",
      configuration_fingerprint: "release-fingerprint",
    });
  });
});