import { describe, expect, it } from "vitest";
import { resolveInboxSourceName } from "./inboxSource";

describe("inbox source-name resolution", () => {
  it("uses the explicit space even when the article is also in a personal collection", () => {
    expect(
      resolveInboxSourceName({
        explicitSpaceName: "여름 편지 공간",
        scheduledSpaceName: "다른 예약 공간",
        teamCollectionName: "다른 단체 모음",
        personalCollectionName: "내가 저장한 글",
      }),
    ).toBe("여름 편지 공간");
  });

  it("uses the linked scheduled-send space for a legacy row with no explicit space", () => {
    expect(
      resolveInboxSourceName({
        scheduledSpaceName: "천천히 쓰는 공간",
        personalCollectionName: "작성자의 개인 모음",
      }),
    ).toBe("천천히 쓰는 공간");
  });

  it("keeps a team-collection source distinct from personal collections", () => {
    expect(
      resolveInboxSourceName({
        teamCollectionName: "동네 글 모임",
        personalCollectionName: "개인 보관함",
      }),
    ).toBe("동네 글 모임");
  });

  it("keeps the personal-collection fallback for an ordinary person send", () => {
    expect(
      resolveInboxSourceName({
        personalCollectionName: "좋아하는 편지",
      }),
    ).toBe("좋아하는 편지");
  });

  it("uses unlinked historical reservation evidence before collection guesses", () => {
    expect(
      resolveInboxSourceName({
        legacyScheduledSpaceName: "오래된 공간",
        teamCollectionName: "추정된 단체 모음",
        personalCollectionName: "추정된 개인 모음",
      }),
    ).toBe("오래된 공간");
  });

  it("returns no source when ambiguous legacy evidence produces no candidate", () => {
    expect(resolveInboxSourceName({})).toBeNull();
  });
});