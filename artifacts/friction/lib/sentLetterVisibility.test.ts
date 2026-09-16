import { describe, expect, it } from "vitest";

import {
  buildSentLetterSourceMetadataByArticleId,
  isAnonymousSpaceReplySendRecord,
  isPubliclyEligibleNonSpaceSendRecord,
  isSpaceSendRecord,
  shouldDisplaySentLetter,
} from "./sentLetterVisibility";
import type { SendRecordWithDetails } from "@workspace/api-client-react";

function record(
  overrides: Partial<SendRecordWithDetails>,
): SendRecordWithDetails {
  return {
    id: "record-1",
    senderId: "sender-1",
    articleId: "article-1",
    targetType: "person",
    isAnonymousSpaceReply: false,
    deliverySlot: "2026-09-01T00:00:00.000Z",
    sentAt: "2026-08-31T00:00:00.000Z",
    isDelivered: true,
    ...overrides,
  };
}

describe("sent letter visibility", () => {
  it.each(["person", "reply"] as const)(
    "keeps %s sends visible without a space-letter row",
    (targetType) => {
      expect(isSpaceSendRecord({ targetType, spaceId: null })).toBe(false);
      expect(shouldDisplaySentLetter(true, undefined)).toBe(true);
    },
  );

  it("shows only PUBLIC sends when an article was sent exclusively to spaces", () => {
    expect(isSpaceSendRecord({ targetType: "space", spaceId: "space-1" })).toBe(true);
    expect(shouldDisplaySentLetter(false, "PUBLIC")).toBe(true);
    expect(shouldDisplaySentLetter(false, "RECIPIENT_ONLY")).toBe(false);
    expect(shouldDisplaySentLetter(false, undefined)).toBe(false);
  });

  it("keeps a person/reply copy visible even when the same article also has a private space send", () => {
    expect(shouldDisplaySentLetter(true, "RECIPIENT_ONLY")).toBe(true);
  });

  describe("anonymous-space-origin personal replies", () => {
    it("flags only a reply whose source letter came from an anonymous space", () => {
      expect(
        isAnonymousSpaceReplySendRecord({
          targetType: "reply",
          isAnonymousSpaceReply: true,
        }),
      ).toBe(true);
      expect(
        isAnonymousSpaceReplySendRecord({
          targetType: "reply",
          isAnonymousSpaceReply: false,
        }),
      ).toBe(false);
      expect(
        isAnonymousSpaceReplySendRecord({
          targetType: "person",
          isAnonymousSpaceReply: true,
        }),
      ).toBe(false);
    });

    it("excludes an anonymous-space-origin reply from public eligibility, unlike an ordinary reply", () => {
      expect(
        isPubliclyEligibleNonSpaceSendRecord({
          targetType: "reply",
          spaceId: null,
          isAnonymousSpaceReply: true,
        }),
      ).toBe(false);
      expect(
        isPubliclyEligibleNonSpaceSendRecord({
          targetType: "reply",
          spaceId: null,
          isAnonymousSpaceReply: false,
        }),
      ).toBe(true);
      expect(
        isPubliclyEligibleNonSpaceSendRecord({
          targetType: "person",
          spaceId: null,
          isAnonymousSpaceReply: false,
        }),
      ).toBe(true);
      expect(
        isPubliclyEligibleNonSpaceSendRecord({
          targetType: "space",
          spaceId: "space-1",
          isAnonymousSpaceReply: false,
        }),
      ).toBe(false);
    });

    it("keeps such a reply out of the public sent-letters list while still counting it as non-space-visibility-gated", () => {
      // Simulates to.tsx/[userId].tsx: an article sent only via an
      // anonymous-space-origin reply must not display publicly.
      expect(shouldDisplaySentLetter(false, undefined)).toBe(false);
    });
  });

  it("uses a space name without exposing its ID as a collection navigation target", () => {
    const metadata = buildSentLetterSourceMetadataByArticleId([
      record({
        targetType: "space",
        spaceId: "space-1",
        spaceName: "금요일의 편지",
        collectionId: "legacy-collection-1",
        collectionName: "잘못된 모임 이름",
      }),
    ]);

    expect(metadata["article-1"]).toEqual({
      name: "금요일의 편지",
      collectionId: null,
      spaceId: "space-1",
      deliverySlot: "2026-09-01T00:00:00.000Z",
    });
  });

  it("keeps existing collection metadata for non-space sends", () => {
    const metadata = buildSentLetterSourceMetadataByArticleId([
      record({
        targetType: "group",
        collectionId: "collection-1",
        collectionName: "오래된 친구들",
      }),
    ]);

    expect(metadata["article-1"]).toMatchObject({
      name: "오래된 친구들",
      collectionId: "collection-1",
      spaceId: null,
    });
  });

  it("selects a space record consistently regardless of API response order", () => {
    const person = record({
      id: "record-person",
      targetType: "person",
      collectionId: "collection-1",
      collectionName: "개인 모음",
      deliverySlot: "2026-09-03T00:00:00.000Z",
    });
    const space = record({
      id: "record-space",
      targetType: "space",
      spaceId: "space-1",
      spaceName: "연동 공간",
      deliverySlot: "2026-09-01T00:00:00.000Z",
    });

    expect(buildSentLetterSourceMetadataByArticleId([person, space])).toEqual(
      buildSentLetterSourceMetadataByArticleId([space, person]),
    );
    expect(
      buildSentLetterSourceMetadataByArticleId([person, space])["article-1"],
    ).toMatchObject({
      name: "연동 공간",
      collectionId: null,
      spaceId: "space-1",
    });
  });
});