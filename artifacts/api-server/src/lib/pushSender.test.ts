import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  send: vi.fn(),
  deleteWhere: vi.fn(async () => []),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    static isExpoPushToken(token: string) {
      return token.startsWith("ExponentPushToken[");
    }
    chunkPushNotifications(messages: unknown[]) {
      return [messages];
    }
    sendPushNotificationsAsync(messages: unknown[]) {
      return state.send(messages);
    }
  }
  return { default: Expo };
});

vi.mock("@workspace/db", () => ({
  db: {
    delete: () => ({ where: state.deleteWhere }),
  },
  pushTokensTable: { token: "token" },
}));

vi.mock("./logger", () => ({
  logger: {
    info: state.info,
    warn: state.warn,
    error: state.error,
  },
}));

const { sendPush } = await import("./pushSender");

describe("push operational outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts ticket failures without logging tokens, users, or push body", async () => {
    state.send.mockResolvedValueOnce([
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const results = await sendPush(
      [{
        userId: "private-user",
        token: "ExponentPushToken[private-token]",
        platform: "ios",
      }],
      "private letter notification body",
      { type: "LETTER_ARRIVED" },
      { correlationId: "req_abcdefghijklmnopqrst" },
    );

    expect(results).toEqual([
      expect.objectContaining({ success: false, error: "DeviceNotRegistered" }),
    ]);
    expect(state.deleteWhere).toHaveBeenCalledOnce();
    const operationalLog = JSON.stringify(state.error.mock.calls);
    expect(operationalLog).toContain('"failureCount":1');
    expect(operationalLog).not.toContain("private-user");
    expect(operationalLog).not.toContain("private-token");
    expect(operationalLog).not.toContain("private letter");
  });

  it("sends a normal (banner + sound) notification, not a silent one", async () => {
    state.send.mockResolvedValueOnce([{ status: "ok" }]);

    await sendPush(
      [{ userId: "ios-user", token: "ExponentPushToken[ios-token]", platform: "ios" }],
      "body",
      { type: "LETTER_ARRIVED" },
      { correlationId: "req_abcdefghijklmnopqrst" },
    );

    const [iosMessages] = state.send.mock.calls[0]!;
    expect(iosMessages[0]).toMatchObject({ sound: "default" });
    expect(iosMessages[0]).not.toHaveProperty("interruptionLevel");

    state.send.mockResolvedValueOnce([{ status: "ok" }]);

    await sendPush(
      [{ userId: "android-user", token: "ExponentPushToken[android-token]", platform: "android" }],
      "body",
      { type: "LETTER_ARRIVED" },
      { correlationId: "req_abcdefghijklmnopqrst" },
    );

    const [androidMessages] = state.send.mock.calls[1]!;
    expect(androidMessages[0]).toMatchObject({
      sound: "default",
      channelId: "letter-arrived",
      priority: "high",
    });
  });

  it("classifies a thrown Expo chunk as a retryable delivery failure", async () => {
    state.send.mockRejectedValueOnce(new Error("upstream response body"));

    const results = await sendPush(
      [{
        userId: "user",
        token: "ExponentPushToken[token]",
        platform: "android",
      }],
      "body",
      undefined,
      { correlationId: "req_abcdefghijklmnopqrst" },
    );

    expect(results).toEqual([
      expect.objectContaining({ success: false, error: "chunk_send_failed" }),
    ]);
    const operationalLog = JSON.stringify(state.error.mock.calls);
    expect(operationalLog).toContain("push_delivery_failed");
    expect(operationalLog).not.toContain("upstream response body");
  });
});