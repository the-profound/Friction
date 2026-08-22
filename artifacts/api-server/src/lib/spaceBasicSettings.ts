import { z } from "zod";

const spaceBasicSettingsBodySchema = z
  .object({
    name: z
      .string({ message: "공간 이름을 입력해주세요." })
      .trim()
      .min(1, "공간 이름은 1~50자로 입력해주세요.")
      .max(50, "공간 이름은 1~50자로 입력해주세요."),
    description: z
      .string({ message: "공간 설명은 최대 300자로 입력해주세요." })
      .trim()
      .max(300, "공간 설명은 최대 300자로 입력해주세요.")
      .nullable(),
    isAnonymous: z.boolean({ message: "익명 운영 여부를 확인해주세요." }),
  })
  .strict();

export type SpaceBasicSettingsInput = {
  name: string;
  description: string | null;
  isAnonymous: boolean;
};

export function parseSpaceBasicSettingsInput(
  value: unknown,
):
  | { success: true; data: SpaceBasicSettingsInput }
  | { success: false; error: string } {
  const parsed = spaceBasicSettingsBodySchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      error:
        parsed.error.issues[0]?.message ?? "기본 설정 입력값을 확인해주세요.",
    };
  }

  return {
    success: true,
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      isAnonymous: parsed.data.isAnonymous,
    },
  };
}

export type SpaceBasicSettingsAccessIssue =
  | "FORBIDDEN"
  | "NOT_RECRUITING"
  | null;

export function getSpaceBasicSettingsAccessIssue(
  status: "RECRUITING" | "ACTIVE" | "ARCHIVED",
  participation:
    | {
        role: "OPERATOR" | "PARTICIPANT";
        status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
      }
    | null
    | undefined,
): SpaceBasicSettingsAccessIssue {
  if (
    participation?.role !== "OPERATOR" ||
    participation.status !== "APPROVED"
  ) {
    return "FORBIDDEN";
  }
  return status === "RECRUITING" ? null : "NOT_RECRUITING";
}

export function shouldBlockAnonymousConversion(
  wasAnonymous: boolean,
  willBeAnonymous: boolean,
  hasIncompleteParticipation: boolean,
  hasIncompleteCodeRequest: boolean,
): boolean {
  return (
    !wasAnonymous &&
    willBeAnonymous &&
    (hasIncompleteParticipation || hasIncompleteCodeRequest)
  );
}
