/**
 * `maxParticipants` is the number of recruitable participants. The operator
 * has a separate role and never consumes one of those places.
 */
export function isRecruitmentFull(
  maxParticipants: number | null | undefined,
  recruitParticipantCount: number,
): boolean {
  return maxParticipants != null && recruitParticipantCount >= maxParticipants;
}

type ParticipationCapacityState = {
  status: string;
  role: string;
};

/**
 * A status/role mutation consumes a place only when it newly makes someone an
 * approved recruitable participant. Re-approving an existing participant must
 * not reject an otherwise harmless edit while the space is full.
 */
export function startsConsumingRecruitmentPlace(
  current: ParticipationCapacityState,
  next: ParticipationCapacityState,
): boolean {
  const nextConsumes = next.status === "APPROVED" && next.role !== "OPERATOR";
  const currentConsumes =
    current.status === "APPROVED" && current.role !== "OPERATOR";
  return nextConsumes && !currentConsumes;
}