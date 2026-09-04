import type { SendRecordWithDetails } from "@workspace/api-client-react";

export type SentLetterSourceMetadata = {
  name: string | null;
  collectionId: string | null;
  spaceId: string | null;
  deliverySlot: string | null;
};

export function isSpaceSendRecord(
  record: Pick<SendRecordWithDetails, "targetType" | "spaceId">,
) {
  return record.targetType === "space" || Boolean(record.spaceId);
}

function compareSendRecords(
  a: SendRecordWithDetails,
  b: SendRecordWithDetails,
) {
  const spacePriority =
    Number(isSpaceSendRecord(a)) - Number(isSpaceSendRecord(b));
  if (spacePriority !== 0) return spacePriority;

  const deliverySlotOrder = (a.deliverySlot ?? "").localeCompare(
    b.deliverySlot ?? "",
  );
  if (deliverySlotOrder !== 0) return deliverySlotOrder;

  const sentAtOrder = (a.sentAt ?? "").localeCompare(b.sentAt ?? "");
  if (sentAtOrder !== 0) return sentAtOrder;

  return a.id.localeCompare(b.id);
}

export function buildSentLetterSourceMetadataByArticleId(
  records: SendRecordWithDetails[],
) {
  const selected = new Map<string, SendRecordWithDetails>();

  for (const record of records) {
    const current = selected.get(record.articleId);
    if (!current || compareSendRecords(record, current) > 0) {
      selected.set(record.articleId, record);
    }
  }

  const result: Record<string, SentLetterSourceMetadata> = {};
  for (const [articleId, record] of selected) {
    const isSpace = isSpaceSendRecord(record);
    result[articleId] = {
      name: isSpace
        ? record.spaceName ?? null
        : record.collectionName ?? null,
      // CardSelectOverlay treats collectionId as a collection navigation target.
      // A space ID must never be passed through that field.
      collectionId: isSpace ? null : record.collectionId ?? null,
      spaceId: isSpace ? record.spaceId ?? null : null,
      deliverySlot: record.deliverySlot ?? null,
    };
  }

  return result;
}

export function shouldDisplaySentLetter(
  hasNonSpaceSend: boolean,
  spaceVisibility: string | undefined,
) {
  return hasNonSpaceSend || spaceVisibility === "PUBLIC";
}