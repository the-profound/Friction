import type { QueryKey } from "@tanstack/react-query";
import { getGetSpaceBasicSettingsQueryKey } from "@workspace/api-client-react";

export type SpaceRouteId = string | string[] | undefined;

export type BasicSettingsRequestReadiness =
  | "READY"
  | "INVALID_SPACE"
  | "AUTH_PENDING"
  | "CONFIGURATION_ERROR";

export type BasicSettingsFailure = {
  title: string;
  message: string;
  retryable: boolean;
};

type ApiFailureLike = {
  status?: unknown;
  data?: unknown;
  message?: unknown;
  name?: unknown;
};

/**
 * Expo Router query values may be repeated and become string arrays. A space
 * settings request must have exactly one identifier; joining an array would
 * silently target a different URL than the detail screen.
 */
export function normalizeSpaceRouteId(value: SpaceRouteId): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 ? id : null;
}

/**
 * Basic settings are authorization-scoped, unlike public space metadata.
 * Keep a previous operator's cached response from appearing after an account
 * switch on the same device.
 */
export function getSpaceBasicSettingsScreenQueryKey(
  spaceId: string,
  userId: string | null,
): QueryKey {
  return [
    ...getGetSpaceBasicSettingsQueryKey(spaceId),
    "basic-settings-user",
    userId ?? "auth-pending",
  ];
}

export function getBasicSettingsRequestReadiness({
  spaceId,
  userId,
  authIsLoading,
  hasAccessToken,
  configurationError,
}: {
  spaceId: string | null;
  userId: string | null;
  authIsLoading: boolean;
  hasAccessToken: boolean;
  configurationError: string | null;
}): BasicSettingsRequestReadiness {
  if (configurationError) return "CONFIGURATION_ERROR";
  if (!spaceId) return "INVALID_SPACE";
  if (authIsLoading || !userId || !hasAccessToken) return "AUTH_PENDING";
  return "READY";
}

function getErrorCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function getErrorMessage(error: ApiFailureLike): string {
  return typeof error.message === "string" ? error.message.toLowerCase() : "";
}

/**
 * Keep status-specific access failures actionable instead of flattening them
 * into the same generic retry message as a transport failure.
 */
export function describeBasicSettingsFailure(error: unknown): BasicSettingsFailure {
  const candidate =
    error && typeof error === "object"
      ? (error as ApiFailureLike)
      : ({ message: String(error) } satisfies ApiFailureLike);
  const status =
    typeof candidate.status === "number" ? candidate.status : undefined;
  const code = getErrorCode(candidate.data);
  const message = getErrorMessage(candidate);

  if (
    status === 401 ||
    code === "AUTH_REQUIRED" ||
    code === "AUTH_INVALID"
  ) {
    return {
      title: "로그인 상태를 확인할 수 없어요",
      message: "로그인이 만료되었거나 아직 준비되지 않았어요. 로그인 상태를 확인한 뒤 다시 시도해주세요.",
      retryable: true,
    };
  }

  if (status === 403) {
    return {
      title: "기본 설정 권한이 없어요",
      message: "모집 중인 공간의 승인된 공간장만 기본 설정을 확인할 수 있어요.",
      retryable: false,
    };
  }

  if (code === "SPACE_BASIC_SETTINGS_ANONYMOUS_IDENTITY_INCOMPLETE") {
    return {
      title: "익명 운영으로 바꿀 수 없어요",
      message: "운영자 또는 기존 참여자·신청자 중 공간 닉네임이 없는 사람이 있어요. 닉네임을 확인한 뒤 다시 저장해주세요.",
      retryable: false,
    };
  }

  if (code === "SPACE_BASIC_SETTINGS_NICKNAME_CONFLICT") {
    return {
      title: "이미 사용 중인 공간 닉네임이에요",
      message: "다른 닉네임으로 바꾼 뒤 다시 저장해주세요.",
      retryable: false,
    };
  }

  if (status === 409 || code === "SPACE_BASIC_SETTINGS_NOT_RECRUITING") {
    return {
      title: "공간이 이미 시작되었어요",
      message: "기본 설정은 모집 중인 공간에서만 확인하거나 바꿀 수 있어요.",
      retryable: false,
    };
  }

  if (status === 404) {
    return {
      title: "공간을 찾을 수 없어요",
      message: "공간이 삭제되었거나 더 이상 접근할 수 없어요.",
      retryable: false,
    };
  }

  if (
    message.includes("base url is not configured") ||
    message.includes("api base url")
  ) {
    return {
      title: "앱 연결 설정을 확인할 수 없어요",
      message: "앱을 최신 버전으로 다시 설치하거나 잠시 후 다시 시도해주세요.",
      retryable: false,
    };
  }

  if (
    status === 408 ||
    status === 429 ||
    status === 0 ||
    (status != null && status >= 500) ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("abort")
  ) {
    return {
      title: "네트워크 연결을 확인해주세요",
      message: "인터넷 연결이나 공간 설정 서버 상태를 확인한 뒤 다시 시도해주세요.",
      retryable: true,
    };
  }

  return {
    title: "기본 설정을 불러오지 못했어요",
    message: "잠시 후 다시 시도해주세요.",
    retryable: true,
  };
}