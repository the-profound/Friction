/**
 * One-off cleanup for task "여는 편지 회차당 유일성 보강".
 *
 * Resolves any existing violations of "at most one OPENING letter per round"
 * (including round-less legacy OPENING letters on ACTIVE spaces) BEFORE the
 * partial unique index `space_letters_opening_per_round_unique` is created,
 * then creates the index. Safe to re-run: it only acts on rounds/spaces that
 * still have a conflict, and the index creation is idempotent (IF NOT
 * EXISTS).
 *
 * A round-less OPENING letter is only legitimate while its space is still
 * RECRUITING (pre-start draft, later linked to round 1 by the start route).
 * Once a space is ACTIVE, every OPENING letter must reference a round in
 * that same space — this script enforces that as its final invariant and
 * FAILS LOUDLY (throws, non-zero exit, index NOT created) if it cannot
 * reach that state, rather than silently leaving bad data behind.
 *
 * Resolution rules (same "earliest round without an OPENING letter yet"
 * rule the space detail screen already uses for round-less legacy letters):
 *  - For each space, group its OPENING letters by spaceRoundId (including a
 *    "null" group for round-less legacy letters).
 *  - For any group with more than one letter, or a null group belonging to
 *    an ACTIVE space, pick a single "canonical" letter to keep in place:
 *      1. prefer the letter with a SENT scheduled send (most recent sentAt
 *         wins if several) — it's the one actually delivered to the space;
 *      2. otherwise the most recently created letter.
 *  - Every other letter in that group is reassigned to the earliest round
 *    (by roundNumber) that does not yet have any OPENING letter.
 *
 * Run with (from artifacts/api-server, same convention as the other one-off
 * migrate:* scripts in package.json — e.g. migrate:rounds-backfill):
 *   pnpm run migrate:opening-letter-round-uniqueness
 *
 * This must be run once against each environment's database after this
 * schema change (the `space_letters_opening_per_round_unique` partial unique
 * index in lib/db/src/schema/spaces.ts) is deployed, before or after a
 * `drizzle-kit push` of the schema — the script creates the index itself
 * (CREATE UNIQUE INDEX IF NOT EXISTS) so it does not depend on push having
 * already run. Re-running is always safe (idempotent).
 */
import { eq, sql } from "drizzle-orm";
import {
  db,
  spaceLettersTable,
  spaceRoundsTable,
  spaceScheduledSendsTable,
  spacesTable,
} from "@workspace/db";

async function main() {
  const spaceStatuses = await db.select({ id: spacesTable.id, status: spacesTable.status }).from(spacesTable);
  const statusBySpaceId = new Map(spaceStatuses.map((s) => [s.id, s.status]));

  const openingLetters = await db
    .select({
      id: spaceLettersTable.id,
      spaceId: spaceLettersTable.spaceId,
      spaceRoundId: spaceLettersTable.spaceRoundId,
      createdAt: spaceLettersTable.createdAt,
    })
    .from(spaceLettersTable)
    .where(eq(spaceLettersTable.letterType, "OPENING"));

  console.log(`Found ${openingLetters.length} OPENING letters total.`);

  // Latest SENT sentAt per letter (undefined if never sent).
  const sentSends = await db
    .select({
      spaceLetterId: spaceScheduledSendsTable.spaceLetterId,
      sentAt: spaceScheduledSendsTable.sentAt,
    })
    .from(spaceScheduledSendsTable)
    .where(eq(spaceScheduledSendsTable.status, "SENT"));
  const latestSentAtByLetter = new Map<string, Date>();
  for (const s of sentSends) {
    if (!s.sentAt) continue;
    const prev = latestSentAtByLetter.get(s.spaceLetterId);
    if (!prev || s.sentAt > prev) latestSentAtByLetter.set(s.spaceLetterId, s.sentAt);
  }

  // Group OPENING letters by (spaceId, spaceRoundId | "null").
  const bySpace = new Map<string, typeof openingLetters>();
  for (const letter of openingLetters) {
    if (!bySpace.has(letter.spaceId)) bySpace.set(letter.spaceId, []);
    bySpace.get(letter.spaceId)!.push(letter);
  }

  let reassignedCount = 0;
  const unresolved: { spaceId: string; letterId: string; reason: string }[] = [];

  for (const [spaceId, letters] of bySpace) {
    const isActive = statusBySpaceId.get(spaceId) === "ACTIVE";

    const groups = new Map<string, typeof letters>();
    for (const letter of letters) {
      const key = letter.spaceRoundId ?? "__null__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(letter);
    }

    // Rounds that already have an OPENING letter (after we fix conflicts,
    // this always resolves to at most one round each; track live so we
    // never reassign two orphans onto the same target round).
    const roundsWithOpening = new Set([...groups.keys()].filter((k) => k !== "__null__"));

    // Collect every letter that needs to move: round-less ones on an ACTIVE
    // space (round-less is only legitimate pre-start, i.e. RECRUITING), plus
    // every extra letter beyond the first in an over-populated round group.
    const orphans: typeof letters = [];
    for (const [key, group] of groups) {
      if (key === "__null__") {
        if (isActive) orphans.push(...group);
        continue;
      }
      if (group.length <= 1) continue;
      // Pick canonical: latest SENT sentAt wins, else most recently created.
      const [canonical, ...rest] = [...group].sort((a, b) => {
        const aSent = latestSentAtByLetter.get(a.id);
        const bSent = latestSentAtByLetter.get(b.id);
        if (aSent && bSent) return bSent.getTime() - aSent.getTime();
        if (aSent) return -1;
        if (bSent) return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      console.log(
        `Space ${spaceId} round ${key}: keeping canonical letter ${canonical.id}, ` +
          `reassigning ${rest.length} duplicate(s): ${rest.map((l) => l.id).join(", ")}`,
      );
      orphans.push(...rest);
    }

    if (orphans.length === 0) continue;

    const rounds = await db
      .select({ id: spaceRoundsTable.id, roundNumber: spaceRoundsTable.roundNumber })
      .from(spaceRoundsTable)
      .where(eq(spaceRoundsTable.spaceId, spaceId));
    rounds.sort((a, b) => a.roundNumber - b.roundNumber);

    // Orphans are reassigned in creation order, earliest first, to the
    // earliest still-free round — mirrors "가장 이른 회차" rule.
    orphans.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const orphan of orphans) {
      const target = rounds.find((r) => !roundsWithOpening.has(r.id));
      if (!target) {
        unresolved.push({
          spaceId,
          letterId: orphan.id,
          reason: "no free round available to reassign this orphan OPENING letter to",
        });
        continue;
      }
      roundsWithOpening.add(target.id);
      await db
        .update(spaceLettersTable)
        .set({ spaceRoundId: target.id })
        .where(eq(spaceLettersTable.id, orphan.id));
      console.log(`Reassigned letter ${orphan.id} (space ${spaceId}) -> round ${target.id}.`);
      reassignedCount++;
    }
  }

  console.log(`Reassigned ${reassignedCount} letter(s).`);

  if (unresolved.length > 0) {
    throw new Error(
      `Refusing to create unique index: ${unresolved.length} OPENING letter(s) could not be ` +
        `resolved and require manual review: ${JSON.stringify(unresolved)}`,
    );
  }

  // Verify no duplicate-per-round conflicts remain.
  const conflictResult = await db.execute(sql`
    SELECT space_round_id, count(*) c
    FROM space_letters
    WHERE letter_type = 'OPENING' AND space_round_id IS NOT NULL
    GROUP BY space_round_id
    HAVING count(*) > 1
    LIMIT 1
  `);
  if (conflictResult.rows[0]) {
    throw new Error(
      `Refusing to create unique index: round ${JSON.stringify(conflictResult.rows[0])} still has duplicate OPENING letters.`,
    );
  }

  // Verify no ACTIVE space has a round-less OPENING letter left behind, and
  // that every OPENING letter's round actually belongs to the same space
  // (a pre-existing data bug in either respect would otherwise slip past
  // the checks above, since they only look at space_round_id in isolation).
  const activeOrphanResult = await db.execute(sql`
    SELECT sl.id
    FROM space_letters sl
    JOIN spaces s ON s.id = sl.space_id
    WHERE sl.letter_type = 'OPENING'
      AND s.status = 'ACTIVE'
      AND sl.space_round_id IS NULL
    LIMIT 1
  `);
  if (activeOrphanResult.rows[0]) {
    throw new Error(
      `Refusing to create unique index: ACTIVE space has a round-less OPENING letter ${JSON.stringify(activeOrphanResult.rows[0])}.`,
    );
  }

  const crossSpaceResult = await db.execute(sql`
    SELECT sl.id
    FROM space_letters sl
    JOIN space_rounds sr ON sr.id = sl.space_round_id
    WHERE sl.letter_type = 'OPENING' AND sr.space_id != sl.space_id
    LIMIT 1
  `);
  if (crossSpaceResult.rows[0]) {
    throw new Error(
      `Refusing to create unique index: OPENING letter ${JSON.stringify(crossSpaceResult.rows[0])} references a round from a different space.`,
    );
  }

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS space_letters_opening_per_round_unique
    ON space_letters (space_round_id)
    WHERE letter_type = 'OPENING'
  `);
  console.log("Created (or confirmed) unique index space_letters_opening_per_round_unique.");
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
