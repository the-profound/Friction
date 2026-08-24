type RecruitmentMember = {
  role: string;
};

/**
 * `maxParticipants` only caps people recruited into the space. The operator
 * always has a separate role, whether or not they submit a round entry.
 */
export function countRecruitmentParticipants(
  members: readonly RecruitmentMember[],
): number {
  return members.filter((member) => member.role !== "OPERATOR").length;
}

export function isRecruitmentFull(
  maxParticipants: number | null | undefined,
  recruitParticipantCount: number,
): boolean {
  return maxParticipants != null && recruitParticipantCount >= maxParticipants;
}