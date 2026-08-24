import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSpaceBasicSettings,
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";
import {
  describeBasicSettingsFailure,
  getBasicSettingsRequestReadiness,
  getSpaceBasicSettingsScreenQueryKey,
  normalizeSpaceRouteId,
} from "./spaceBasicSettingsAccess";

afterEach(() => {
  setBaseUrl(null);
  setAuthTokenGetter(null);
  vi.restoreAllMocks();
});

describe("space basic settings request guard", () => {
  it("waits for a validated token instead of using a user id as authorization", () => {
    expect(
      getBasicSettingsRequestReadiness({
        spaceId: "space-1",
        userId: "user-1",
        authIsLoading: false,
        hasAccessToken: false,
        configurationError: null,
      }),
    ).toBe("AUTH_PENDING");

    expect(
      getBasicSettingsRequestReadiness({
        spaceId: "space-1",
        userId: "user-1",
        authIsLoading: false,
        hasAccessToken: true,
        configurationError: null,
      }),
    ).toBe("READY");
  });

  it("keeps malformed routes and invalid runtime configuration from making a request", () => {
    expect(
      getBasicSettingsRequestReadiness({
        spaceId: null,
        userId: "user-1",
        authIsLoading: false,
        hasAccessToken: true,
        configurationError: null,
      }),
    ).toBe("INVALID_SPACE");
    expect(
      getBasicSettingsRequestReadiness({
        spaceId: "space-1",
        userId: "user-1",
        authIsLoading: false,
        hasAccessToken: true,
        configurationError: "EXPO_PUBLIC_DOMAIN is missing",
      }),
    ).toBe("CONFIGURATION_ERROR");
  });

  it("rejects ambiguous route identifiers and scopes cached settings to the user", () => {
    expect(normalizeSpaceRouteId(" space-1 ")).toBe("space-1");
    expect(normalizeSpaceRouteId(["space-1", "space-2"])).toBeNull();
    expect(normalizeSpaceRouteId(undefined)).toBeNull();

    expect(getSpaceBasicSettingsScreenQueryKey("space-1", "operator-1")).not.toEqual(
      getSpaceBasicSettingsScreenQueryKey("space-1", "participant-1"),
    );
  });

  it("uses the configured API host and a bearer token once authentication is ready", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "모임",
          description: "소개",
          isAnonymous: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    setBaseUrl("https://api.example.test");
    setAuthTokenGetter(() => "validated-token");

    await getSpaceBasicSettings("space-1");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/api/spaces/space-1/basic-settings");
    expect(new Headers(options?.headers).get("authorization")).toBe(
      "Bearer validated-token",
    );
  });
});

describe("space basic settings failure messages", () => {
  it.each([
    [{ status: 401, data: { code: "AUTH_INVALID" } }, "로그인 상태를 확인할 수 없어요", true],
    [{ status: 403 }, "기본 설정 권한이 없어요", false],
    [{ status: 409 }, "공간이 이미 시작되었어요", false],
    [
      {
        status: 409,
        data: { code: "SPACE_BASIC_SETTINGS_NOT_RECRUITING" },
      },
      "공간이 이미 시작되었어요",
      false,
    ],
    [
      {
        status: 409,
        data: { code: "SPACE_BASIC_SETTINGS_ANONYMOUS_IDENTITY_INCOMPLETE" },
      },
      "익명 운영으로 바꿀 수 없어요",
      false,
    ],
    [
      {
        status: 409,
        data: { code: "SPACE_BASIC_SETTINGS_NICKNAME_CONFLICT" },
      },
      "이미 사용 중인 공간 닉네임이에요",
      false,
    ],
    [{ status: 404 }, "공간을 찾을 수 없어요", false],
    [{ message: "Network request failed" }, "네트워크 연결을 확인해주세요", true],
  ] as const)(
    "distinguishes error %#",
    (error, title, retryable) => {
      expect(describeBasicSettingsFailure(error)).toMatchObject({
        title,
        retryable,
      });
    },
  );
});