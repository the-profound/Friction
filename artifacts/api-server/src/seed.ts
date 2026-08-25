import { pool } from "@workspace/db";
import { logger } from "./lib/logger";

/**
 * Seeds deterministic dev data into the Supabase database.
 *
 * Run explicitly via:  pnpm --filter @workspace/api-server seed
 *
 * Idempotent: checks for a sentinel inbox row (하윤 self-inbox for a1000001)
 * to determine whether the current seed version is already present.
 * If not, wipes and re-inserts all inbox rows for seeded articles so the
 * latest schema (sender self-inbox entries) is always in place.
 *
 * The impression-folder backfill runs in all environments (including production).
 * All other dev-seed logic is skipped when NODE_ENV=production.
 */
export async function seedDevData(): Promise<void> {
  const client = await pool.connect();
  try {
    // -----------------------------------------------------------------------
    // Always-run migration (ALL environments): rename impression folder rows
    // still carrying the old name "인상깊은 글" to "인상깊은 편지".
    //
    // Conflict scenario: a user may simultaneously have
    //   (A) is_impression=true,  name='인상깊은 글'   ← needs rename
    //   (B) is_impression=false, name='인상깊은 편지' ← blocks rename (unique)
    //
    // Two-step, fully transactional:
    //   Step 1 — Move any blocking regular folder out of the way by appending
    //             " (기존)" so the unique constraint cannot fire.
    //   Step 2 — Rename every remaining impression "인상깊은 글" row.
    //
    // Idempotent — safe to run multiple times.
    // -----------------------------------------------------------------------
    try {
      await client.query("BEGIN");
      // Step 1: clear the path for conflict owners
      await client.query(`
        UPDATE my_collections
        SET name = '인상깊은 편지 (기존)', updated_at = NOW()
        WHERE is_impression = false
          AND name = '인상깊은 편지'
          AND EXISTS (
            SELECT 1 FROM my_collections mc2
            WHERE mc2.owner_id = my_collections.owner_id
              AND mc2.is_impression = true
              AND mc2.name = '인상깊은 글'
          )
      `);
      // Step 2: rename all remaining impression "인상깊은 글" rows
      const renameResult = await client.query(`
        UPDATE my_collections
        SET name = '인상깊은 편지', updated_at = NOW()
        WHERE is_impression = true
          AND name = '인상깊은 글'
      `);
      await client.query("COMMIT");
      if (renameResult.rowCount && renameResult.rowCount > 0) {
        console.log(`[seed] Renamed ${renameResult.rowCount} impression folder(s) from '인상깊은 글' to '인상깊은 편지'.`);
      }
    } catch (e) {
      await client.query("ROLLBACK");
      console.warn("[seed] impression folder rename migration failed:", e);
    }

    // Always-run backfill (ALL environments): create/promote the
    // "인상깊은 편지" impression folder for every user who does not yet have
    // one.  Idempotent — safe to run multiple times.
    //
    // Step 1: if a user already has a regular folder named "인상깊은 편지"
    //   but no impression folder yet, promote that folder in place.
    // Step 2: for users who still have no impression folder, insert one.
    // -----------------------------------------------------------------------
    await client.query(`
      UPDATE my_collections
      SET is_impression = true, updated_at = NOW()
      WHERE name = '인상깊은 편지'
        AND is_impression = false
        AND NOT EXISTS (
          SELECT 1 FROM my_collections mc2
          WHERE mc2.owner_id = my_collections.owner_id AND mc2.is_impression = true
        )
    `);
    await client.query(`
      INSERT INTO my_collections (id, owner_id, name, is_impression, is_public, created_at, updated_at)
      SELECT gen_random_uuid(), u.id, '인상깊은 편지', true, false, NOW(), NOW()
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM my_collections mc
        WHERE mc.owner_id = u.id AND mc.is_impression = true
      )
    `);

    if (process.env.NODE_ENV === "production") return;

    // -----------------------------------------------------------------------
    // Always-run cleanup (dev only): remove the old 민지 placeholder user
    // (00000000-...) from all team collection memberships.
    // -----------------------------------------------------------------------
    await client.query(`
      DELETE FROM team_collection_memberships
      WHERE user_id = '00000000-0000-4000-a000-000000000001'
    `);

    // -----------------------------------------------------------------------
    // Always-run backfill: insert missing sender self-inbox rows.
    // For each team_collection_articles row whose article's author has no
    // inbox entry, insert one so that the author can see their own article
    // in the listview after visibleAt (same gating as other recipients).
    // Uses the minimum visibleAt from existing inbox rows for that article;
    // falls back to tca.added_at if no inbox rows exist yet.
    // -----------------------------------------------------------------------
    await client.query(`
      INSERT INTO inbox (id, recipient_id, article_id, sender_id, visible_at, is_read, created_at)
      SELECT
        gen_random_uuid(),
        a.author_id,
        tca.article_id,
        a.author_id,
        COALESCE(
          (SELECT MIN(i2.visible_at)
           FROM inbox i2
           WHERE i2.article_id = tca.article_id
           LIMIT 1),
          tca.added_at
        ),
        FALSE,
        NOW()
      FROM team_collection_articles tca
      JOIN articles a ON a.id = tca.article_id
      WHERE tca.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM inbox
          WHERE article_id = tca.article_id
            AND recipient_id = a.author_id
        )
    `);

    // -----------------------------------------------------------------------
    // Idempotency sentinel: has the v2 seed (sender self-inbox + dev-민지 user)
    // already been applied?  Check for 하윤's self-inbox on the notice article.
    // -----------------------------------------------------------------------
    const { rows: sentinel } = await client.query(`
      SELECT id FROM inbox
      WHERE recipient_id = '54cbadb0-eab9-4f69-8c32-90a9e00d7908'
        AND article_id   = 'a1000001-0000-4000-a000-000000000001'
      LIMIT 1
    `);
    if (sentinel.length === 0) {
      logger.info("Inserting dev seed data (v2)…");

    // -----------------------------------------------------------------------
    // 1. Users
    //    민지 = 92d8bf9b (actual Supabase dev-bypass user)
    // -----------------------------------------------------------------------
    await client.query(`
      INSERT INTO users (id, email, nickname, created_at, updated_at)
      VALUES
        ('54cbadb0-eab9-4f69-8c32-90a9e00d7908','hayun@test.dev',  '하윤',      NOW(), NOW()),
        ('05cb0a0b-c73c-4d1c-8410-cee7da564fda','seojun@test.dev', '서준',      NOW(), NOW()),
        ('92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f','minji@test.dev',  '민지 (dev)',NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname
    `);

    // -----------------------------------------------------------------------
    // 2. Team collections
    // -----------------------------------------------------------------------
    await client.query(`
      INSERT INTO team_collections (id, name, description, creator_id, created_at, updated_at)
      VALUES
        ('2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2', '하윤이네 모임', NULL,
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', NOW(), NOW()),
        ('b2000001-0000-4000-b000-000000000001', '서준이네 모임', NULL,
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    // -----------------------------------------------------------------------
    // 3. Memberships
    // -----------------------------------------------------------------------
    await client.query(`
      INSERT INTO team_collection_memberships
        (id, team_collection_id, user_id, role, joined_at)
      VALUES
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', 'OWNER',  NOW()),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', 'MEMBER', NOW()),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', 'MEMBER', NOW()),
        (gen_random_uuid(), 'b2000001-0000-4000-b000-000000000001',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', 'OWNER',  NOW()),
        (gen_random_uuid(), 'b2000001-0000-4000-b000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', 'MEMBER', NOW()),
        (gen_random_uuid(), 'b2000001-0000-4000-b000-000000000001',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', 'MEMBER', NOW())
      ON CONFLICT ON CONSTRAINT team_collection_memberships_unique DO NOTHING
    `);

    // -----------------------------------------------------------------------
    // 4. Articles
    //    a1000001 – 하윤 notice (오늘의 인사 for 2026-04-27)
    //    a1000002 – 서준 regular
    //    a1000003 – 서준 봄날의 단상 (base for thread)
    //    a1000004 – 민지(92d8bf9b) reply to a1000003
    //    a1000005 – 하윤 reply-to-reply to a1000004 (chain: 3→4→5)
    //    a1000006 – 하윤 (soft-deleted, has reply a1000007)
    //    a1000007 – 서준 reply to a1000006 (parent will be soft-deleted)
    //    a1000008 – 민지(92d8bf9b) independent
    //    a0000001 – 서준 article in 서준이네 모임 ONLY (not in 하윤이네)
    //    a1000009 – 민지(92d8bf9b) reply to a0000001, added to 하윤이네 모임
    //               → parentInThisCollection = false (cross-collection reply)
    // -----------------------------------------------------------------------
    await client.query(`
      INSERT INTO articles
        (id, author_id, title, content, status, pages, style, cover,
         source_article_id, created_at, updated_at)
      VALUES
        ('a1000001-0000-4000-a000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          '4월 27일 인사드립니다', '안녕하세요, 모임 여러분. 4월 27일부터 새로운 기능이 추가되었습니다. 많은 이용 부탁드립니다.',
          'LETTER', '[]', NULL, NULL, NULL,
          '2026-04-26 21:00:00+00', '2026-04-26 21:00:00+00'),
        ('a1000002-0000-4000-a000-000000000002',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '방금 쓴 따끈한 글', '글을 쓰고 싶은 마음이 들 때 바로 써야 한다. 나중에 쓰려 하면 그 느낌이 사라져 버린다.',
          'LETTER', '[]', NULL, NULL, NULL,
          '2026-04-27 10:02:31+00', '2026-04-27 10:02:31+00'),
        ('a1000003-0000-4000-a000-000000000003',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '봄날의 단상', '오늘은 따뜻한 봄날이었다. 창문 너머로 벚꽃이 흩날렸고, 잠시 멍하니 바라보다 이 글을 쓴다.',
          'LETTER', '[]', NULL, NULL, NULL,
          '2026-04-25 21:00:00+00', '2026-04-25 21:00:00+00'),
        ('a1000004-0000-4000-a000-000000000004',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          '봄날의 단상 - 답장', '봄날의 단상 잘 읽었어요. 저도 오늘 공원을 산책했는데 같은 기분이었어요. 봄은 참 짧게 지나가는 것 같아요.',
          'LETTER', '[]', NULL, NULL,
          'a1000003-0000-4000-a000-000000000003',
          '2026-04-25 22:00:00+00', '2026-04-25 22:00:00+00'),
        ('a1000005-0000-4000-a000-000000000005',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          '봄날의 단상 - 재답장', '맞아요, 봄은 정말 순식간에 가버려요. 그래서 더 소중한 것 같기도 하고요. 올여름도 잘 보내봐요.',
          'LETTER', '[]', NULL, NULL,
          'a1000004-0000-4000-a000-000000000004',
          '2026-04-25 23:00:00+00', '2026-04-25 23:00:00+00'),
        ('a1000006-0000-4000-a000-000000000006',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          '삭제된 원글', '이 글은 이미 삭제된 글입니다.',
          'LETTER', '[]', NULL, NULL, NULL,
          '2026-04-26 09:00:00+00', '2026-04-26 09:00:00+00'),
        ('a1000007-0000-4000-a000-000000000007',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '삭제된 글에 대한 답장', '원글을 읽고 짧게 답장을 남깁니다. 좋은 글이었어요.',
          'LETTER', '[]', NULL, NULL,
          'a1000006-0000-4000-a000-000000000006',
          '2026-04-26 10:00:00+00', '2026-04-26 10:00:00+00'),
        ('a1000008-0000-4000-a000-000000000008',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          '독립 글', '혼자 쓰는 글도 좋다. 누군가에게 보내지 않아도, 쓰는 행위 자체가 위로가 된다.',
          'LETTER', '[]', NULL, NULL, NULL,
          '2026-04-24 21:00:00+00', '2026-04-24 21:00:00+00'),
        ('a0000001-0000-4000-a000-000000000001',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '서준이네 모임 전용 글', '서준이네 모임 여러분, 다음 모임은 다음 주 토요일로 잠정 결정했어요. 참석 여부 알려주세요.',
          'LETTER', '[]', NULL, NULL, NULL,
          '2026-04-23 09:00:00+00', '2026-04-23 09:00:00+00'),
        ('a1000009-0000-4000-a000-000000000009',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          '다른 모음 글에 대한 답장', '토요일 모임 참석할게요. 장소는 어디로 할까요?',
          'LETTER', '[]', NULL, NULL,
          'a0000001-0000-4000-a000-000000000001',
          '2026-04-23 11:00:00+00', '2026-04-23 11:00:00+00')
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        status = EXCLUDED.status,
        pages = EXCLUDED.pages,
        style = EXCLUDED.style,
        cover = EXCLUDED.cover,
        source_article_id = EXCLUDED.source_article_id,
        updated_at = EXCLUDED.updated_at
    `);

    // -----------------------------------------------------------------------
    // 5. team_collection_articles
    //    Collection 1 (하윤이네): a1000001–a1000009
    //    Collection 2 (서준이네): a0000001 only
    //    a1000006 is soft-deleted (has live reply a1000007)
    //    a1000009 is reply to a0000001 which is NOT in collection 1
    //      → parentInThisCollection = false when viewing collection 1
    // -----------------------------------------------------------------------
    await client.query(`
      INSERT INTO team_collection_articles
        (id, team_collection_id, article_id, added_by, added_at, deleted_at)
      VALUES
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          'a1000001-0000-4000-a000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          '2026-04-26 21:00:00+00', NULL),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          'a1000002-0000-4000-a000-000000000002',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '2026-04-27 10:02:31+00', NULL),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          'a1000003-0000-4000-a000-000000000003',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '2026-04-25 21:00:00+00', NULL),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          'a1000004-0000-4000-a000-000000000004',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          '2026-04-25 22:00:00+00', NULL),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          'a1000005-0000-4000-a000-000000000005',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          '2026-04-25 23:00:00+00', NULL),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          'a1000006-0000-4000-a000-000000000006',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          '2026-04-26 09:00:00+00', '2026-04-27 08:00:00+00'),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          'a1000007-0000-4000-a000-000000000007',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '2026-04-26 10:00:00+00', NULL),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          'a1000008-0000-4000-a000-000000000008',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          '2026-04-24 21:00:00+00', NULL),
        (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
          'a1000009-0000-4000-a000-000000000009',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          '2026-04-23 11:00:00+00', NULL),
        (gen_random_uuid(), 'b2000001-0000-4000-b000-000000000001',
          'a0000001-0000-4000-a000-000000000001',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '2026-04-23 09:00:00+00', NULL)
      ON CONFLICT ON CONSTRAINT team_collection_articles_unique DO NOTHING
    `);

    // -----------------------------------------------------------------------
    // 6. Inbox entries
    //    Each article gets inbox rows for ALL members of its collection,
    //    including the sender (self-inbox) — so visibleAt gating is uniform.
    //
    //    Delivery slot logic (KST, single slot):
    //      addedAt before 06:00 KST → 06:00 KST same day  (UTC: previous day 21:00)
    //      addedAt 06:00+ KST       → 06:00 KST next day  (UTC: same day 21:00)
    //
    //    All seeded visibleAt values are in the past (2026-04-27 is today).
    //
    //    First, clear any existing inbox rows for seeded articles so we don't
    //    accumulate duplicates across restarts.
    // -----------------------------------------------------------------------
    const SEEDED_ARTICLE_IDS = [
      "'a1000001-0000-4000-a000-000000000001'",
      "'a1000002-0000-4000-a000-000000000002'",
      "'a1000003-0000-4000-a000-000000000003'",
      "'a1000004-0000-4000-a000-000000000004'",
      "'a1000005-0000-4000-a000-000000000005'",
      "'a1000006-0000-4000-a000-000000000006'",
      "'a1000007-0000-4000-a000-000000000007'",
      "'a1000008-0000-4000-a000-000000000008'",
      "'a0000001-0000-4000-a000-000000000001'",
      "'a1000009-0000-4000-a000-000000000009'",
    ].join(", ");

    await client.query(`DELETE FROM inbox WHERE article_id IN (${SEEDED_ARTICLE_IDS})`);

    await client.query(`
      INSERT INTO inbox
        (id, recipient_id, article_id, sender_id, visible_at, is_read, created_at)
      VALUES
        -- a1000001 (하윤 notice, addedAt 2026-04-26T21:00Z = KST 06:00 → slot KST next 06:00 = UTC 21:00)
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000001-0000-4000-a000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-27 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000001-0000-4000-a000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-27 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 하윤
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000001-0000-4000-a000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-27 21:00:00+00', FALSE, NOW()),

        -- a1000002 (서준, addedAt 2026-04-27T10:02Z = KST 19:02 → slot KST next 06:00 = UTC 21:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000002-0000-4000-a000-000000000002',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-27 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000002-0000-4000-a000-000000000002',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-27 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 서준
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000002-0000-4000-a000-000000000002',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-27 21:00:00+00', FALSE, NOW()),

        -- a1000003 (서준, addedAt 2026-04-25T21:00Z = KST 06:00 → slot KST next 06:00 = UTC 21:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000003-0000-4000-a000-000000000003',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-26 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000003-0000-4000-a000-000000000003',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-26 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 서준
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000003-0000-4000-a000-000000000003',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-26 21:00:00+00', FALSE, NOW()),

        -- a1000004 (민지, addedAt 2026-04-25T22:00Z = KST 07:00 → slot KST next 06:00 = UTC 21:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000004-0000-4000-a000-000000000004',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-26 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000004-0000-4000-a000-000000000004',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-26 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 민지
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000004-0000-4000-a000-000000000004',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-26 21:00:00+00', FALSE, NOW()),

        -- a1000005 (하윤, addedAt 2026-04-25T23:00Z = KST 08:00 → slot KST next 06:00 = UTC 21:00)
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000005-0000-4000-a000-000000000005',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-26 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000005-0000-4000-a000-000000000005',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-26 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 하윤
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000005-0000-4000-a000-000000000005',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-26 21:00:00+00', FALSE, NOW()),

        -- a1000006 (하윤, addedAt 2026-04-26T09:00Z = KST 18:00 → slot KST next 06:00 = UTC 21:00)
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000006-0000-4000-a000-000000000006',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-26 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000006-0000-4000-a000-000000000006',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-26 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 하윤
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000006-0000-4000-a000-000000000006',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-26 21:00:00+00', FALSE, NOW()),

        -- a1000007 (서준, addedAt 2026-04-26T10:00Z = KST 19:00 → slot KST next 06:00 = UTC 21:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000007-0000-4000-a000-000000000007',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-26 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000007-0000-4000-a000-000000000007',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-26 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 서준
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000007-0000-4000-a000-000000000007',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-26 21:00:00+00', FALSE, NOW()),

        -- a1000008 (민지, addedAt 2026-04-24T21:00Z = KST 06:00 → slot KST next 06:00 = UTC 21:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000008-0000-4000-a000-000000000008',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-25 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000008-0000-4000-a000-000000000008',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-25 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 민지
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000008-0000-4000-a000-000000000008',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-25 21:00:00+00', FALSE, NOW()),

        -- a0000001 (서준, in 서준이네 모임, addedAt 2026-04-23T09:00Z = KST 18:00 → next 06:00 = UTC 21:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a0000001-0000-4000-a000-000000000001',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-23 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a0000001-0000-4000-a000-000000000001',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-23 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 서준
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a0000001-0000-4000-a000-000000000001',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-23 21:00:00+00', FALSE, NOW()),

        -- a1000009 (민지, cross-collection reply, addedAt 2026-04-23T11:00Z = KST 20:00 → next 06:00 = UTC 21:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000009-0000-4000-a000-000000000009',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-23 21:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000009-0000-4000-a000-000000000009',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-23 21:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 민지
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000009-0000-4000-a000-000000000009',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-23 21:00:00+00', FALSE, NOW())
    `);

      logger.info("Dev seed data (v2) inserted successfully");
    } else {
      logger.info("Dev seed data already present (v2), skipping");
    }

    // -----------------------------------------------------------------------
    // v3 sentinel: has the민지 10-letter thread block already been applied?
    // Check for 하윤's inbox row on the first v3 article (a1000010).
    // -----------------------------------------------------------------------
    const { rows: sentinelV3 } = await client.query(`
      SELECT id FROM inbox
      WHERE recipient_id = '54cbadb0-eab9-4f69-8c32-90a9e00d7908'
        AND article_id   = 'a1000010-0000-4000-a000-000000000010'
      LIMIT 1
    `);
    if (sentinelV3.length > 0) {
      logger.info("Dev seed data already present (v3), skipping");
    } else {
      logger.info("Inserting dev seed data (v3)…");

      // ---------------------------------------------------------------------
      // v3-1. Articles a1000010–a1000019
      //   Thread A: 민지 원글(a1000010) → 하윤 답장(a1000011) → 민지 재답장(a1000012)
      //   Thread B: 서준 원글(a1000013) → 민지 답장(a1000014) → 서준 재답장(a1000015)
      //   Thread C: 하윤 원글(a1000016) → 민지 답장(a1000017)
      //   Thread D: 민지 원글(a1000018) → 서준 답장(a1000019)
      // ---------------------------------------------------------------------
      await client.query(`
        INSERT INTO articles
          (id, author_id, title, content, status, pages, style, cover,
           source_article_id, is_notice, notice_date, created_at, updated_at)
        VALUES
          ('a1000010-0000-4000-a000-000000000010',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '봄비 소리', '오늘 아침 봄비가 내렸다. 창문을 열어두고 빗소리를 들으며 오래전 일들을 떠올렸다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            '2026-04-28 08:00:00+00', '2026-04-28 08:00:00+00'),
          ('a1000011-0000-4000-a000-000000000011',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '봄비 소리 - 답장', '민지야, 나도 오늘 빗소리 들으며 커피 한 잔 마셨어. 봄비는 왜 이렇게 마음을 촉촉하게 만드는지.',
            'LETTER', '[]', NULL, NULL,
            'a1000010-0000-4000-a000-000000000010', FALSE, NULL,
            '2026-04-28 10:00:00+00', '2026-04-28 10:00:00+00'),
          ('a1000012-0000-4000-a000-000000000012',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '봄비 소리 - 재답장', '하윤아, 맞아. 봄비 맞으며 산책이라도 한번 같이 해야겠다. 다음 주에 시간 돼?',
            'LETTER', '[]', NULL, NULL,
            'a1000011-0000-4000-a000-000000000011', FALSE, NULL,
            '2026-04-28 12:00:00+00', '2026-04-28 12:00:00+00'),

          ('a1000013-0000-4000-a000-000000000013',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            '최근에 읽은 책', '요즘 소설을 다시 읽기 시작했다. 오랫동안 바빠서 멀리했던 책들이 새삼 그리웠다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            '2026-04-29 01:00:00+00', '2026-04-29 01:00:00+00'),
          ('a1000014-0000-4000-a000-000000000014',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '최근에 읽은 책 - 답장', '서준아, 나도 요즘 책을 다시 읽고 있어! 어떤 소설 읽었어? 추천해줘.',
            'LETTER', '[]', NULL, NULL,
            'a1000013-0000-4000-a000-000000000013', FALSE, NULL,
            '2026-04-29 03:00:00+00', '2026-04-29 03:00:00+00'),
          ('a1000015-0000-4000-a000-000000000015',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            '최근에 읽은 책 - 재답장', '민지야, 요즘 무라카미 하루키 단편집 읽는 중이야. 분위기가 딱 봄이랑 맞아.',
            'LETTER', '[]', NULL, NULL,
            'a1000014-0000-4000-a000-000000000014', FALSE, NULL,
            '2026-04-29 05:00:00+00', '2026-04-29 05:00:00+00'),

          ('a1000016-0000-4000-a000-000000000016',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '주말 오후', '오늘 오후에 아무 계획 없이 그냥 집에 있었다. 오랜만에 완전히 아무것도 안 한 날이었다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            '2026-04-30 00:00:00+00', '2026-04-30 00:00:00+00'),
          ('a1000017-0000-4000-a000-000000000017',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '주말 오후 - 답장', '하윤아, 그런 날이 제일 좋더라. 나도 요즘 아무것도 안 하는 시간이 필요했어.',
            'LETTER', '[]', NULL, NULL,
            'a1000016-0000-4000-a000-000000000016', FALSE, NULL,
            '2026-04-30 02:00:00+00', '2026-04-30 02:00:00+00'),

          ('a1000018-0000-4000-a000-000000000018',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '요즘 생각들', '요즘 들어 사소한 것들이 새삼 소중하게 느껴진다. 아침 햇살, 밥 냄새, 웃음 소리 같은 것들.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            '2026-04-30 21:00:00+00', '2026-04-30 21:00:00+00'),
          ('a1000019-0000-4000-a000-000000000019',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            '요즘 생각들 - 답장', '민지야, 그 마음 알아. 나도 요즘 그런 생각 많이 해. 우리 자주 이야기하자.',
            'LETTER', '[]', NULL, NULL,
            'a1000018-0000-4000-a000-000000000018', FALSE, NULL,
            '2026-04-30 23:00:00+00', '2026-04-30 23:00:00+00')
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          status = EXCLUDED.status,
          pages = EXCLUDED.pages,
          style = EXCLUDED.style,
          cover = EXCLUDED.cover,
          source_article_id = EXCLUDED.source_article_id,
          is_notice = EXCLUDED.is_notice,
          notice_date = EXCLUDED.notice_date,
          updated_at = EXCLUDED.updated_at
      `);

      // ---------------------------------------------------------------------
      // v3-2. team_collection_articles — all 10 into 하윤이네 모임
      // ---------------------------------------------------------------------
      await client.query(`
        INSERT INTO team_collection_articles
          (id, team_collection_id, article_id, added_by, added_at, deleted_at)
        VALUES
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000010-0000-4000-a000-000000000010',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-28 08:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000011-0000-4000-a000-000000000011',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-28 10:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000012-0000-4000-a000-000000000012',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-28 12:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000013-0000-4000-a000-000000000013',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-29 01:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000014-0000-4000-a000-000000000014',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-29 03:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000015-0000-4000-a000-000000000015',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-29 05:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000016-0000-4000-a000-000000000016',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-30 00:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000017-0000-4000-a000-000000000017',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-30 02:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000018-0000-4000-a000-000000000018',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-30 21:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000019-0000-4000-a000-000000000019',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-30 23:00:00+00', NULL)
        ON CONFLICT ON CONSTRAINT team_collection_articles_unique DO NOTHING
      `);

      // ---------------------------------------------------------------------
      // v3-3. Inbox entries — 3 members each (하윤·서준·민지), including sender
      //
      //   Delivery slot logic (KST, single slot):
      //     addedAt before 06:00 KST → 06:00 KST same day  (UTC prev day 21:00)
      //     addedAt 06:00+ KST       → 06:00 KST next day  (UTC same day 21:00)
      //
      //   a1000010: addedAt 08:00 UTC = KST 17:00 → slot KST next 06:00 = UTC 21:00 (Apr 28)
      //   a1000011: addedAt 10:00 UTC = KST 19:00 → slot KST next 06:00 = UTC 21:00 (Apr 28)
      //   a1000012: addedAt 12:00 UTC = KST 21:00 → slot KST next 06:00 = UTC 21:00 (Apr 28)
      //   a1000013: addedAt 01:00 UTC = KST 10:00 → slot KST next 06:00 = UTC 21:00 (Apr 29)
      //   a1000014: addedAt 03:00 UTC = KST 12:00 → slot KST next 06:00 = UTC 21:00 (Apr 29)
      //   a1000015: addedAt 05:00 UTC = KST 14:00 → slot KST next 06:00 = UTC 21:00 (Apr 29)
      //   a1000016: addedAt 00:00 UTC = KST 09:00 → slot KST next 06:00 = UTC 21:00 (Apr 30)
      //   a1000017: addedAt 02:00 UTC = KST 11:00 → slot KST next 06:00 = UTC 21:00 (Apr 30)
      //   a1000018: addedAt Apr30 21:00 UTC = KST May1 06:00 → slot KST next 06:00 = UTC May1 21:00
      //   a1000019: addedAt Apr30 23:00 UTC = KST May1 08:00 → slot KST next 06:00 = UTC May1 21:00
      // ---------------------------------------------------------------------
      await client.query(`
        INSERT INTO inbox
          (id, recipient_id, article_id, sender_id, visible_at, is_read, created_at)
        VALUES
          -- a1000010 (민지 원글, visibleAt Apr 28 21:00 UTC = KST Apr 29 06:00)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000010-0000-4000-a000-000000000010',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-28 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000010-0000-4000-a000-000000000010',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-28 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000010-0000-4000-a000-000000000010',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-28 21:00:00+00', FALSE, NOW()),

          -- a1000011 (하윤 답장, visibleAt Apr 28 21:00 UTC)
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000011-0000-4000-a000-000000000011',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-28 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000011-0000-4000-a000-000000000011',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-28 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000011-0000-4000-a000-000000000011',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-28 21:00:00+00', FALSE, NOW()),

          -- a1000012 (민지 재답장, visibleAt Apr 28 21:00 UTC)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000012-0000-4000-a000-000000000012',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-28 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000012-0000-4000-a000-000000000012',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-28 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000012-0000-4000-a000-000000000012',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-28 21:00:00+00', FALSE, NOW()),

          -- a1000013 (서준 원글, visibleAt Apr 29 21:00 UTC = KST Apr 30 06:00)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000013-0000-4000-a000-000000000013',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-29 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000013-0000-4000-a000-000000000013',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-29 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000013-0000-4000-a000-000000000013',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-29 21:00:00+00', FALSE, NOW()),

          -- a1000014 (민지 답장, visibleAt Apr 29 21:00 UTC = KST Apr 30 06:00)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000014-0000-4000-a000-000000000014',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-29 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000014-0000-4000-a000-000000000014',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-29 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000014-0000-4000-a000-000000000014',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-29 21:00:00+00', FALSE, NOW()),

          -- a1000015 (서준 재답장, visibleAt Apr 29 21:00 UTC = KST Apr 30 06:00)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000015-0000-4000-a000-000000000015',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-29 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000015-0000-4000-a000-000000000015',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-29 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000015-0000-4000-a000-000000000015',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-29 21:00:00+00', FALSE, NOW()),

          -- a1000016 (하윤 원글, visibleAt Apr 30 21:00 UTC = KST May 1 06:00)
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000016-0000-4000-a000-000000000016',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-30 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000016-0000-4000-a000-000000000016',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-30 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000016-0000-4000-a000-000000000016',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-30 21:00:00+00', FALSE, NOW()),

          -- a1000017 (민지 답장, visibleAt Apr 30 21:00 UTC = KST May 1 06:00)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000017-0000-4000-a000-000000000017',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-30 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000017-0000-4000-a000-000000000017',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-30 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000017-0000-4000-a000-000000000017',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-30 21:00:00+00', FALSE, NOW()),

          -- a1000018 (민지 원글, visibleAt Apr 30 21:00 UTC = KST May 1 06:00, guaranteed past)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000018-0000-4000-a000-000000000018',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-30 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000018-0000-4000-a000-000000000018',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-30 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000018-0000-4000-a000-000000000018',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-30 21:00:00+00', FALSE, NOW()),

          -- a1000019 (서준 답장, visibleAt Apr 30 21:00 UTC = KST May 1 06:00, guaranteed past)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000019-0000-4000-a000-000000000019',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-30 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000019-0000-4000-a000-000000000019',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-30 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000019-0000-4000-a000-000000000019',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-30 21:00:00+00', FALSE, NOW())
      `);

      logger.info("Dev seed data (v3) inserted successfully");
    }

    // -----------------------------------------------------------------------
    // v4 sentinel: two new standalone letters (a1000020, a1000021)
    // -----------------------------------------------------------------------
    const { rows: sentinelV4 } = await client.query(`
      SELECT id FROM inbox
      WHERE recipient_id = '54cbadb0-eab9-4f69-8c32-90a9e00d7908'
        AND article_id   = 'a1000020-0000-4000-a000-000000000020'
      LIMIT 1
    `);
    if (sentinelV4.length > 0) {
      logger.info("Dev seed data already present (v4), skipping");
    } else {
      logger.info("Inserting dev seed data (v4)…");

      // v4-1. Articles
      await client.query(`
        INSERT INTO articles
          (id, author_id, title, content, status, pages, style, cover,
           source_article_id, is_notice, notice_date, created_at, updated_at)
        VALUES
          ('a1000020-0000-4000-a000-000000000020',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '5월의 첫 아침', '5월이 왔다. 창문 너머로 라일락 향기가 흘러들어 오는 것 같은 아침이었다. 계절이 바뀔 때마다 괜히 새로운 마음이 든다는 게 신기하면서도 좋다. 아직 아무것도 망치지 않은 달이라서 그런가, 5월 첫날은 늘 설레는 것 같다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            '2026-05-01 00:00:00+00', '2026-05-01 00:00:00+00'),
          ('a1000021-0000-4000-a000-000000000021',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            '요즘 듣는 음악', '요즘 일할 때 재즈를 자주 듣는다. 말 없이 흘러가는 선율이 집중하기에 오히려 좋더라. 추천하고 싶은 앨범이 있는데, 언제 한번 같이 들어볼 날이 생기면 좋겠다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            '2026-05-01 01:30:00+00', '2026-05-01 01:30:00+00')
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          updated_at = EXCLUDED.updated_at
      `);

      // v4-2. team_collection_articles (하윤이네 모임)
      await client.query(`
        INSERT INTO team_collection_articles
          (id, team_collection_id, article_id, added_by, added_at, deleted_at)
        VALUES
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000020-0000-4000-a000-000000000020',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '2026-05-01 00:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000021-0000-4000-a000-000000000021',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            '2026-05-01 01:30:00+00', NULL)
        ON CONFLICT ON CONSTRAINT team_collection_articles_unique DO NOTHING
      `);

      // v4-3. Inbox entries (visibleAt May 1 21:00 UTC = KST May 2 06:00, guaranteed past)
      await client.query(`
        INSERT INTO inbox
          (id, recipient_id, article_id, sender_id, visible_at, is_read, created_at)
        VALUES
          -- a1000020 (하윤 원글, addedAt KST 09:00 → slot KST next 06:00 = UTC 21:00)
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000020-0000-4000-a000-000000000020',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000020-0000-4000-a000-000000000020',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000020-0000-4000-a000-000000000020',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-05-01 21:00:00+00', FALSE, NOW()),

          -- a1000021 (서준 원글, addedAt KST 10:30 → slot KST next 06:00 = UTC 21:00)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000021-0000-4000-a000-000000000021',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000021-0000-4000-a000-000000000021',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000021-0000-4000-a000-000000000021',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-05-01 21:00:00+00', FALSE, NOW())
      `);

      logger.info("Dev seed data (v4) inserted successfully");
    }

    // -----------------------------------------------------------------------
    // v5 sentinel: three more letters in 하윤이네 모임 (a1000022–a1000024)
    // -----------------------------------------------------------------------
    const { rows: sentinelV5 } = await client.query(`
      SELECT id FROM inbox
      WHERE recipient_id = '54cbadb0-eab9-4f69-8c32-90a9e00d7908'
        AND article_id   = 'a1000022-0000-4000-a000-000000000022'
      LIMIT 1
    `);
    if (sentinelV5.length > 0) {
      logger.info("Dev seed data already present (v5), skipping");
    } else {
      logger.info("Inserting dev seed data (v5)…");

      // v5-1. Articles
      await client.query(`
        INSERT INTO articles
          (id, author_id, title, content, status, pages, style, cover,
           source_article_id, is_notice, notice_date, created_at, updated_at)
        VALUES
          ('a1000022-0000-4000-a000-000000000022',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '산책 일기', '오늘 오래간만에 한강변을 걸었다. 강바람이 생각보다 차가워서 귀가 얼얼해졌지만, 물 위로 지는 노을이 너무 예뻐서 한참을 서서 바라봤다. 그냥 조용히 걷는 시간이 이렇게 소중한 거였나 싶었다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            '2026-05-01 03:00:00+00', '2026-05-01 03:00:00+00'),
          ('a1000023-0000-4000-a000-000000000023',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '오늘의 날씨 같은 기분', '흐렸다가 맑아지는 날이었다. 오전엔 괜히 울적했는데 점심을 먹고 나서부터 기분이 좀 나아졌다. 날씨랑 기분이 꼭 닮아 있을 때가 있다. 별일도 없는데 하루가 이렇게 달라지네.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            '2026-05-01 05:00:00+00', '2026-05-01 05:00:00+00'),
          ('a1000024-0000-4000-a000-000000000024',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            '오래된 사진', '서랍을 정리하다가 5년 전 사진을 발견했다. 다들 그때가 더 어려 보이는데, 나만 별로 안 변한 것 같아서 좀 억울하다. 근데 사진 속 표정들이 지금보다 훨씬 밝아서, 그땐 뭐가 그렇게 좋았나 한참 생각했다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            '2026-05-01 07:00:00+00', '2026-05-01 07:00:00+00')
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          updated_at = EXCLUDED.updated_at
      `);

      // v5-2. team_collection_articles (하윤이네 모임)
      await client.query(`
        INSERT INTO team_collection_articles
          (id, team_collection_id, article_id, added_by, added_at, deleted_at)
        VALUES
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000022-0000-4000-a000-000000000022',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '2026-05-01 03:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000023-0000-4000-a000-000000000023',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '2026-05-01 05:00:00+00', NULL),
          (gen_random_uuid(), '2d9417a7-27e4-46c0-9ae5-3c4a4298c0f2',
            'a1000024-0000-4000-a000-000000000024',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            '2026-05-01 07:00:00+00', NULL)
        ON CONFLICT ON CONSTRAINT team_collection_articles_unique DO NOTHING
      `);

      // v5-3. Inbox entries (visibleAt May 1 21:00 UTC = KST May 2 06:00)
      await client.query(`
        INSERT INTO inbox
          (id, recipient_id, article_id, sender_id, visible_at, is_read, created_at)
        VALUES
          -- a1000022 (민지 원글)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000022-0000-4000-a000-000000000022',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000022-0000-4000-a000-000000000022',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000022-0000-4000-a000-000000000022',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-05-01 21:00:00+00', FALSE, NOW()),

          -- a1000023 (하윤 원글)
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000023-0000-4000-a000-000000000023',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000023-0000-4000-a000-000000000023',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000023-0000-4000-a000-000000000023',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-05-01 21:00:00+00', FALSE, NOW()),

          -- a1000024 (서준 원글)
          (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000024-0000-4000-a000-000000000024',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000024-0000-4000-a000-000000000024',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-05-01 21:00:00+00', FALSE, NOW()),
          (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000024-0000-4000-a000-000000000024',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-05-01 21:00:00+00', FALSE, NOW())
      `);

      logger.info("Dev seed data (v5) inserted successfully");
    }
    // -----------------------------------------------------------------------
    // v6 sentinel: send_records for QA badge verification
    // Check for 하윤's send record on a1000001.
    // -----------------------------------------------------------------------
    const { rows: sentinelV6 } = await client.query(`
      SELECT id FROM send_records
      WHERE sender_id = '54cbadb0-eab9-4f69-8c32-90a9e00d7908'
        AND article_id = 'a1000001-0000-4000-a000-000000000001'
      LIMIT 1
    `);
    if (sentinelV6.length > 0) {
      logger.info("Dev seed data already present (v6), skipping");
    } else {
      logger.info("Inserting dev seed data (v6)…");

      // Send records for 하윤 (54cbadb0):
      //   a1000001 → 서준, deliverySlot past → isDelivered=true → [발신됨]
      //   a1000011 → 민지, deliverySlot past → isDelivered=true → [발신됨]
      //   a1000020 → 서준, deliverySlot future → isDelivered=false → [발신 예정]
      //
      // Send records for 민지/dev (92d8bf9b):
      //   a1000010 → 하윤, deliverySlot past → isDelivered=true → [발신됨]
      //   a1000017 → 하윤, deliverySlot past → isDelivered=true → [발신됨]
      //   a1000022 → 서준, deliverySlot future → isDelivered=false → [발신 예정]
      await client.query(`
        INSERT INTO send_records
          (id, sender_id, recipient_id, article_id, inbox_id, team_collection_id, target_type, delivery_slot, sent_at)
        VALUES
          (gen_random_uuid(),
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000001-0000-4000-a000-000000000001',
            NULL, NULL, 'person',
            '2026-04-27 21:00:00+00', '2026-04-26 21:00:00+00'),
          (gen_random_uuid(),
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a1000011-0000-4000-a000-000000000011',
            NULL, NULL, 'person',
            '2026-04-28 21:00:00+00', '2026-04-28 10:00:00+00'),
          (gen_random_uuid(),
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000020-0000-4000-a000-000000000020',
            NULL, NULL, 'person',
            NOW() + interval '7 days', '2026-05-01 00:00:00+00'),
          (gen_random_uuid(),
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000010-0000-4000-a000-000000000010',
            NULL, NULL, 'person',
            '2026-04-28 21:00:00+00', '2026-04-28 08:00:00+00'),
          (gen_random_uuid(),
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a1000017-0000-4000-a000-000000000017',
            NULL, NULL, 'person',
            '2026-04-30 21:00:00+00', '2026-04-30 02:00:00+00'),
          (gen_random_uuid(),
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a1000022-0000-4000-a000-000000000022',
            NULL, NULL, 'person',
            NOW() + interval '7 days', '2026-05-01 03:00:00+00')
        ON CONFLICT DO NOTHING
      `);

      logger.info("Dev seed data (v6) inserted successfully");
    }

    // -----------------------------------------------------------------------
    // v7 sentinel: ㅌㅅㅌ 공간 — 참여자·편지·슬롯 시드
    //   Space:   19496c3d-a08a-4218-9e9a-dce2dfc57849 (민지가 운영하는 공간)
    //   Rounds:
    //     Round 1 (887bbe69): UPCOMING → ACTIVE + 여는 편지 + 중심 편지 3편
    //     Round 2 (8705018f): UPCOMING + 5명 슬롯
    //     Round 3 (44777912): UPCOMING + 4명 슬롯
    //     Round 4 (e714e0de): UPCOMING + 3명 슬롯 (민지 내 차례 포함)
    //     Round 5 (904a14a5): UPCOMING, 슬롯 없음 (배너 유지)
    // -----------------------------------------------------------------------
    const { rows: sentinelV7 } = await client.query(`
      SELECT id FROM space_round_slots
      WHERE id = 'd2000001-0000-4000-d000-000000000001'
      LIMIT 1
    `);
    if (sentinelV7.length > 0) {
      logger.info("Dev seed data already present (v7), skipping");
    } else {
      logger.info("Inserting dev seed data (v7)…");

      // v7-0. 새 참여자 3명
      await client.query(`
        INSERT INTO users (id, email, nickname, created_at, updated_at)
        VALUES
          ('b3000001-0000-4000-b000-000000000001', 'eunseo@test.dev', '은서', NOW(), NOW()),
          ('b3000002-0000-4000-b000-000000000002', 'jaemin@test.dev', '재민', NOW(), NOW()),
          ('b3000003-0000-4000-b000-000000000003', 'jisu@test.dev',   '지수', NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname
      `);

      // v7-1. 공간 참여 등록 (민지=운영자, 나머지=참여자 APPROVED)
      //   민지는 앱에서 공간을 직접 생성했으므로 이미 OPERATOR 행이 있을 수 있음 → DO NOTHING
      await client.query(`
        INSERT INTO space_participations
          (id, space_id, user_id, role, join_path, status,
           invitation_id, code_request_id, created_at, updated_at)
        VALUES
          (gen_random_uuid(), '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'OPERATOR', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '30 days', NOW()),
          (gen_random_uuid(), '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '28 days', NOW()),
          (gen_random_uuid(), '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '27 days', NOW()),
          (gen_random_uuid(), '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            'b3000001-0000-4000-b000-000000000001',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '26 days', NOW()),
          (gen_random_uuid(), '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            'b3000002-0000-4000-b000-000000000002',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '25 days', NOW()),
          (gen_random_uuid(), '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            'b3000003-0000-4000-b000-000000000003',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '24 days', NOW())
        ON CONFLICT ON CONSTRAINT space_participations_space_user_unique DO NOTHING
      `);

      // v7-2. Round 1 → ACTIVE (이미 ACTIVE이면 무해)
      await client.query(`
        UPDATE space_rounds
        SET status = 'ACTIVE',
            starts_at = NOW() - interval '14 days',
            updated_at = NOW()
        WHERE id = '887bbe69-4dd3-420b-a12b-ca925c831161'
          AND status = 'UPCOMING'
      `);

      // v7-3. Round 1 편지 본문 (articles)
      await client.query(`
        INSERT INTO articles
          (id, author_id, title, content, status, pages, style, cover,
           source_article_id, is_notice, notice_date, created_at, updated_at)
        VALUES
          ('a2000001-0000-4000-a000-000000000001',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '이번 회차를 시작하며',
            '안녕하세요, 모두. 오래 기다리셨죠. 드디어 첫 번째 회차를 시작합니다. 각자의 속도로 편하게 써내려가 주시면 좋겠어요. 글 쓰는 일이 부담보다 기쁨이 되길 바라며, 잘 부탁드려요.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            NOW() - interval '13 days', NOW() - interval '13 days'),
          ('a2000002-0000-4000-a000-000000000002',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            '요즘 나를 채우는 것들',
            '요즘은 이상하게 작은 것들이 눈에 많이 들어온다. 출근길에 마주치는 고양이, 점심때 창밖으로 보이는 은행나무, 퇴근하고 마시는 따뜻한 차 한 잔. 별것 아닌 것들이 하루를 붙들어주는 것 같아서, 그게 좋다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            NOW() - interval '10 days', NOW() - interval '10 days'),
          ('a2000003-0000-4000-a000-000000000003',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            '가을이 오기 전에',
            '여름이 끝나기 전에 하고 싶었던 것들을 적어봤는데, 절반도 못 했다. 그래도 괜찮다고 생각하기로 했다. 계획은 언제나 현실보다 조금 더 부풀어 있는 법이니까. 가을에는 조금 더 현실적인 목록을 써볼 예정이다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            NOW() - interval '8 days', NOW() - interval '8 days'),
          ('a2000004-0000-4000-a000-000000000004',
            'b3000001-0000-4000-b000-000000000001',
            '처음 인사드립니다',
            '이 공간에 처음 들어왔을 때 조금 떨렸어요. 글을 쓰는 게 오래간만이라서. 그런데 여기 분위기가 너무 좋아서 금방 마음이 놓였어요. 앞으로 잘 부탁드려요. 짧지만 처음 인사를 남겨요.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            NOW() - interval '6 days', NOW() - interval '6 days')
        ON CONFLICT (id) DO UPDATE SET
          title   = EXCLUDED.title,
          content = EXCLUDED.content,
          updated_at = EXCLUDED.updated_at
      `);

      // v7-4. Round 1 공간 편지 (space_letters)
      await client.query(`
        INSERT INTO space_letters
          (id, space_id, space_round_id, author_id, source_article_id,
           letter_type, is_public, created_at, updated_at)
        VALUES
          ('c1000001-0000-4000-c000-000000000001',
            '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            '887bbe69-4dd3-420b-a12b-ca925c831161',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a2000001-0000-4000-a000-000000000001',
            'OPENING', TRUE,
            NOW() - interval '13 days', NOW() - interval '13 days'),
          ('c1000002-0000-4000-c000-000000000002',
            '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            '887bbe69-4dd3-420b-a12b-ca925c831161',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            'a2000002-0000-4000-a000-000000000002',
            'CENTER', FALSE,
            NOW() - interval '10 days', NOW() - interval '10 days'),
          ('c1000003-0000-4000-c000-000000000003',
            '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            '887bbe69-4dd3-420b-a12b-ca925c831161',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            'a2000003-0000-4000-a000-000000000003',
            'CENTER', FALSE,
            NOW() - interval '8 days', NOW() - interval '8 days'),
          ('c1000004-0000-4000-c000-000000000004',
            '19496c3d-a08a-4218-9e9a-dce2dfc57849',
            '887bbe69-4dd3-420b-a12b-ca925c831161',
            'b3000001-0000-4000-b000-000000000001',
            'a2000004-0000-4000-a000-000000000004',
            'CENTER', FALSE,
            NOW() - interval '6 days', NOW() - interval '6 days')
        ON CONFLICT (id) DO NOTHING
      `);

      // v7-5. Round 2 슬롯 (5명 — 하윤·서준·은서·재민·지수)
      await client.query(`
        INSERT INTO space_round_slots
          (id, space_round_id, assigned_user_id, slot_order, scheduled_date,
           created_at, updated_at)
        VALUES
          ('d2000001-0000-4000-d000-000000000001',
            '8705018f-8d43-42b9-abad-071844da90ad',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            1, '2026-08-04', NOW(), NOW()),
          ('d2000002-0000-4000-d000-000000000002',
            '8705018f-8d43-42b9-abad-071844da90ad',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            2, '2026-08-11', NOW(), NOW()),
          ('d2000003-0000-4000-d000-000000000003',
            '8705018f-8d43-42b9-abad-071844da90ad',
            'b3000001-0000-4000-b000-000000000001',
            3, '2026-08-18', NOW(), NOW()),
          ('d2000004-0000-4000-d000-000000000004',
            '8705018f-8d43-42b9-abad-071844da90ad',
            'b3000002-0000-4000-b000-000000000002',
            4, '2026-08-25', NOW(), NOW()),
          ('d2000005-0000-4000-d000-000000000005',
            '8705018f-8d43-42b9-abad-071844da90ad',
            'b3000003-0000-4000-b000-000000000003',
            5, '2026-09-01', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      // v7-6. Round 3 슬롯 (4명 — 재민·지수·서준·하윤)
      await client.query(`
        INSERT INTO space_round_slots
          (id, space_round_id, assigned_user_id, slot_order, scheduled_date,
           created_at, updated_at)
        VALUES
          ('d3000001-0000-4000-d000-000000000001',
            '44777912-69ac-488d-aaff-a9704374acfa',
            'b3000002-0000-4000-b000-000000000002',
            1, '2026-09-08', NOW(), NOW()),
          ('d3000002-0000-4000-d000-000000000002',
            '44777912-69ac-488d-aaff-a9704374acfa',
            'b3000003-0000-4000-b000-000000000003',
            2, '2026-09-15', NOW(), NOW()),
          ('d3000003-0000-4000-d000-000000000003',
            '44777912-69ac-488d-aaff-a9704374acfa',
            '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
            3, '2026-09-22', NOW(), NOW()),
          ('d3000004-0000-4000-d000-000000000004',
            '44777912-69ac-488d-aaff-a9704374acfa',
            '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
            4, '2026-09-29', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      // v7-7. Round 4 슬롯 (3명 — 은서·민지·재민, 민지는 내 차례 카드)
      await client.query(`
        INSERT INTO space_round_slots
          (id, space_round_id, assigned_user_id, slot_order, scheduled_date,
           created_at, updated_at)
        VALUES
          ('d4000001-0000-4000-d000-000000000001',
            'e714e0de-7cb5-4a5e-b238-f811eb34ddbb',
            'b3000001-0000-4000-b000-000000000001',
            1, '2026-10-06', NOW(), NOW()),
          ('d4000002-0000-4000-d000-000000000002',
            'e714e0de-7cb5-4a5e-b238-f811eb34ddbb',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            2, '2026-10-13', NOW(), NOW()),
          ('d4000003-0000-4000-d000-000000000003',
            'e714e0de-7cb5-4a5e-b238-f811eb34ddbb',
            'b3000002-0000-4000-b000-000000000002',
            3, '2026-10-20', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      logger.info("Dev seed data (v7) inserted successfully");
    }

    // -----------------------------------------------------------------------
    // v8 sentinel: 민지 운영자 다중 공간 세팅
    //   Users: 서연·지호·수아·태윤·예린 (5명)
    //   Space A: 파친코 읽기 모임     — RECRUITING, N_DAY(7), plannedStartsAt 미경과
    //   Space B: 82년생 김지영 독서 클럽 — RECRUITING, WEEKDAY(화·목), plannedStartsAt 경과
    //   Space C: 채식주의자 이야기 나눔  — ACTIVE, 익명, 운영자 미참여, 3회차
    //   Space D: 봄날의 시 읽기        — ARCHIVED, 2회차 완료
    // Sentinel: 서연 user row (e1000001-0000-4000-e000-000000000001)
    // -----------------------------------------------------------------------
    const { rows: sentinelV8 } = await client.query(`
      SELECT id FROM users
      WHERE id = 'e1000001-0000-4000-e000-000000000001'
      LIMIT 1
    `);
    if (sentinelV8.length > 0) {
      logger.info("Dev seed data already present (v8), skipping");
    } else {
      logger.info("Inserting dev seed data (v8)…");

      // v8-0. 가상 사용자 5명
      await client.query(`
        INSERT INTO users (id, email, nickname, created_at, updated_at)
        VALUES
          ('e1000001-0000-4000-e000-000000000001', 'seoyeon@test.dev', '서연', NOW(), NOW()),
          ('e1000002-0000-4000-e000-000000000002', 'jiho@test.dev',    '지호', NOW(), NOW()),
          ('e1000003-0000-4000-e000-000000000003', 'sua@test.dev',     '수아', NOW(), NOW()),
          ('e1000004-0000-4000-e000-000000000004', 'taeyun@test.dev',  '태윤', NOW(), NOW()),
          ('e1000005-0000-4000-e000-000000000005', 'yerin@test.dev',   '예린', NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname
      `);

      // v8-1. 공간 4개 (민지 = 92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f)
      await client.query(`
        INSERT INTO spaces
          (id, name, description, is_anonymous, planned_starts_at, started_at,
           schedule_type, weekdays, operator_participates, round_count,
           max_participants, default_center_interval, default_center_count,
           status, creator_id, invite_code, created_at, updated_at)
        VALUES
          -- A: 파친코 읽기 모임 (RECRUITING, N_DAY, 예정일 미경과)
          ('f1000001-0000-4000-f000-000000000001',
            '파친코 읽기 모임',
            '이민진의 파친코를 함께 읽고 이야기 나누는 모임입니다.',
            FALSE,
            NOW() + interval '7 days',
            NULL,
            'N_DAY', NULL, TRUE, 4, 5, 7, 1,
            'RECRUITING',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'PACHINK01',
            NOW() - interval '3 days', NOW()),

          -- B: 82년생 김지영 독서 클럽 (RECRUITING, WEEKDAY 화·목, 예정일 경과)
          ('f1000002-0000-4000-f000-000000000002',
            '82년생 김지영 독서 클럽',
            '조남주의 82년생 김지영을 함께 읽는 독서 클럽입니다.',
            FALSE,
            NOW() - interval '3 days',
            NULL,
            'WEEKDAY', '[2,4]'::jsonb, TRUE, 3, 4, 7, 1,
            'RECRUITING',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'KIMJIY02',
            NOW() - interval '10 days', NOW()),

          -- C: 채식주의자 이야기 나눔 (ACTIVE, 익명, 운영자 미참여)
          ('f1000003-0000-4000-f000-000000000003',
            '채식주의자 이야기 나눔',
            '한강의 채식주의자를 읽고 서로의 이야기를 나누는 공간입니다.',
            TRUE,
            NULL,
            NOW() - interval '14 days',
            'N_DAY', NULL, FALSE, 3, NULL, 7, 1,
            'ACTIVE',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            NULL,
            NOW() - interval '21 days', NOW()),

          -- D: 봄날의 시 읽기 (ARCHIVED, 2회차 완료)
          ('f1000004-0000-4000-f000-000000000004',
            '봄날의 시 읽기',
            '봄날에 어울리는 시를 함께 읽고 감상을 나눴던 모임입니다.',
            FALSE,
            NULL,
            NOW() - interval '60 days',
            'N_DAY', NULL, TRUE, 2, NULL, 7, 1,
            'ARCHIVED',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            NULL,
            NOW() - interval '70 days', NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      // v8-2. 회차 (space_rounds)

      // Space A: 4회차 모두 UPCOMING
      await client.query(`
        INSERT INTO space_rounds
          (id, space_id, round_number, title, description, status,
           starts_at, ends_at, created_at, updated_at)
        VALUES
          ('fa000001-0000-4000-f000-000000000001', 'f1000001-0000-4000-f000-000000000001', 1, '1회차', NULL, 'UPCOMING', NULL, NULL, NOW(), NOW()),
          ('fa000002-0000-4000-f000-000000000002', 'f1000001-0000-4000-f000-000000000001', 2, '2회차', NULL, 'UPCOMING', NULL, NULL, NOW(), NOW()),
          ('fa000003-0000-4000-f000-000000000003', 'f1000001-0000-4000-f000-000000000001', 3, '3회차', NULL, 'UPCOMING', NULL, NULL, NOW(), NOW()),
          ('fa000004-0000-4000-f000-000000000004', 'f1000001-0000-4000-f000-000000000001', 4, '4회차', NULL, 'UPCOMING', NULL, NULL, NOW(), NOW())
        ON CONFLICT ON CONSTRAINT space_rounds_space_round_unique DO NOTHING
      `);

      // Space B: 3회차 모두 UPCOMING
      await client.query(`
        INSERT INTO space_rounds
          (id, space_id, round_number, title, description, status,
           starts_at, ends_at, created_at, updated_at)
        VALUES
          ('fb000001-0000-4000-f000-000000000001', 'f1000002-0000-4000-f000-000000000002', 1, '1회차', NULL, 'UPCOMING', NULL, NULL, NOW(), NOW()),
          ('fb000002-0000-4000-f000-000000000002', 'f1000002-0000-4000-f000-000000000002', 2, '2회차', NULL, 'UPCOMING', NULL, NULL, NOW(), NOW()),
          ('fb000003-0000-4000-f000-000000000003', 'f1000002-0000-4000-f000-000000000002', 3, '3회차', NULL, 'UPCOMING', NULL, NULL, NOW(), NOW())
        ON CONFLICT ON CONSTRAINT space_rounds_space_round_unique DO NOTHING
      `);

      // Space C: 1회차 ACTIVE, 2·3회차 UPCOMING
      await client.query(`
        INSERT INTO space_rounds
          (id, space_id, round_number, title, description, status,
           starts_at, ends_at, created_at, updated_at)
        VALUES
          ('fc000001-0000-4000-f000-000000000001', 'f1000003-0000-4000-f000-000000000003', 1, '1회차', NULL, 'ACTIVE',
            NOW() - interval '14 days', NULL, NOW() - interval '14 days', NOW()),
          ('fc000002-0000-4000-f000-000000000002', 'f1000003-0000-4000-f000-000000000003', 2, '2회차', NULL, 'UPCOMING', NULL, NULL, NOW(), NOW()),
          ('fc000003-0000-4000-f000-000000000003', 'f1000003-0000-4000-f000-000000000003', 3, '3회차', NULL, 'UPCOMING', NULL, NULL, NOW(), NOW())
        ON CONFLICT ON CONSTRAINT space_rounds_space_round_unique DO NOTHING
      `);

      // Space D: 2회차 모두 COMPLETED
      await client.query(`
        INSERT INTO space_rounds
          (id, space_id, round_number, title, description, status,
           starts_at, ends_at, created_at, updated_at)
        VALUES
          ('fd000001-0000-4000-f000-000000000001', 'f1000004-0000-4000-f000-000000000004', 1, '1회차', NULL, 'COMPLETED',
            NOW() - interval '56 days', NOW() - interval '49 days',
            NOW() - interval '60 days', NOW()),
          ('fd000002-0000-4000-f000-000000000002', 'f1000004-0000-4000-f000-000000000004', 2, '2회차', NULL, 'COMPLETED',
            NOW() - interval '49 days', NOW() - interval '42 days',
            NOW() - interval '60 days', NOW())
        ON CONFLICT ON CONSTRAINT space_rounds_space_round_unique DO NOTHING
      `);

      // v8-3. 코드 신청 — 태윤 → 공간 A (PENDING)
      await client.query(`
        INSERT INTO space_code_requests
          (id, space_id, requester_id, code, status, rejection_reason, created_at, updated_at)
        VALUES
          ('ce000001-0000-4000-c000-000000000001',
            'f1000001-0000-4000-f000-000000000001',
            'e1000004-0000-4000-e000-000000000004',
            'PACHINK01', 'PENDING', NULL, NOW() - interval '1 day', NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      // v8-4. 공간 참여 (space_participations)

      // Space A: 민지(운영자), 서연·지호·수아(APPROVED), 태윤(CODE PENDING)
      await client.query(`
        INSERT INTO space_participations
          (id, space_id, user_id, role, join_path, status,
           invitation_id, code_request_id, created_at, updated_at)
        VALUES
          (gen_random_uuid(), 'f1000001-0000-4000-f000-000000000001',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'OPERATOR', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '3 days', NOW()),
          (gen_random_uuid(), 'f1000001-0000-4000-f000-000000000001',
            'e1000001-0000-4000-e000-000000000001',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '2 days', NOW()),
          (gen_random_uuid(), 'f1000001-0000-4000-f000-000000000001',
            'e1000002-0000-4000-e000-000000000002',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '2 days', NOW()),
          (gen_random_uuid(), 'f1000001-0000-4000-f000-000000000001',
            'e1000003-0000-4000-e000-000000000003',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '2 days', NOW()),
          (gen_random_uuid(), 'f1000001-0000-4000-f000-000000000001',
            'e1000004-0000-4000-e000-000000000004',
            'PARTICIPANT', 'CODE', 'PENDING', NULL,
            'ce000001-0000-4000-c000-000000000001',
            NOW() - interval '1 day', NOW())
        ON CONFLICT ON CONSTRAINT space_participations_space_user_unique DO NOTHING
      `);

      // Space B: 민지(운영자), 서연·지호(APPROVED)
      await client.query(`
        INSERT INTO space_participations
          (id, space_id, user_id, role, join_path, status,
           invitation_id, code_request_id, created_at, updated_at)
        VALUES
          (gen_random_uuid(), 'f1000002-0000-4000-f000-000000000002',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'OPERATOR', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '10 days', NOW()),
          (gen_random_uuid(), 'f1000002-0000-4000-f000-000000000002',
            'e1000001-0000-4000-e000-000000000001',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '9 days', NOW()),
          (gen_random_uuid(), 'f1000002-0000-4000-f000-000000000002',
            'e1000002-0000-4000-e000-000000000002',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '9 days', NOW())
        ON CONFLICT ON CONSTRAINT space_participations_space_user_unique DO NOTHING
      `);

      // Space C: 서연·태윤·예린(APPROVED), 민지는 operatorParticipates=false 이므로 미등록
      await client.query(`
        INSERT INTO space_participations
          (id, space_id, user_id, role, join_path, status,
           invitation_id, code_request_id, created_at, updated_at)
        VALUES
          (gen_random_uuid(), 'f1000003-0000-4000-f000-000000000003',
            'e1000001-0000-4000-e000-000000000001',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '21 days', NOW()),
          (gen_random_uuid(), 'f1000003-0000-4000-f000-000000000003',
            'e1000004-0000-4000-e000-000000000004',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '21 days', NOW()),
          (gen_random_uuid(), 'f1000003-0000-4000-f000-000000000003',
            'e1000005-0000-4000-e000-000000000005',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '21 days', NOW())
        ON CONFLICT ON CONSTRAINT space_participations_space_user_unique DO NOTHING
      `);

      // Space D: 민지(운영자), 지호·수아(APPROVED)
      await client.query(`
        INSERT INTO space_participations
          (id, space_id, user_id, role, join_path, status,
           invitation_id, code_request_id, created_at, updated_at)
        VALUES
          (gen_random_uuid(), 'f1000004-0000-4000-f000-000000000004',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'OPERATOR', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '70 days', NOW()),
          (gen_random_uuid(), 'f1000004-0000-4000-f000-000000000004',
            'e1000002-0000-4000-e000-000000000002',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '68 days', NOW()),
          (gen_random_uuid(), 'f1000004-0000-4000-f000-000000000004',
            'e1000003-0000-4000-e000-000000000003',
            'PARTICIPANT', NULL, 'APPROVED', NULL, NULL,
            NOW() - interval '68 days', NOW())
        ON CONFLICT ON CONSTRAINT space_participations_space_user_unique DO NOTHING
      `);

      // v8-5. 공간 C 1회차 편지 (articles + space_letters)
      //   여는 편지: 운영자(민지)가 익명으로 작성 — authorId=민지지만 isAnonymous 공간이므로 UI상 숨김
      //   중심 편지: 서연이 작성
      await client.query(`
        INSERT INTO articles
          (id, author_id, title, content, status, pages, style, cover,
           source_article_id, is_notice, notice_date, created_at, updated_at)
        VALUES
          ('a3000001-0000-4000-a000-000000000001',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            '1회차를 시작하며',
            '안녕하세요. 채식주의자 이야기 나눔의 첫 회차를 시작합니다. 한강 작가의 이 작품을 읽으며 어떤 생각이 드셨나요? 자유롭게 써주세요.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            NOW() - interval '14 days', NOW() - interval '14 days'),
          ('a3000002-0000-4000-a000-000000000002',
            'e1000001-0000-4000-e000-000000000001',
            '채식주의자를 읽고',
            '처음엔 낯설었는데, 읽다 보니 영혜의 선택이 이해되는 것 같기도 했어요. 몸으로 저항한다는 게 어떤 의미일까 한참 생각했습니다.',
            'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
            NOW() - interval '10 days', NOW() - interval '10 days')
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          updated_at = EXCLUDED.updated_at
      `);

      await client.query(`
        INSERT INTO space_letters
          (id, space_id, space_round_id, author_id, source_article_id,
           letter_type, is_public, created_at, updated_at)
        VALUES
          ('cf000001-0000-4000-c000-000000000001',
            'f1000003-0000-4000-f000-000000000003',
            'fc000001-0000-4000-f000-000000000001',
            '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
            'a3000001-0000-4000-a000-000000000001',
            'OPENING', TRUE,
            NOW() - interval '14 days', NOW() - interval '14 days'),
          ('cf000002-0000-4000-c000-000000000002',
            'f1000003-0000-4000-f000-000000000003',
            'fc000001-0000-4000-f000-000000000001',
            'e1000001-0000-4000-e000-000000000001',
            'a3000002-0000-4000-a000-000000000002',
            'CENTER', FALSE,
            NOW() - interval '10 days', NOW() - interval '10 days')
        ON CONFLICT (id) DO NOTHING
      `);

      logger.info("Dev seed data (v8) inserted successfully");
    }

    // -----------------------------------------------------------------------
    // v9 sentinel: 공룡 운영 공간 — 5명 참여자·4회차·공유 편지 10편
    //
    // The operator account is deliberately resolved by email instead of being
    // created here. This seed must never create or modify Supabase Auth users.
    // The four other members are existing development users from earlier seed
    // blocks; their existing UUIDs are resolved in the same way.
    // -----------------------------------------------------------------------
    const dinosaurOperatorResult = await client.query<{ id: string; nickname: string }>(
      `SELECT id, nickname FROM users WHERE email = $1 LIMIT 1`,
      ["thomthiswld@naver.com"],
    );
    if (dinosaurOperatorResult.rows.length === 0) {
      throw new Error(
        "[seed] Dinosaur operator account thomthiswld@naver.com was not found in users. " +
        "Seed stopped without creating an Auth account.",
      );
    }
    const dinosaurOperatorId = dinosaurOperatorResult.rows[0].id;

    const dinosaurParticipantEmails = [
      "hayun@test.dev",
      "seojun@test.dev",
      "minji@test.dev",
      "eunseo@test.dev",
    ];
    const dinosaurParticipantsResult = await client.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE email = ANY($1::text[])`,
      [dinosaurParticipantEmails],
    );
    const dinosaurParticipantsByEmail = new Map(
      dinosaurParticipantsResult.rows.map((user) => [user.email, user.id]),
    );
    const missingDinosaurParticipants = dinosaurParticipantEmails.filter(
      (email) => !dinosaurParticipantsByEmail.has(email),
    );
    if (missingDinosaurParticipants.length > 0) {
      throw new Error(
        `[seed] Required existing development users were not found: ${missingDinosaurParticipants.join(", ")}. ` +
        "Seed stopped without creating Auth accounts.",
      );
    }

    const dinosaurSpaceId = "f9000001-0000-4000-f000-000000000001";
    const dinosaurSentinelLetterId = "c4000001-0000-4000-c000-000000000000";
    const dinosaurSpaceName = "공룡과 함께 쓰는 편지 공간";
    const dinosaurSpaceResult = await client.query<{ creator_id: string; name: string }>(
      `SELECT creator_id, name FROM spaces WHERE id = $1 LIMIT 1`,
      [dinosaurSpaceId],
    );
    if (
      dinosaurSpaceResult.rows.length > 0 &&
      (dinosaurSpaceResult.rows[0].creator_id !== dinosaurOperatorId ||
        dinosaurSpaceResult.rows[0].name !== dinosaurSpaceName)
    ) {
      throw new Error(
        `[seed] Fixed dinosaur space id ${dinosaurSpaceId} is already owned by different data. ` +
        "Seed stopped without modifying the existing space.",
      );
    }

    const dinosaurSentinelResult = await client.query(
      `SELECT id FROM space_letters WHERE id = $1 AND space_id = $2 LIMIT 1`,
      [dinosaurSentinelLetterId, dinosaurSpaceId],
    );
    if (dinosaurSentinelResult.rows.length > 0) {
      logger.info("Dev seed data already present (v9 dinosaur space), skipping");
    } else {
      logger.info("Inserting dev seed data (v9 dinosaur space)…");
      await client.query("BEGIN");
      try {
        // v9-1. Active space owned by the existing operator account.
        await client.query(
          `INSERT INTO spaces
             (id, name, description, is_anonymous, planned_starts_at, started_at,
              schedule_type, weekdays, operator_participates, round_count,
              max_participants, default_center_interval, default_center_count,
              status, creator_id, invite_code, created_at, updated_at)
           VALUES
             ($1, $2,
              '공룡과 기존 개발 사용자들이 함께 편지를 나누는 공간입니다.',
              FALSE, NULL, NOW() - interval '1 day',
              'N_DAY', NULL, TRUE, 4,
              4, 7, 1,
              'ACTIVE', $3, 'DINOQA1577', NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [dinosaurSpaceId, dinosaurSpaceName, dinosaurOperatorId],
        );

        // v9-2. Four rounds. Dates keep round 1 active and later rounds
        // upcoming for the current QA window; status is also stored explicitly
        // because rounds without dates must preserve their status.
        const dinosaurRoundDefinitions = [
          {
            id: "fa900001-0000-4000-f000-000000000001",
            number: 1,
            title: "1회차",
            status: "ACTIVE",
            startsAt: "NOW() - interval '1 day'",
            endsAt: "NOW() + interval '30 days'",
          },
          {
            id: "fa900002-0000-4000-f000-000000000002",
            number: 2,
            title: "2회차",
            status: "UPCOMING",
            startsAt: "NOW() + interval '31 days'",
            endsAt: "NOW() + interval '60 days'",
          },
          {
            id: "fa900003-0000-4000-f000-000000000003",
            number: 3,
            title: "3회차",
            status: "UPCOMING",
            startsAt: "NOW() + interval '61 days'",
            endsAt: "NOW() + interval '90 days'",
          },
          {
            id: "fa900004-0000-4000-f000-000000000004",
            number: 4,
            title: "4회차",
            status: "UPCOMING",
            startsAt: "NOW() + interval '91 days'",
            endsAt: "NOW() + interval '120 days'",
          },
        ] as const;
        const dinosaurRounds = new Map<number, string>();
        for (const round of dinosaurRoundDefinitions) {
          const roundResult = await client.query<{ id: string }>(
            `INSERT INTO space_rounds
               (id, space_id, round_number, title, description, status,
                starts_at, ends_at, created_at, updated_at)
             VALUES
               ($1, $2, $3, $4, NULL, $5,
                ${round.startsAt}, ${round.endsAt}, NOW(), NOW())
             ON CONFLICT (space_id, round_number) DO UPDATE SET
               title = EXCLUDED.title,
               status = EXCLUDED.status,
               starts_at = EXCLUDED.starts_at,
               ends_at = EXCLUDED.ends_at,
               updated_at = NOW()
             RETURNING id`,
            [round.id, dinosaurSpaceId, round.number, round.title, round.status],
          );
          dinosaurRounds.set(round.number, roundResult.rows[0].id);
        }

        // v9-3. Exactly five approved members: the operator plus four
        // previously existing development accounts.
        const dinosaurMemberIds = [
          dinosaurOperatorId,
          ...dinosaurParticipantEmails.map((email) => dinosaurParticipantsByEmail.get(email)!),
        ];
        for (const [index, userId] of dinosaurMemberIds.entries()) {
          await client.query(
            `INSERT INTO space_participations
               (id, space_id, user_id, role, join_path, status,
                invitation_id, code_request_id, created_at, updated_at)
             VALUES
               (gen_random_uuid(), $1, $2, $3, NULL, 'APPROVED', NULL, NULL, NOW(), NOW())
             ON CONFLICT (space_id, user_id) DO UPDATE SET
               role = EXCLUDED.role,
               join_path = NULL,
               status = 'APPROVED',
               invitation_id = NULL,
               code_request_id = NULL,
               updated_at = NOW()`,
            [dinosaurSpaceId, userId, index === 0 ? "OPERATOR" : "PARTICIPANT"],
          );
        }

        // v9-4. Ten already-shared letters in active round 1. The article
        // authors intentionally rotate across all five members.
        const dinosaurAuthorIds = [
          dinosaurOperatorId,
          ...dinosaurParticipantEmails.map((email) => dinosaurParticipantsByEmail.get(email)!),
        ];
        const dinosaurArticles = [
          ["a4000001-0000-4000-a000-000000000001", "첫 번째 편지", "오늘은 이 공간에서 처음 인사를 남깁니다. 서로의 하루를 천천히 나눌 수 있어 기대돼요."],
          ["a4000002-0000-4000-a000-000000000002", "요즘의 작은 기쁨", "아침에 마신 따뜻한 차 한 잔처럼 사소하지만 분명한 기쁨들을 모아 적어봅니다."],
          ["a4000003-0000-4000-a000-000000000003", "비 오는 날의 기록", "창문에 맺힌 빗방울을 바라보다가 잠시 멈춰 서는 시간이 좋았습니다."],
          ["a4000004-0000-4000-a000-000000000004", "이번 주에 배운 것", "서두르지 않아도 괜찮다는 것을 이번 주에 다시 배웠습니다. 각자의 속도를 응원해요."],
          ["a4000005-0000-4000-a000-000000000005", "오래된 사진 한 장", "서랍 속 사진을 꺼내 보니 지나간 계절의 표정들이 선명하게 떠올랐습니다."],
          ["a4000006-0000-4000-a000-000000000006", "주말 산책", "집 근처 길을 오래 걸었습니다. 익숙한 풍경도 천천히 보면 새롭게 보이네요."],
          ["a4000007-0000-4000-a000-000000000007", "다음 계절을 기다리며", "아직 오지 않은 계절을 생각하며 하고 싶은 일들을 하나씩 적어두었습니다."],
          ["a4000008-0000-4000-a000-000000000008", "오늘의 고마운 일", "바쁜 하루 중에도 안부를 물어준 사람이 있어 고마웠습니다."],
          ["a4000009-0000-4000-a000-000000000009", "천천히 쓰는 마음", "잘 쓰려고 애쓰기보다 지금 떠오른 마음을 솔직하게 남겨봅니다."],
          ["a4000010-0000-4000-a000-000000000010", "첫 회차를 마무리하며", "첫 회차에 함께 편지를 나눌 수 있어 좋았습니다. 다음 이야기도 기대할게요."],
        ] as const;
        for (const [index, [articleId, title, content]] of dinosaurArticles.entries()) {
          const authorId = dinosaurAuthorIds[index % dinosaurAuthorIds.length];
          await client.query(
            `INSERT INTO articles
               (id, author_id, title, content, status, pages, style, cover,
                source_article_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'LETTER', '[]'::jsonb, NULL, NULL, NULL, NOW(), NOW())
             ON CONFLICT (id) DO UPDATE SET
               author_id = EXCLUDED.author_id,
               title = EXCLUDED.title,
               content = EXCLUDED.content,
               status = EXCLUDED.status,
               pages = EXCLUDED.pages,
               style = EXCLUDED.style,
               cover = EXCLUDED.cover,
               source_article_id = EXCLUDED.source_article_id,
               updated_at = NOW()`,
            [articleId, authorId, title, content],
          );

          const letterId = `c400${String(index + 1).padStart(4, "0")}-0000-4000-c000-000000000000`;
          await client.query(
            `INSERT INTO space_letters
               (id, space_id, space_round_id, author_id, source_article_id,
                letter_type, is_public, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
             ON CONFLICT (id) DO UPDATE SET
               space_id = EXCLUDED.space_id,
               space_round_id = EXCLUDED.space_round_id,
               author_id = EXCLUDED.author_id,
               source_article_id = EXCLUDED.source_article_id,
               letter_type = EXCLUDED.letter_type,
               is_public = TRUE,
               updated_at = NOW()`,
            [
              letterId,
              dinosaurSpaceId,
              dinosaurRounds.get(1),
              authorId,
              articleId,
              index === 0 ? "OPENING" : "CENTER",
            ],
          );
        }

        await client.query("COMMIT");
        logger.info("Dev seed data (v9 dinosaur space) inserted successfully");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } catch (err) {
    logger.error({ err }, "Seed data error");
    throw err;
  } finally {
    client.release();
  }
}
