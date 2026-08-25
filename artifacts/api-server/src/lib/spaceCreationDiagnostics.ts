type HeaderValue = string | string[] | undefined;

export type SpaceCreationDiagnostic = {
  stage: "space" | "round";
  isAnonymous: boolean | null;
  spaceNicknameIncluded: boolean | null;
  spaceNicknameLength: number | null;
  clientPlatform: "ios" | "android" | "web" | "unknown";
  releaseTrack: "development" | "preview" | "production";
  configurationFingerprint: string | null;
};

function firstHeader(value: HeaderValue): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function parseBooleanHeader(value: HeaderValue): boolean | null {
  const header = firstHeader(value);
  if (header === "true") return true;
  if (header === "false") return false;
  return null;
}

function parseNicknameLength(value: HeaderValue): number | null {
  const header = firstHeader(value);
  if (!header || !/^(?:[0-9]|1[0-9]|20)$/.test(header)) return null;
  return Number(header);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getReleaseTrack(value: HeaderValue): SpaceCreationDiagnostic["releaseTrack"] {
  const header = firstHeader(value);
  return header === "preview" || header === "production" ? header : "development";
}

function getClientPlatform(value: HeaderValue): SpaceCreationDiagnostic["clientPlatform"] {
  const header = firstHeader(value);
  return header === "ios" || header === "android" || header === "web" ? header : "unknown";
}

function getConfigurationFingerprint(value: HeaderValue): string | null {
  const header = firstHeader(value);
  return header && /^[a-f0-9]{16}$/.test(header) ? header : null;
}

/**
 * Convert the creation request to a strict operational summary. It intentionally
 * excludes names, nicknames, request bodies, ids, and authentication material.
 */
export function getSpaceCreationDiagnostic(
  stage: SpaceCreationDiagnostic["stage"],
  headers: Record<string, HeaderValue>,
  body: unknown,
): SpaceCreationDiagnostic {
  const request = getRecord(body);
  const nicknameIncludedInBody =
    request !== null && Object.prototype.hasOwnProperty.call(request, "spaceNickname");
  const nicknameLengthInBody =
    typeof request?.spaceNickname === "string" ? request.spaceNickname.length : null;
  const isAnonymousInBody =
    typeof request?.isAnonymous === "boolean" ? request.isAnonymous : null;

  return {
    stage,
    isAnonymous:
      stage === "space"
        ? isAnonymousInBody
        : parseBooleanHeader(headers["x-friction-space-anonymous"]),
    spaceNicknameIncluded:
      stage === "space"
        ? nicknameIncludedInBody
        : parseBooleanHeader(headers["x-friction-space-nickname-included"]),
    spaceNicknameLength:
      stage === "space"
        ? nicknameLengthInBody
        : parseNicknameLength(headers["x-friction-space-nickname-length"]),
    clientPlatform: getClientPlatform(headers["x-friction-client-platform"]),
    releaseTrack: getReleaseTrack(headers["x-friction-release-track"]),
    configurationFingerprint: getConfigurationFingerprint(
      headers["x-friction-release-fingerprint"],
    ),
  };
}