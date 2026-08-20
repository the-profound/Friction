import { z } from "zod";

export const ANONYMOUS_PARTICIPANT_NAME = "참여자";

const spaceNicknameSchema = z
  .string()
  .trim()
  .min(1, "공간 닉네임을 입력해 주세요.")
  .max(20);

type AnonymousSpaceState = {
  isAnonymous: boolean;
  status: "RECRUITING" | "ACTIVE" | "ARCHIVED";
};

export function getAnonymousDisplayName(
  space: AnonymousSpaceState,
  spaceNickname: string | null | undefined,
): string {
  if (!space.isAnonymous) {
    throw new Error("Anonymous display name requested for a non-anonymous space");
  }

  // A recruiting anonymous space intentionally never reveals even the chosen
  // room nickname. Legacy rows have no nickname and retain this safe fallback
  // after the space starts too.
  return space.status === "RECRUITING"
    ? ANONYMOUS_PARTICIPANT_NAME
    : (spaceNickname?.trim() || ANONYMOUS_PARTICIPANT_NAME);
}

export function parseAnonymousSpaceNickname(value: unknown): string | null {
  const parsed = spaceNicknameSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}