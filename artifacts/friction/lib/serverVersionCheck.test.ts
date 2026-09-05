import { describe, expect, it } from "vitest";
import type { ServerVersion } from "@workspace/api-client-react";
import {
  REQUIRED_SERVER_FEATURES,
  evaluateServerVersionError,
  evaluateServerVersionResult,
} from "./serverVersionCheck";

function makeVersion(overrides: Partial<ServerVersion> = {}): ServerVersion {
  return {
    buildId: "2026-09-05T00:00:00.000Z",
    features: [...REQUIRED_SERVER_FEATURES],
    ...overrides,
  };
}

describe("evaluateServerVersionResult", () => {
  it("is compatible when the server advertises every required feature", () => {
    const result = evaluateServerVersionResult(makeVersion());

    expect(result).toEqual({
      status: "compatible",
      buildId: "2026-09-05T00:00:00.000Z",
    });
  });

  it("is compatible when the server advertises extra, unrecognized features too", () => {
    const result = evaluateServerVersionResult(
      makeVersion({
        features: [...REQUIRED_SERVER_FEATURES, "someFutureFeature" as never],
      }),
    );

    expect(result.status).toBe("compatible");
  });

  it("reports every missing feature on a stale server (old deployed build)", () => {
    const result = evaluateServerVersionResult(makeVersion({ features: [] }));

    expect(result).toEqual({
      status: "mismatch",
      reason: "missing-features",
      buildId: "2026-09-05T00:00:00.000Z",
      missingFeatures: [...REQUIRED_SERVER_FEATURES],
    });
  });

  it("lists only the specific features that are absent", () => {
    const result = evaluateServerVersionResult(
      makeVersion({ features: ["getThoughtQuestionQueue"] }),
    );

    expect(result.status).toBe("mismatch");
    if (result.status === "mismatch" && result.reason === "missing-features") {
      expect(result.missingFeatures).toEqual([
        "refreshThoughtQuestionQueue",
        "activateThoughtQuestion",
        "getThought",
      ]);
    } else {
      throw new Error("expected a missing-features mismatch");
    }
  });

  it("degrades to unknown instead of crashing on a malformed features field", () => {
    const result = evaluateServerVersionResult(
      makeVersion({ features: "not-an-array" as never }),
    );

    // A non-array features field can't tell us anything trustworthy about
    // support, but it must not throw and must not claim a specific feature
    // list is missing/present from garbage input.
    expect(result.status).toBe("mismatch");
    if (result.status === "mismatch" && result.reason === "missing-features") {
      expect(result.missingFeatures).toEqual([...REQUIRED_SERVER_FEATURES]);
    } else {
      throw new Error("expected a missing-features mismatch");
    }
  });

  it("reports unknown when the server response has no usable build id", () => {
    const result = evaluateServerVersionResult(
      makeVersion({ buildId: undefined as never }),
    );

    expect(result).toEqual({ status: "unknown", buildId: null });
  });
});

describe("evaluateServerVersionError", () => {
  it("treats a 404 ApiError from the version endpoint as a definite mismatch", () => {
    const error = { name: "ApiError", status: 404, message: "Not Found" };

    expect(evaluateServerVersionError(error)).toEqual({
      status: "mismatch",
      reason: "version-endpoint-missing",
      buildId: null,
    });
  });

  it("does not mistake an unrelated server error for a version mismatch", () => {
    const error = { name: "ApiError", status: 500, message: "Internal Error" };

    expect(evaluateServerVersionError(error)).toEqual({
      status: "unknown",
      buildId: null,
    });
  });

  it("does not mistake a network/offline failure for a version mismatch", () => {
    const error = new TypeError("Network request failed");

    expect(evaluateServerVersionError(error)).toEqual({
      status: "unknown",
      buildId: null,
    });
  });

  it("handles non-object thrown values without crashing", () => {
    expect(evaluateServerVersionError("boom")).toEqual({
      status: "unknown",
      buildId: null,
    });
    expect(evaluateServerVersionError(null)).toEqual({
      status: "unknown",
      buildId: null,
    });
  });
});
