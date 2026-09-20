import { describe, expect, it } from "vitest";
import { calculateRelationshipMetrics } from "./relationshipMetrics";

const now = new Date("2026-09-20T00:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * day);

describe("calculateRelationshipMetrics", () => {
  it("measures acceptance, opens, replies, activity, and four-week mutual retention", () => {
    const result = calculateRelationshipMetrics(
      [{
        userAId: "a",
        userBId: "b",
        createdAt: at(40),
        acceptedAt: at(39),
      }],
      [
        { id: "s1", senderId: "a", recipientId: "b", inboxId: "i1", replyToInboxId: null, targetType: "person", deliverySlot: at(35), sentAt: at(35) },
        { id: "s2", senderId: "b", recipientId: "a", inboxId: "i2", replyToInboxId: "i1", targetType: "reply", deliverySlot: at(34), sentAt: at(34) },
        { id: "s3", senderId: "a", recipientId: "b", inboxId: "i3", replyToInboxId: null, targetType: "person", deliverySlot: at(7), sentAt: at(7) },
        { id: "s4", senderId: "b", recipientId: "a", inboxId: "i4", replyToInboxId: "i3", targetType: "reply", deliverySlot: at(6), sentAt: at(6) },
      ],
      [{ id: "i1", openedAt: at(34.5) }, { id: "i3", openedAt: at(6.5) }],
      now,
    );

    expect(result.neighborAcceptance.averageAcceptanceMs).toBe(day);
    expect(result.activity.activeNeighborCount).toBe(1);
    expect(result.letters.replyRate).toBe(1);
    expect(result.letters.firstOpenRate).toBe(1);
    expect(result.mutualRetention.fourWeekRetentionRate).toBe(1);
  });

  it("excludes self, space, group, future, and unlinked reverse sends", () => {
    const result = calculateRelationshipMetrics(
      [],
      [
        { id: "self", senderId: "a", recipientId: "a", inboxId: "x", replyToInboxId: null, targetType: "person", deliverySlot: at(1), sentAt: at(1) },
        { id: "space", senderId: "a", recipientId: null, inboxId: null, replyToInboxId: null, targetType: "space", deliverySlot: at(1), sentAt: at(1) },
        { id: "group", senderId: "a", recipientId: "b", inboxId: "g", replyToInboxId: null, targetType: "group", deliverySlot: at(1), sentAt: at(1) },
        { id: "future", senderId: "a", recipientId: "b", inboxId: "f", replyToInboxId: null, targetType: "person", deliverySlot: new Date(now.getTime() + day), sentAt: now },
        { id: "original", senderId: "a", recipientId: "b", inboxId: "i", replyToInboxId: null, targetType: "person", deliverySlot: at(2), sentAt: at(2) },
        { id: "reverse", senderId: "b", recipientId: "a", inboxId: "j", replyToInboxId: null, targetType: "person", deliverySlot: at(1), sentAt: at(1) },
      ],
      [],
      now,
    );

    expect(result.letters.receivedCount).toBe(2);
    expect(result.letters.repliedCount).toBe(0);
    expect(result.activity.activeNeighborCount).toBe(0);
  });
});