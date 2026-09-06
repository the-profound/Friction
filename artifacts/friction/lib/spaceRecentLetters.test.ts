import { describe, expect, it } from "vitest";
import { getEffectiveSentAtMs, sortRecentLetters } from "./spaceRecentLetters";
import type { RecentLetterCandidate } from "./spaceRecentLetters";

function makeLetter(
  overrides: Partial<RecentLetterCandidate> & { id: string },
): RecentLetterCandidate & { id: string } {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    articleTitle: `letter-${overrides.id}`,
    reservation: null,
    ...overrides,
  };
}

describe("getEffectiveSentAtMs", () => {
  it("진짜 레거시 편지(reservation 없음, everScheduled 없음/false)는 createdAt을 기준 시각으로 사용한다", () => {
    const letter = makeLetter({ id: "legacy", createdAt: "2026-01-05T00:00:00.000Z" });
    expect(getEffectiveSentAtMs(letter)).toBe(new Date("2026-01-05T00:00:00.000Z").getTime());
  });

  it("유일한 예약이 CANCELLED였던 편지(reservation null이지만 everScheduled true)는 레거시로 취급하지 않고 제외한다", () => {
    const letter = makeLetter({
      id: "cancelled-only",
      createdAt: "2026-01-05T00:00:00.000Z",
      reservation: null,
      everScheduled: true,
    });
    expect(getEffectiveSentAtMs(letter)).toBeNull();
  });

  it("SENT 편지는 reservation.sentAt(실제 발신 시각)을 기준 시각으로 사용한다", () => {
    const letter = makeLetter({
      id: "sent",
      createdAt: "2026-01-01T00:00:00.000Z",
      reservation: {
        status: "SENT",
        scheduledAt: "2026-01-10T06:00:00.000Z",
        sentAt: "2026-01-10T06:03:12.000Z", // 실제 처리 지연으로 예약 시각과 다름
      },
    });
    expect(getEffectiveSentAtMs(letter)).toBe(
      new Date("2026-01-10T06:03:12.000Z").getTime(),
    );
  });

  it("SENT 편지인데 sentAt이 없으면 scheduledAt으로 폴백한다", () => {
    const letter = makeLetter({
      id: "sent-no-sentat",
      reservation: { status: "SENT", scheduledAt: "2026-01-10T06:00:00.000Z", sentAt: null },
    });
    expect(getEffectiveSentAtMs(letter)).toBe(
      new Date("2026-01-10T06:00:00.000Z").getTime(),
    );
  });

  it.each(["PENDING", "CANCELLED", "FAILED"] as const)(
    "%s 상태의 편지는 null을 반환해 제외한다",
    (status) => {
      const letter = makeLetter({
        id: status,
        reservation: { status, scheduledAt: "2026-01-10T06:00:00.000Z" },
      });
      expect(getEffectiveSentAtMs(letter)).toBeNull();
    },
  );
});

describe("sortRecentLetters", () => {
  it("PENDING 편지는 아직 발신되지 않았으므로 카드 후보에서 제외된다", () => {
    const pending = makeLetter({
      id: "pending",
      createdAt: "2026-01-20T00:00:00.000Z", // 작성은 가장 최근이지만
      reservation: { status: "PENDING", scheduledAt: "2026-02-01T06:00:00.000Z" },
    });
    const sent = makeLetter({
      id: "sent",
      createdAt: "2026-01-02T00:00:00.000Z",
      reservation: { status: "SENT", scheduledAt: "2026-01-05T06:00:00.000Z", sentAt: "2026-01-05T06:00:00.000Z" },
    });

    const result = sortRecentLetters([pending, sent]);

    expect(result).toEqual([sent]);
  });

  it("CANCELLED/FAILED 편지도 제외된다", () => {
    const cancelled = makeLetter({
      id: "cancelled",
      reservation: { status: "CANCELLED", scheduledAt: "2026-01-05T06:00:00.000Z" },
    });
    const failed = makeLetter({
      id: "failed",
      reservation: { status: "FAILED", scheduledAt: "2026-01-06T06:00:00.000Z" },
    });
    const legacy = makeLetter({ id: "legacy", createdAt: "2026-01-01T00:00:00.000Z" });

    const result = sortRecentLetters([cancelled, failed, legacy]);

    expect(result).toEqual([legacy]);
  });

  it("유일한 예약이 CANCELLED였던 편지(reservation:null, everScheduled:true)는 진짜 레거시와 달리 노출되지 않는다", () => {
    const cancelledOnly = makeLetter({
      id: "cancelled-only",
      createdAt: "2026-01-01T00:00:00.000Z",
      reservation: null,
      everScheduled: true,
    });
    const trueLegacy = makeLetter({
      id: "true-legacy",
      createdAt: "2025-12-01T00:00:00.000Z",
      reservation: null,
      everScheduled: false,
    });

    const result = sortRecentLetters([cancelledOnly, trueLegacy]);

    expect(result).toEqual([trueLegacy]);
  });

  it("SENT로 전환되면 정상적으로 카드에 노출된다 (회귀 없음)", () => {
    const nowPending = makeLetter({
      id: "later-sent",
      reservation: { status: "PENDING", scheduledAt: "2026-01-05T06:00:00.000Z" },
    });
    expect(sortRecentLetters([nowPending])).toEqual([]);

    const afterSending = {
      ...nowPending,
      reservation: {
        status: "SENT" as const,
        scheduledAt: "2026-01-05T06:00:00.000Z",
        sentAt: "2026-01-05T06:00:05.000Z",
      },
    };
    expect(sortRecentLetters([afterSending])).toEqual([afterSending]);
  });

  it("발신 예약이 있는 편지와 레거시 편지가 섞여도 실제 발신 시각 기준 최신순으로 정렬한다", () => {
    const legacyOld = makeLetter({ id: "legacy-old", createdAt: "2026-01-01T00:00:00.000Z" });
    const sentMiddle = makeLetter({
      id: "sent-middle",
      createdAt: "2025-12-01T00:00:00.000Z", // 작성은 더 오래되었지만 발신은 나중
      reservation: { status: "SENT", scheduledAt: "2026-01-15T06:00:00.000Z", sentAt: "2026-01-15T06:00:00.000Z" },
    });
    const sentNewest = makeLetter({
      id: "sent-newest",
      createdAt: "2026-01-02T00:00:00.000Z",
      reservation: { status: "SENT", scheduledAt: "2026-01-20T06:00:00.000Z", sentAt: "2026-01-20T06:00:00.000Z" },
    });
    const pendingExcluded = makeLetter({
      id: "pending-excluded",
      createdAt: "2026-01-25T00:00:00.000Z",
      reservation: { status: "PENDING", scheduledAt: "2026-01-30T06:00:00.000Z" },
    });

    const result = sortRecentLetters([legacyOld, sentMiddle, sentNewest, pendingExcluded]);

    expect(result.map((l) => l.articleTitle)).toEqual([
      "letter-sent-newest",
      "letter-sent-middle",
      "letter-legacy-old",
    ]);
  });

  it("발신이 지연되어 sentAt이 scheduledAt보다 늦어도 실제 sentAt 기준으로 정렬한다", () => {
    // scheduledAt만 보면 delayed가 먼저지만, 실제 발신(sentAt)은 delayed가 더 늦다.
    const onTime = makeLetter({
      id: "on-time",
      reservation: { status: "SENT", scheduledAt: "2026-01-10T06:00:00.000Z", sentAt: "2026-01-10T06:00:00.000Z" },
    });
    const delayed = makeLetter({
      id: "delayed",
      reservation: { status: "SENT", scheduledAt: "2026-01-09T06:00:00.000Z", sentAt: "2026-01-11T09:00:00.000Z" },
    });

    const result = sortRecentLetters([onTime, delayed]);

    expect(result.map((l) => l.articleTitle)).toEqual([
      "letter-delayed",
      "letter-on-time",
    ]);
  });

  it("후보가 3개를 초과하면 발신 시각 기준 최신 3개만 남긴다", () => {
    const letters = [1, 2, 3, 4, 5].map((n) =>
      makeLetter({
        id: `l${n}`,
        createdAt: new Date(2026, 0, n).toISOString(),
      }),
    );

    const result = sortRecentLetters(letters);

    expect(result).toHaveLength(3);
    expect(result.map((l) => l.articleTitle)).toEqual([
      "letter-l5",
      "letter-l4",
      "letter-l3",
    ]);
  });

  it("제목/발췌 둘 다 없는 편지는 여전히 후보에서 제외한다", () => {
    const noContent = makeLetter({ id: "no-content", articleTitle: null, articleExcerpt: null });
    expect(sortRecentLetters([noContent])).toEqual([]);
  });
});
