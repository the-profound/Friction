import type { CreateSpaceBody } from "@workspace/api-client-react";

export type SpaceCreateSubmissionInput = {
  name: string;
  description: string;
  isAnonymous: boolean;
  plannedStartsAt: string | null;
  roundCount: number;
  maxParticipants: number | null;
  defaultCenterInterval: number;
  defaultCenterCount: number;
  scheduleType: "N_DAY" | "WEEKDAY";
  weekdays: number[] | null;
  operatorParticipates: boolean;
  spaceNickname: string;
  creationKey: string;
};

export type SpaceCreationStage = "space" | "round";

export type SpaceCreationDiagnosticContext = {
  platform: "ios" | "android" | "web" | "unknown";
  releaseTrack: "development" | "preview" | "production";
  configurationFingerprint: string | null;
};

export type SpaceCreationSubmissionDiagnostic = {
  isAnonymous: boolean;
  spaceNicknameIncluded: boolean | null;
  spaceNicknameLength: number | null;
  platform: SpaceCreationDiagnosticContext["platform"];
  releaseTrack: SpaceCreationDiagnosticContext["releaseTrack"];
  configurationFingerprint: string | null;
};

export function buildSpaceCreateSubmission(
  input: SpaceCreateSubmissionInput,
): CreateSpaceBody {
  const submission: CreateSpaceBody = {
    name: input.name.trim(),
    description: input.description.trim() || null,
    isAnonymous: input.isAnonymous,
    plannedStartsAt: input.plannedStartsAt,
    roundCount: input.roundCount,
    maxParticipants: input.maxParticipants,
    defaultCenterInterval: input.defaultCenterInterval,
    defaultCenterCount: input.defaultCenterCount,
    scheduleType: input.scheduleType,
    weekdays: input.weekdays,
    operatorParticipates: input.operatorParticipates,
    creationKey: input.creationKey,
  };

  if (input.isAnonymous) {
    submission.spaceNickname = input.spaceNickname.trim();
  }

  return submission;
}

export function getSpaceCreationDiagnosticContext(
  releaseMetadata: unknown,
  platform: unknown,
): SpaceCreationDiagnosticContext {
  const release =
    typeof releaseMetadata === "object" && releaseMetadata !== null
      ? releaseMetadata as Record<string, unknown>
      : {};
  const releaseTrack =
    release.track === "preview" || release.track === "production"
      ? release.track
      : "development";
  const configurationFingerprint =
    typeof release.configurationFingerprint === "string" &&
    /^[a-f0-9]{16}$/.test(release.configurationFingerprint)
      ? release.configurationFingerprint
      : null;
  const safePlatform =
    platform === "ios" || platform === "android" || platform === "web"
      ? platform
      : "unknown";

  return { platform: safePlatform, releaseTrack, configurationFingerprint };
}

export function getSpaceCreationSubmissionDiagnostic(
  submission: CreateSpaceBody,
  context: SpaceCreationDiagnosticContext,
): SpaceCreationSubmissionDiagnostic {
  const spaceNicknameIncluded = Object.prototype.hasOwnProperty.call(
    submission,
    "spaceNickname",
  );
  const spaceNicknameLength =
    typeof submission.spaceNickname === "string" ? submission.spaceNickname.length : null;

  return {
    isAnonymous: submission.isAnonymous === true,
    spaceNicknameIncluded,
    spaceNicknameLength,
    ...context,
  };
}

export function buildSpaceCreationDiagnosticHeaders(
  diagnostic: SpaceCreationSubmissionDiagnostic,
): Record<string, string> {
  return {
    "x-friction-client-platform": diagnostic.platform,
    "x-friction-release-track": diagnostic.releaseTrack,
    ...(diagnostic.configurationFingerprint
      ? { "x-friction-release-fingerprint": diagnostic.configurationFingerprint }
      : {}),
    "x-friction-space-anonymous": String(diagnostic.isAnonymous),
    ...(diagnostic.spaceNicknameIncluded !== null
      ? { "x-friction-space-nickname-included": String(diagnostic.spaceNicknameIncluded) }
      : {}),
    ...(diagnostic.spaceNicknameLength !== null
      ? { "x-friction-space-nickname-length": String(diagnostic.spaceNicknameLength) }
      : {}),
  };
}

export function getRecoveredSpaceCreationDiagnostic(
  isAnonymous: boolean,
  context: SpaceCreationDiagnosticContext,
): SpaceCreationSubmissionDiagnostic {
  return {
    isAnonymous,
    spaceNicknameIncluded: null,
    spaceNicknameLength: null,
    ...context,
  };
}

export function getSpaceCreationFailureMessage(
  stage: SpaceCreationStage,
  status?: number,
): string {
  if (stage === "round") {
    return "공간은 만들어졌지만 회차를 만드는 단계에서 문제가 생겼어요. 아래에서 회차 생성을 다시 시도해주세요.";
  }
  if (status === 409) {
    return "공간 생성에 실패했어요. 익명 공간 닉네임이 이미 사용 중인지 확인해주세요.";
  }
  if (status === 400) {
    return "공간 생성에 실패했어요. 입력한 공간 설정을 확인한 뒤 다시 시도해주세요.";
  }
  if (status === 401 || status === 403) {
    return "공간 생성에 실패했어요. 로그인 상태를 확인한 뒤 다시 시도해주세요.";
  }
  return "공간을 만드는 단계에서 문제가 생겼어요. 다시 시도해주세요.";
}