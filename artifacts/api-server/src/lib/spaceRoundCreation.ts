export type RoundCreatorParticipation = {
  role: string;
  status: string;
} | null | undefined;

export function canCreateSpaceRound(
  participation: RoundCreatorParticipation,
): boolean {
  return participation?.role === "OPERATOR" && participation.status === "APPROVED";
}

/**
 * A mobile request can time out after Postgres commits. Reuse the existing
 * round in that case instead of treating the client retry as a new duplicate.
 */
export async function createOrReuseSpaceRound<T>({
  insert,
  findExisting,
}: {
  insert: () => Promise<T | null | undefined>;
  findExisting: () => Promise<T | null | undefined>;
}): Promise<{ round: T; replayed: boolean }> {
  const created = await insert();
  if (created) return { round: created, replayed: false };

  const existing = await findExisting();
  if (existing) return { round: existing, replayed: true };

  throw new Error("Round insert did not create or locate a round.");
}