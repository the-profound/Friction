const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type RelationshipNeighbor = {
  userAId: string;
  userBId: string;
  createdAt: Date;
  acceptedAt: Date;
};

export type RelationshipSend = {
  id: string;
  senderId: string;
  recipientId: string | null;
  inboxId: string | null;
  replyToInboxId: string | null;
  targetType: string;
  deliverySlot: Date;
  sentAt: Date;
};

export type RelationshipInbox = {
  id: string;
  openedAt: Date | null;
};

function pairKey(a: string, b: string): string | null {
  if (!a || !b || a === b) return null;
  return [a, b].sort().join(":");
}

function mean(values: number[]): number | null {
  return values.length === 0
    ? null
    : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function calculateRelationshipMetrics(
  neighbors: RelationshipNeighbor[],
  sends: RelationshipSend[],
  inboxRows: RelationshipInbox[],
  now = new Date(),
) {
  const eligibleSends = sends
    .filter((send) =>
      (send.targetType === "person" || send.targetType === "reply") &&
      send.recipientId !== null &&
      send.senderId !== send.recipientId &&
      send.deliverySlot <= now,
    )
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const inboxById = new Map(inboxRows.map((row) => [row.id, row]));
  const acceptedDurations = neighbors
    .map((row) => row.acceptedAt.getTime() - row.createdAt.getTime())
    .filter((duration) => duration >= 0);
  const neighborPairKeys = new Set(
    neighbors
      .map((row) => pairKey(row.userAId, row.userBId))
      .filter((key): key is string => key !== null),
  );
  const activeSince = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const activePairKeys = new Set(
    eligibleSends
      .filter((send) => send.deliverySlot >= activeSince)
      .map((send) => pairKey(send.senderId, send.recipientId!))
      .filter(
        (key): key is string => key !== null && neighborPairKeys.has(key),
      ),
  );
  const weekSince = new Date(now.getTime() - WEEK_MS);
  const weeklySendCount = eligibleSends.filter(
    (send) => {
      const key = pairKey(send.senderId, send.recipientId!);
      return send.deliverySlot >= weekSince && key !== null && neighborPairKeys.has(key);
    },
  ).length;

  const originals = eligibleSends.filter((send) => !send.replyToInboxId);
  const repliesByInbox = new Map<string, RelationshipSend>();
  for (const send of eligibleSends) {
    if (!send.replyToInboxId || repliesByInbox.has(send.replyToInboxId)) continue;
    repliesByInbox.set(send.replyToInboxId, send);
  }
  const repliedOriginals = originals.filter(
    (send) => send.inboxId && repliesByInbox.has(send.inboxId),
  );
  const firstOriginalByPair = new Map<string, RelationshipSend>();
  for (const original of originals) {
    const key = pairKey(original.senderId, original.recipientId!);
    if (!key || firstOriginalByPair.has(key)) continue;
    firstOriginalByPair.set(key, original);
  }
  const firstReplyByPair = new Map<string, RelationshipSend>();
  for (const original of repliedOriginals) {
    const key = pairKey(original.senderId, original.recipientId!);
    if (!key) continue;
    const reply = repliesByInbox.get(original.inboxId!)!;
    const current = firstReplyByPair.get(key);
    if (!current || reply.sentAt < current.sentAt) {
      firstReplyByPair.set(key, reply);
    }
  }
  const firstReplyDurations = [...firstOriginalByPair].flatMap(([key, original]) => {
    const reply = firstReplyByPair.get(key);
    return reply
      ? [Math.max(0, reply.sentAt.getTime() - original.sentAt.getTime())]
      : [];
  });
  const openedOriginals = originals.filter(
    (send) => send.inboxId && inboxById.get(send.inboxId)?.openedAt,
  );

  const directionsByPairWeek = new Map<string, Set<string>>();
  for (const send of eligibleSends) {
    const key = pairKey(send.senderId, send.recipientId!);
    if (!key) continue;
    const week = Math.floor(send.deliverySlot.getTime() / WEEK_MS);
    const mapKey = `${key}|${week}`;
    const directions = directionsByPairWeek.get(mapKey) ?? new Set<string>();
    directions.add(`${send.senderId}>${send.recipientId}`);
    directionsByPairWeek.set(mapKey, directions);
  }
  const mutualPairWeeks = new Map<string, Set<number>>();
  for (const [mapKey, directions] of directionsByPairWeek) {
    if (directions.size < 2) continue;
    const separator = mapKey.lastIndexOf("|");
    const key = mapKey.slice(0, separator);
    const week = Number(mapKey.slice(separator + 1));
    const weeks = mutualPairWeeks.get(key) ?? new Set<number>();
    weeks.add(week);
    mutualPairWeeks.set(key, weeks);
  }
  let eligibleRetentionCohorts = 0;
  let retainedCohorts = 0;
  const currentWeek = Math.floor(now.getTime() / WEEK_MS);
  for (const weeks of mutualPairWeeks.values()) {
    const firstWeek = Math.min(...weeks);
    if (firstWeek + 4 > currentWeek) continue;
    eligibleRetentionCohorts += 1;
    if (weeks.has(firstWeek + 4)) retainedCohorts += 1;
  }

  return {
    generatedAt: now.toISOString(),
    definitions: {
      activeNeighborWindowDays: 28,
      weeklySendWindowDays: 7,
      retentionWeekOffset: 4,
      includedTargetTypes: ["person", "reply"],
    },
    neighborAcceptance: {
      acceptedCount: neighbors.length,
      averageAcceptanceMs: mean(acceptedDurations),
    },
    activity: {
      activeNeighborCount: activePairKeys.size,
      weeklySendCount,
      weeklySendsPerActiveNeighbor:
        activePairKeys.size === 0
          ? 0
          : Number((weeklySendCount / activePairKeys.size).toFixed(2)),
    },
    letters: {
      receivedCount: originals.length,
      firstOpenedCount: openedOriginals.length,
      firstOpenRate:
        originals.length === 0 ? 0 : openedOriginals.length / originals.length,
      repliedCount: repliedOriginals.length,
      replyRate:
        originals.length === 0 ? 0 : repliedOriginals.length / originals.length,
      averageFirstSendToFirstReplyMs: mean(firstReplyDurations),
    },
    mutualRetention: {
      eligibleCohortCount: eligibleRetentionCohorts,
      retainedCount: retainedCohorts,
      fourWeekRetentionRate:
        eligibleRetentionCohorts === 0
          ? 0
          : retainedCohorts / eligibleRetentionCohorts,
    },
  };
}