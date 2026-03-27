import { DeliveryPolicy } from "./policies";
import type { ArticleStatus } from "./policies";

export type DeliverySlot = 6 | 18;

export interface DeliverySlotInfo {
  slot: DeliverySlot;
  visibleAt: Date;
}

export interface SendGuardResult {
  allowed: boolean;
  reason?: string;
}

export function getNextDeliverySlot(now: Date = new Date()): DeliverySlotInfo {
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

export function formatDeliverySlot(slot: DeliverySlot): string {
  return slot === 6 ? "오전 6시" : "오후 6시";
}

export function formatDeliveryTime(visibleAt: Date): string {
  const kstDate = new Date(visibleAt.getTime() + 9 * 60 * 60 * 1000);
  const month = kstDate.getUTCMonth() + 1;
  const day = kstDate.getUTCDate();
  const hour = kstDate.getUTCHours();
  const period = hour < 12 ? "오전" : "오후";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${month}월 ${day}일 ${period} ${displayHour}시`;
}

export function canSendArticle(
  articleStatus: ArticleStatus,
  senderId: string,
  recipientId: string,
): SendGuardResult {
  if (articleStatus !== "LETTER") {
    return { allowed: false, reason: "완성된 편지만 보낼 수 있습니다." };
  }
  if (senderId === recipientId) {
    return { allowed: false, reason: "자기 자신에게는 보낼 수 없습니다." };
  }
  return { allowed: true };
}

export function canSendToNeighbor(
  articleStatus: ArticleStatus,
  senderId: string,
  recipientId: string,
  isNeighbor: boolean,
): SendGuardResult {
  const baseCheck = canSendArticle(articleStatus, senderId, recipientId);
  if (!baseCheck.allowed) return baseCheck;

  if (!isNeighbor) {
    return { allowed: false, reason: "이웃 관계인 사람에게만 보낼 수 있습니다." };
  }
  return { allowed: true };
}

export function isDelivered(visibleAt: Date, now: Date = new Date()): boolean {
  return now >= visibleAt;
}

export function getTimeUntilDelivery(visibleAt: Date, now: Date = new Date()): number {
  return Math.max(0, visibleAt.getTime() - now.getTime());
}
