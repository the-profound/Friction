import { parseAnonymousSpaceNickname } from "./anonymousSpaceIdentity";

export type ParsedSpaceCreationIdentity =
  | {
      success: true;
      isAnonymous: boolean;
      anonymousNickname: string | null;
    }
  | {
      success: false;
      error: string;
    };

const SPACE_CREATION_KEY_PATTERN = /^sc_[a-z0-9]{16,60}$/;

export function parseSpaceCreationKey(value: unknown): string | null {
  return typeof value === "string" && SPACE_CREATION_KEY_PATTERN.test(value)
    ? value
    : null;
}

/**
 * Enforces the identity contract independently of the UI: real-name spaces
 * explicitly send false without a room nickname, while anonymous spaces send
 * true with a 1–20 character room nickname.
 */
export function parseSpaceCreationIdentity(input: unknown): ParsedSpaceCreationIdentity {
  const body =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? input as Record<string, unknown>
      : null;
  if (!body || typeof body.isAnonymous !== "boolean") {
    return {
      success: false,
      error: "익명 운영 여부를 올바르게 선택해주세요.",
    };
  }

  const includesNickname = Object.prototype.hasOwnProperty.call(body, "spaceNickname");
  if (!body.isAnonymous) {
    return includesNickname
      ? {
          success: false,
          error: "실명 공간에는 공간 닉네임을 입력하지 않습니다.",
        }
      : { success: true, isAnonymous: false, anonymousNickname: null };
  }

  const anonymousNickname = parseAnonymousSpaceNickname(body.spaceNickname);
  if (!anonymousNickname) {
    return {
      success: false,
      error: "익명 공간에 참여하려면 1~20자의 공간 닉네임이 필요합니다.",
    };
  }

  return { success: true, isAnonymous: true, anonymousNickname };
}