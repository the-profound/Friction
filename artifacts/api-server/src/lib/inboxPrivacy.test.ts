import { describe, expect, it } from "vitest";
import { sanitizeInboxPrivacy } from "./inboxPrivacy";

const baseRow = {
  id: "inbox-1",
  senderDisplayName: "참여자",
  sender: {
    id: "sender-1",
    nickname: "계정 닉네임",
    email: "must-not-leak@example.invalid",
  },
  explicitSpaceName: "검증 공간",
  scheduledSpaceName: null,
  legacyScheduledSpaceName: null,
  teamCollectionName: null,
  personalCollectionName: null,
};

describe("anonymous space inbox privacy", () => {
  it("removes the account sender object and keeps only the safe display name", () => {
    const result = sanitizeInboxPrivacy({
      ...baseRow,
      isAnonymousSpace: true,
    });
    const resultRecord: Record<string, unknown> = result;

    expect(resultRecord.sender).toBeUndefined();
    expect(resultRecord.senderDisplayName).toBe("참여자");
    expect(resultRecord.collectionName).toBe("검증 공간");
    expect(resultRecord).not.toHaveProperty("isAnonymousSpace");
    expect(JSON.stringify(result)).not.toContain("계정 닉네임");
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("retains the sender object for a non-anonymous delivery", () => {
    const result = sanitizeInboxPrivacy({
      ...baseRow,
      isAnonymousSpace: false,
    });
    const resultRecord: Record<string, unknown> = result;

    expect(resultRecord.sender).toEqual(baseRow.sender);
    expect(resultRecord.senderDisplayName).toBe("참여자");
  });
});