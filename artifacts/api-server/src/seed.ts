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
         source_article_id, is_notice, notice_date, created_at, updated_at)
      VALUES
        ('a1000001-0000-4000-a000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          '4월 27일 인사드립니다', '안녕하세요, 모임 여러분. 4월 27일부터 새로운 기능이 추가되었습니다. 많은 이용 부탁드립니다.',
          'LETTER', '[]', NULL, NULL, NULL, TRUE, '2026-04-27',
          '2026-04-26 21:00:00+00', '2026-04-26 21:00:00+00'),
        ('a1000002-0000-4000-a000-000000000002',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '방금 쓴 따끈한 글', '글을 쓰고 싶은 마음이 들 때 바로 써야 한다. 나중에 쓰려 하면 그 느낌이 사라져 버린다.',
          'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
          '2026-04-27 10:02:31+00', '2026-04-27 10:02:31+00'),
        ('a1000003-0000-4000-a000-000000000003',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '봄날의 단상', '오늘은 따뜻한 봄날이었다. 창문 너머로 벚꽃이 흩날렸고, 잠시 멍하니 바라보다 이 글을 쓴다.',
          'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
          '2026-04-25 21:00:00+00', '2026-04-25 21:00:00+00'),
        ('a1000004-0000-4000-a000-000000000004',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          '봄날의 단상 - 답장', '봄날의 단상 잘 읽었어요. 저도 오늘 공원을 산책했는데 같은 기분이었어요. 봄은 참 짧게 지나가는 것 같아요.',
          'LETTER', '[]', NULL, NULL,
          'a1000003-0000-4000-a000-000000000003', FALSE, NULL,
          '2026-04-25 22:00:00+00', '2026-04-25 22:00:00+00'),
        ('a1000005-0000-4000-a000-000000000005',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          '봄날의 단상 - 재답장', '맞아요, 봄은 정말 순식간에 가버려요. 그래서 더 소중한 것 같기도 하고요. 올여름도 잘 보내봐요.',
          'LETTER', '[]', NULL, NULL,
          'a1000004-0000-4000-a000-000000000004', FALSE, NULL,
          '2026-04-25 23:00:00+00', '2026-04-25 23:00:00+00'),
        ('a1000006-0000-4000-a000-000000000006',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          '삭제된 원글', '이 글은 이미 삭제된 글입니다.',
          'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
          '2026-04-26 09:00:00+00', '2026-04-26 09:00:00+00'),
        ('a1000007-0000-4000-a000-000000000007',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '삭제된 글에 대한 답장', '원글을 읽고 짧게 답장을 남깁니다. 좋은 글이었어요.',
          'LETTER', '[]', NULL, NULL,
          'a1000006-0000-4000-a000-000000000006', FALSE, NULL,
          '2026-04-26 10:00:00+00', '2026-04-26 10:00:00+00'),
        ('a1000008-0000-4000-a000-000000000008',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          '독립 글', '혼자 쓰는 글도 좋다. 누군가에게 보내지 않아도, 쓰는 행위 자체가 위로가 된다.',
          'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
          '2026-04-24 21:00:00+00', '2026-04-24 21:00:00+00'),
        ('a0000001-0000-4000-a000-000000000001',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          '서준이네 모임 전용 글', '서준이네 모임 여러분, 다음 모임은 다음 주 토요일로 잠정 결정했어요. 참석 여부 알려주세요.',
          'LETTER', '[]', NULL, NULL, NULL, FALSE, NULL,
          '2026-04-23 09:00:00+00', '2026-04-23 09:00:00+00'),
        ('a1000009-0000-4000-a000-000000000009',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          '다른 모음 글에 대한 답장', '토요일 모임 참석할게요. 장소는 어디로 할까요?',
          'LETTER', '[]', NULL, NULL,
          'a0000001-0000-4000-a000-000000000001', FALSE, NULL,
          '2026-04-23 11:00:00+00', '2026-04-23 11:00:00+00')
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
  } catch (err) {
    logger.error({ err }, "Seed data error");
    throw err;
  } finally {
    client.release();
  }
}
