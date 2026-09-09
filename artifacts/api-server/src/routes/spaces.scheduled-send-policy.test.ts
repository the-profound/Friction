import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routesSource = readFileSync(join(__dirname, "spaces.ts"), "utf8");
const scheduleScreenSource = readFileSync(
  join(__dirname, "../../../friction/app/of-space-schedule-send.tsx"),
  "utf8",
);
const scheduleSheetSource = readFileSync(
  join(
    __dirname,
    "../../../friction/components/ArticleScheduleSheet/ArticleScheduleSheet.tsx",
  ),
  "utf8",
);
const startScreenSource = readFileSync(
  join(__dirname, "../../../friction/app/of-space-start.tsx"),
  "utf8",
);
const schemaSource = readFileSync(
  join(__dirname, "../../../../lib/db/src/schema/spaces.ts"),
  "utf8",
);
const migrationSource = readFileSync(
  join(
    __dirname,
    "../../../../lib/db/drizzle/0040_allow_multiple_opening_letters_per_round.sql",
  ),
  "utf8",
);

describe("space scheduled-send role policy", () => {
  it("allows multiple pending OPENING sends for the same letter, round, and date", () => {
    const createSendRoute = routesSource.slice(
      routesSource.indexOf(
        'router.post("/spaces/:id/letters/:letterId/scheduled-sends"',
      ),
      routesSource.indexOf(
        'router.patch("/spaces/:id/letters/:letterId/scheduled-sends/:sendId"',
      ),
    );

    expect(createSendRoute).toContain('letter.letterType === "CENTER"');
    expect(createSendRoute).not.toContain(
      "eq(spaceLettersTable.letterType, letter.letterType)",
    );
    expect(scheduleSheetSource).not.toContain("pendingOpeningSends");
    expect(startScreenSource).not.toContain("pendingOpeningSends");
  });

  it("keeps different OPENING articles as separate letters in the same round", () => {
    const createLetterRoute = routesSource.slice(
      routesSource.indexOf('router.post("/spaces/:id/letters"'),
      routesSource.indexOf("async function getScheduledSendAccess"),
    );

    expect(createLetterRoute).toContain(
      "eq(spaceLettersTable.letterType, parsed.data.letterType)",
    );
    expect(schemaSource).not.toContain(
      'uniqueIndex("space_letters_opening_per_round_unique")',
    );
    expect(migrationSource).toContain(
      'DROP INDEX IF EXISTS "space_letters_opening_per_round_unique"',
    );
  });

  it("does not let OPENING reservations consume CENTER slots", () => {
    expect(scheduleScreenSource).toContain(
      's.letterType === "CENTER" &&\n              s.letter?.authorId === userId',
    );
    expect(scheduleScreenSource).not.toContain("openingRoundIdsWithSend");
    expect(scheduleSheetSource).toContain('l.letterType === "CENTER"');
  });

  it("continues rejecting a second pending CENTER reservation for the same author and round", () => {
    const conflictHelper = routesSource.slice(
      routesSource.indexOf("async function hasPendingCenterReservationConflict"),
      routesSource.indexOf("/**\n * Validates that a CENTER-role reservation"),
    );
    const patchRoute = routesSource.slice(
      routesSource.indexOf(
        'router.patch("/spaces/:id/letters/:letterId/scheduled-sends/:sendId"',
      ),
      routesSource.indexOf('router.get("/spaces/:id/scheduled-sends"'),
    );

    expect(conflictHelper).toContain(
      'eq(spaceScheduledSendsTable.status, "PENDING")',
    );
    expect(conflictHelper).toContain(
      'eq(spaceLettersTable.letterType, "CENTER")',
    );
    expect(conflictHelper).toContain(
      "eq(spaceLettersTable.authorId, letter.authorId)",
    );
    expect(conflictHelper).toContain(
      "eq(spaceLettersTable.spaceRoundId, letter.spaceRoundId)",
    );
    expect(patchRoute).toContain("pg_advisory_xact_lock");
    expect(patchRoute).toContain("SELECT id FROM space_round_slots");
    expect(patchRoute).toContain(
      "validateCenterSlotDate(\n          lockedLetter, normalizedScheduledAt ?? lockedSend.scheduledAt",
    );
  });

  it("keeps catch-up scheduling server-authoritative and isolated to expired CENTER slots", () => {
    const createRoute = routesSource.slice(
      routesSource.indexOf(
        'router.post("/spaces/:id/letters/:letterId/scheduled-sends"',
      ),
      routesSource.indexOf(
        'router.patch("/spaces/:id/letters/:letterId/scheduled-sends/:sendId"',
      ),
    );
    const validationHelper = routesSource.slice(
      routesSource.indexOf("async function validateCenterSlotDate"),
      routesSource.indexOf("async function lockAndCheckPendingCenterReservation"),
    );

    expect(createRoute).toContain('catchUp: z.boolean().optional()');
    expect(createRoute).toContain('"보충 발신 시각은 서버가 결정합니다."');
    expect(createRoute).toContain('letter.letterType !== "CENTER"');
    expect(createRoute).toContain("normalizedScheduledAt = computeDeliverySlot()");
    expect(createRoute).toContain("lockAndCheckPendingCenterReservation");
    expect(createRoute).toContain("hasSentCenterSlotUse");
    expect(createRoute).toContain("getSpaceRoundStatusForPeriod(lockedRound)");
    expect(createRoute).toContain('lockedSpace.status === "ARCHIVED"');
    expect(createRoute).toContain("reservedDate: reservationIdentity.reservedDate");
    expect(validationHelper).toContain("if (!slot.scheduledDate)");
    expect(validationHelper).toContain("requestedSlotId !== slot.id");
    expect(validationHelper).toContain("if (catchUp && !isExpired)");
    expect(validationHelper).toContain("if (!catchUp && isExpired)");
  });

  it("does not let normal CENTER updates reuse the catch-up exception", () => {
    const patchRoute = routesSource.slice(
      routesSource.indexOf(
        'router.patch("/spaces/:id/letters/:letterId/scheduled-sends/:sendId"',
      ),
      routesSource.indexOf('router.get("/spaces/:id/scheduled-sends"'),
    );

    expect(patchRoute).toContain(
      "lockedLetter, normalizedScheduledAt ?? lockedSend.scheduledAt, lockedSend.slotId, false, tx",
    );
    expect(patchRoute).not.toContain("computeDeliverySlot()");
  });

  it("links every pre-start OPENING reservation to the first round", () => {
    const startRoute = routesSource.slice(
      routesSource.indexOf('router.post("/spaces/:id/start"'),
      routesSource.indexOf('router.get("/spaces/:id/rounds"'),
    );

    expect(startRoute).toContain(
      "inArray(spaceLettersTable.id, roundlessOpeningLetters.map((letter) => letter.id))",
    );
    expect(startRoute).not.toContain("winnerId");
  });
});