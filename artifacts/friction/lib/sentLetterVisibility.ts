import type { SendRecordWithDetails } from "@workspace/api-client-react";

export function isSpaceSendRecord(
  record: Pick<SendRecordWithDetails, "targetType" | "spaceId">,
) {
  return record.targetType === "space" || Boolean(record.spaceId);
}

export function shouldDisplaySentLetter(
  hasNonSpaceSend: boolean,
  spaceVisibility: string | undefined,
) {
  return hasNonSpaceSend || spaceVisibility === "PUBLIC";
}