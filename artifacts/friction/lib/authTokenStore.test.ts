import { afterEach, describe, expect, it } from "vitest";
import {
  getCurrentAuthAccessToken,
  setCurrentAuthSession,
} from "./authTokenStore";

const now = new Date("2026-08-16T00:00:00.000Z").getTime();

afterEach(() => setCurrentAuthSession(null));

describe("auth token store", () => {
  it("only supplies a currently valid, restored access token", () => {
    setCurrentAuthSession({
      access_token: "valid-token",
      expires_at: Math.floor((now + 60_000) / 1000),
    });
    expect(getCurrentAuthAccessToken(now)).toBe("valid-token");

    setCurrentAuthSession({
      access_token: "expired-token",
      expires_at: Math.floor((now - 1_000) / 1000),
    });
    expect(getCurrentAuthAccessToken(now)).toBeNull();
  });
});