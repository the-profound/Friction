import { DeliveryPolicy } from "./policies";

export type DeliverySlot = 6 | 18;

export interface SendRequest {
  articleId: string;
  senderId: string;
  receiverId: string;
  receiverType: "user" | "collection";
}

export interface DeliveryResult {
  sendRecordId: string;
  inboxId: string;
  visibleAt: Date;
  deliverySlot: DeliverySlot;
}

export function getNextDeliverySlot(now: Date = new Date()): { slot: DeliverySlot; visibleAt: Date } {
  const kstOffset = 9 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const kstMinutes = utcMinutes + kstOffset;
  const kstHour = Math.floor(kstMinutes / 60) % 24;

  const [morning, evening] = DeliveryPolicy.DELIVERY_HOURS_KST;
  let targetHour: DeliverySlot;
  let daysToAdd = 0;

  if (kstHour < morning) {
    targetHour = morning as DeliverySlot;
  } else if (kstHour < evening) {
    targetHour = evening as DeliverySlot;
  } else {
    targetHour = morning as DeliverySlot;
    daysToAdd = 1;
  }

  const visibleAt = new Date(now);
  visibleAt.setUTCDate(visibleAt.getUTCDate() + daysToAdd);
  visibleAt.setUTCHours(targetHour - 9, 0, 0, 0);

  return { slot: targetHour, visibleAt };
}

export function canSendToUser(
  articleStatus: string,
  isSelf: boolean,
): { allowed: boolean; reason?: string } {
  if (articleStatus !== "LETTER") {
    return { allowed: false, reason: "완성된 편지만 보낼 수 있습니다." };
  }
  if (isSelf) {
    return { allowed: false, reason: "자기 자신에게는 보낼 수 없습니다." };
  }
  return { allowed: true };
}

export function isNeighborRelationActive(status: string): boolean {
  return status === "accepted";
}
