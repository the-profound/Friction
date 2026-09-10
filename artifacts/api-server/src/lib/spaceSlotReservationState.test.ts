import { describe, expect, it } from "vitest";
import { ListSpaceRoundSlotsResponse } from "@workspace/api-zod";
import { getActivelyReservedSlotIds } from "./spaceSlotReservationState";

describe("space slot reservation state", () => {
  it("treats only a pending send with a slot identity as an active reservation", () => {
    const activeIds = getActivelyReservedSlotIds([
      { slotId: "pending-slot", status: "PENDING" },
      { slotId: "sent-slot", status: "SENT" },
      { slotId: "cancelled-slot", status: "CANCELLED" },
      { slotId: "failed-slot", status: "FAILED" },
      { slotId: null, status: "PENDING" },
    ]);

    expect([...activeIds]).toEqual(["pending-slot"]);
  });

  it("keeps private letter fields outside the public slot response contract", () => {
    const [slot] = ListSpaceRoundSlotsResponse.parse([{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceRoundId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      assignedUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      slotOrder: 1,
      scheduledDate: "2026-09-20",
      assignedUserNickname: "참여자",
      hasActiveReservation: true,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      articleTitle: "비공개 제목",
      articleContent: "비공개 본문",
      articleCover: { type: "color", bgColor: "#000000" },
    }]);

    expect(slot).toMatchObject({ hasActiveReservation: true });
    expect(slot).not.toHaveProperty("articleTitle");
    expect(slot).not.toHaveProperty("articleContent");
    expect(slot).not.toHaveProperty("articleCover");
  });
});