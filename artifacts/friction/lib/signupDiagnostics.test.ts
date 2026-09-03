import { describe, expect, it } from "vitest";
import {
  getSignupFailureAlertContent,
  getSignupFailureInlineMessage,
  getSignupAuthFailure,
  getSignupProfileSyncFailure,
  getUnknownSignupFailure,
} from "./signupDiagnostics";

const diagnosticId = "af_m5rf1aa1b2c3d4e5";

describe("signup diagnostic failures", () => {
  it("classifies Supabase responses without returning their original message", () => {
    const upstreamMessage = "User already registered: person@example.test";
    const result = getSignupAuthFailure(
      { name: "AuthApiError", message: upstreamMessage },
      diagnosticId,
    );

    expect(result).toEqual({
      code: "SIGNUP_AUTH_SERVICE",
      diagnosticId,
      message: "이미 가입된 이메일입니다. 로그인해주세요.",
    });
    expect(JSON.stringify(result)).not.toContain("person@example.test");
  });

  it("builds popup content exclusively from the safe failure result", () => {
    const content = getSignupFailureAlertContent(
      getSignupAuthFailure(
        { message: "server returned person@example.test and access-token-value" },
        diagnosticId,
      ),
    );

    expect(content).toEqual({
      title: "회원가입에 실패했어요",
      message:
        "인증 서비스에서 가입을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.\n\n오류 코드: SIGNUP_AUTH_SERVICE\n진단 번호: af_m5rf1aa1b2c3d4e5",
    });
    expect(JSON.stringify(content)).not.toContain("person@example.test");
    expect(JSON.stringify(content)).not.toContain("access-token-value");
  });

  it("keeps safe signup guidance available for inline form feedback", () => {
    const failure = getSignupAuthFailure(
      { message: "server returned person@example.test and access-token-value" },
      diagnosticId,
    );

    expect(getSignupFailureInlineMessage(failure)).toBe(
      "인증 서비스에서 가입을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    );
    expect(getSignupFailureInlineMessage(failure)).not.toContain("person@example.test");
    expect(getSignupFailureInlineMessage(failure)).not.toContain("access-token-value");
  });

  it("distinguishes a native auth network failure", () => {
    expect(
      getSignupAuthFailure({ name: "TypeError", message: "Network request failed" }, diagnosticId),
    ).toMatchObject({
      code: "SIGNUP_NETWORK",
      diagnosticId,
    });
  });

  it("does not mistake an authentication service response for a network outage", () => {
    expect(
      getSignupAuthFailure(
        {
          name: "AuthApiError",
          message: "rate limited after a network timeout response",
          status: 429,
        },
        diagnosticId,
      ),
    ).toMatchObject({
      code: "SIGNUP_AUTH_SERVICE",
      diagnosticId,
    });
  });

  it("keeps stable profile-sync server codes while discarding response details", () => {
    const result = getSignupProfileSyncFailure(
      {
        name: "ApiError",
        message: "HTTP 503: database password leaked here",
        data: { code: "SYNC_DATABASE_UNAVAILABLE", error: "database password leaked here" },
      },
      diagnosticId,
    );

    expect(result).toMatchObject({
      code: "SYNC_DATABASE_UNAVAILABLE",
      diagnosticId,
    });
    expect(JSON.stringify(result)).not.toContain("database password");
  });

  it("distinguishes an unreachable app API from an unknown profile-sync failure", () => {
    expect(
      getSignupProfileSyncFailure(
        { name: "AbortError", message: "request timeout" },
        diagnosticId,
      ),
    ).toMatchObject({ code: "SIGNUP_API_UNREACHABLE", diagnosticId });
    expect(getUnknownSignupFailure(diagnosticId)).toMatchObject({
      code: "SIGNUP_UNKNOWN",
      diagnosticId,
    });
  });

  it("does not label a reached API's 5xx response as unreachable", () => {
    expect(
      getSignupProfileSyncFailure(
        {
          name: "ApiError",
          message: "HTTP 503 network timeout response",
          status: 503,
          data: {},
        },
        diagnosticId,
      ),
    ).toMatchObject({
      code: "SYNC_UNKNOWN",
      diagnosticId,
    });
  });

  it("keeps each sync boundary failure actionable and distinct", () => {
    const cases = [
      ["SYNC_AUTH_INVALID", "로그인 인증이 만료됐거나 누락됐습니다"],
      ["SYNC_AUTH_UNAVAILABLE", "인증 서버가 일시적으로 응답하지 않습니다"],
      ["SYNC_DATABASE_UNAVAILABLE", "프로필 저장 서버가 일시적으로 응답하지 않습니다"],
      ["SYNC_IDENTITY_MISMATCH", "로그인한 계정 정보와 프로필 정보가 일치하지 않습니다"],
    ] as const;

    for (const [code, message] of cases) {
      const result = getSignupProfileSyncFailure(
        { data: { code }, name: "ApiError" },
        diagnosticId,
      );
      expect(result).toMatchObject({ code, diagnosticId });
      expect(result.message).toContain(message);
    }
  });
});