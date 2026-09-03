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

const { sendSilentPush } = await import("./pushSender");

describe("push operational outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts ticket failures without logging tokens, users, or push body", async () => {
    state.send.mockResolvedValueOnce([
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const results = await sendSilentPush(
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

  it("classifies a thrown Expo chunk as a retryable delivery failure", async () => {
    state.send.mockRejectedValueOnce(new Error("upstream response body"));

    const results = await sendSilentPush(
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