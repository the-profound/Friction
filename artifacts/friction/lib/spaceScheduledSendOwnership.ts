type ScheduledSendWithAuthor = {
  letter?: {
    authorId?: string | null;
  } | null;
};

/**
 * Keep the schedule screen personal even if a stale or incorrectly scoped
 * response reaches the client. Missing ownership data is not safe to display.
 */
export function getOwnedSpaceScheduledSends<T extends ScheduledSendWithAuthor>(
  sends: T[],
  userId: string | null | undefined,
): T[] {
  if (!userId) return [];
  return sends.filter((send) => send.letter?.authorId === userId);
}