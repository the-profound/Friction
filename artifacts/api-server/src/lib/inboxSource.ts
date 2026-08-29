export interface InboxSourceNameCandidates {
  explicitSpaceName?: string | null;
  scheduledSpaceName?: string | null;
  legacyScheduledSpaceName?: string | null;
  teamCollectionName?: string | null;
  personalCollectionName?: string | null;
}

/**
 * The inbox API owns source-name resolution so every client surface renders
 * the same provenance. Durable space evidence must win over collection
 * membership because an author may also save the same article personally.
 */
export function resolveInboxSourceName(
  candidates: InboxSourceNameCandidates,
): string | null {
  return (
    candidates.explicitSpaceName ??
    candidates.scheduledSpaceName ??
    candidates.legacyScheduledSpaceName ??
    candidates.teamCollectionName ??
    candidates.personalCollectionName ??
    null
  );
}