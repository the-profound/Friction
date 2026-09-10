import { describe, expect, it } from "vitest";
import { sortSpaceRoundLettersForPresentation } from "../spaceRoundPresentation";

type TestLetter = {
  id: string;
  letterType: "OPENING" | "CENTER" | "REPLY";
  createdAt: string;
  everScheduled?: boolean;
  reservation?: {
    status: "PENDING" | "SENT" | "CANCELLED" | "FAILED";
    scheduledAt: string;
    sentAt?: string | null;
  } | null;
};

function makeLetter(
  id: string,
  overrides: Partial<Omit<TestLetter, "id">> = {},
): TestLetter {
  return {
    id,
    letterType: "CENTER",
    createdAt: "2026-08-01T00:00:00.000Z",
    reservation: null,
    ...overrides,
  };
}

describe("space round letter presentation order", () => {
  it("uses actual sentAt when scheduled and actual send order disagree", () => {
    const scheduledLaterButSentEarlier = makeLetter("sent-earlier", {
      reservation: {
        status: "SENT",
        scheduledAt: "2026-08-22T21:00:00.000Z",
        sentAt: "2026-08-21T21:00:00.000Z",
      },
    });
    const scheduledEarlierButSentLater = makeLetter("sent-later", {
      reservation: {
        status: "SENT",
        scheduledAt: "2026-08-20T21:00:00.000Z",
        sentAt: "2026-08-23T03:00:00.000Z",
      },
    });

    expect(
      sortSpaceRoundLettersForPresentation([
        scheduledLaterButSentEarlier,
        scheduledEarlierButSentLater,
      ]).map((letter) => letter.id),
    ).toEqual(["sent-later", "sent-earlier"]);
  });

  it("compares true legacy createdAt with SENT publication times and leaves unsent entries last", () => {
    const letters = [
      makeLetter("pending-newest", {
        createdAt: "2026-09-01T00:00:00.000Z",
        everScheduled: true,
        reservation: {
          status: "PENDING",
          scheduledAt: "2026-09-02T21:00:00.000Z",
        },
      }),
      makeLetter("sent-middle", {
        createdAt: "2026-07-01T00:00:00.000Z",
        everScheduled: true,
        reservation: {
          status: "SENT",
          scheduledAt: "2026-08-20T21:00:00.000Z",
          sentAt: "2026-08-20T21:00:00.000Z",
        },
      }),
      makeLetter("legacy-newest", {
        createdAt: "2026-08-30T00:00:00.000Z",
      }),
      makeLetter("cancelled-only", {
        createdAt: "2026-08-31T00:00:00.000Z",
        everScheduled: true,
        reservation: null,
      }),
      makeLetter("legacy-oldest", {
        createdAt: "2026-08-10T00:00:00.000Z",
      }),
    ];

    expect(
      sortSpaceRoundLettersForPresentation(letters).map((letter) => letter.id),
    ).toEqual([
      "legacy-newest",
      "sent-middle",
      "legacy-oldest",
      "pending-newest",
      "cancelled-only",
    ]);
  });

  it("keeps the opening letter first and falls back to scheduledAt for old SENT data", () => {
    const letters = [
      makeLetter("sent-old-fallback", {
        everScheduled: true,
        reservation: {
          status: "SENT",
          scheduledAt: "2026-08-20T21:00:00.000Z",
          sentAt: null,
        },
      }),
      makeLetter("sent-new-fallback", {
        letterType: "REPLY",
        everScheduled: true,
        reservation: {
          status: "SENT",
          scheduledAt: "2026-08-21T21:00:00.000Z",
        },
      }),
      makeLetter("opening", {
        letterType: "OPENING",
        createdAt: "2026-07-01T00:00:00.000Z",
      }),
    ];

    expect(
      sortSpaceRoundLettersForPresentation(letters).map((letter) => letter.id),
    ).toEqual(["opening", "sent-new-fallback", "sent-old-fallback"]);
  });

  it("uses ID ties deterministically without mutating the input", () => {
    const letters = [
      makeLetter("letter-b", { createdAt: "2026-08-20T00:00:00.000Z" }),
      makeLetter("letter-a", { createdAt: "2026-08-20T00:00:00.000Z" }),
    ];

    expect(
      sortSpaceRoundLettersForPresentation(letters).map((letter) => letter.id),
    ).toEqual(["letter-a", "letter-b"]);
    expect(letters.map((letter) => letter.id)).toEqual(["letter-b", "letter-a"]);
  });
});