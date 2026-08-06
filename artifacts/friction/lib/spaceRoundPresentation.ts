export type SpaceRoundPresentation = {
  roundNumber: number;
};

export function roundStatusLabel(status: string): string {
  if (status === "ACTIVE") return "진행 중";
  if (status === "UPCOMING") return "예정";
  if (status === "COMPLETED") return "종료";
  return status;
}

export function sortSpaceRoundsNewestFirst<T extends SpaceRoundPresentation>(
  rounds: readonly T[],
): T[] {
  return [...rounds].sort((a, b) => b.roundNumber - a.roundNumber);
}

/**
 * Completed-round covers stay vivid in the space detail carousel. Other letter
 * lists retain the shared card's normal read-state dimming.
 */
export function shouldDimSpaceRoundLetter(
  roundStatus: string,
  isRead: boolean | null | undefined,
): boolean {
  return roundStatus !== "COMPLETED" && !!isRead;
}