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
 * Does nothing in production (NODE_ENV=production).
 */
export async function seedDevData(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  const client = await pool.connect();
  try {
    // -----------------------------------------------------------------------
    // Always-run cleanup: remove the old 민지 placeholder user (00000000-...)
    // from all team collection memberships.  Safe to run multiple times.
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
    if (sentinel.length > 0) {
      logger.info("Dev seed data already present (v2), skipping");
      return;
    }

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
    //    Delivery slot logic (KST):
    //      addedAt before 06:00 KST → 06:00 KST same day (UTC: previous day 21:00)
    //      addedAt 06:00–18:00 KST  → 18:00 KST same day (UTC: same day 09:00)
    //      addedAt 18:00+ KST       → 06:00 KST next day (UTC: same day 21:00)
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
        -- a1000001 (하윤 notice, addedAt 2026-04-26T21:00Z = KST 06:00 → slot KST 18:00 = UTC 09:00)
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000001-0000-4000-a000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-27 09:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000001-0000-4000-a000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-27 09:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 하윤
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000001-0000-4000-a000-000000000001',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-27 09:00:00+00', FALSE, NOW()),

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

        -- a1000003 (서준, addedAt 2026-04-25T21:00Z = KST 06:00 → slot KST 18:00 = UTC 09:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000003-0000-4000-a000-000000000003',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-26 09:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000003-0000-4000-a000-000000000003',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-26 09:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 서준
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000003-0000-4000-a000-000000000003',
          '05cb0a0b-c73c-4d1c-8410-cee7da564fda', '2026-04-26 09:00:00+00', FALSE, NOW()),

        -- a1000004 (민지, addedAt 2026-04-25T22:00Z = KST 07:00 → slot KST 18:00 = UTC 09:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000004-0000-4000-a000-000000000004',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-26 09:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000004-0000-4000-a000-000000000004',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-26 09:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 민지
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000004-0000-4000-a000-000000000004',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-26 09:00:00+00', FALSE, NOW()),

        -- a1000005 (하윤, addedAt 2026-04-25T23:00Z = KST 08:00 → slot KST 18:00 = UTC 09:00)
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000005-0000-4000-a000-000000000005',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-26 09:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000005-0000-4000-a000-000000000005',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-26 09:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 하윤
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000005-0000-4000-a000-000000000005',
          '54cbadb0-eab9-4f69-8c32-90a9e00d7908', '2026-04-26 09:00:00+00', FALSE, NOW()),

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

        -- a1000008 (민지, addedAt 2026-04-24T21:00Z = KST 06:00 → slot KST 18:00 = UTC 09:00)
        (gen_random_uuid(), '54cbadb0-eab9-4f69-8c32-90a9e00d7908',
          'a1000008-0000-4000-a000-000000000008',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-25 09:00:00+00', FALSE, NOW()),
        (gen_random_uuid(), '05cb0a0b-c73c-4d1c-8410-cee7da564fda',
          'a1000008-0000-4000-a000-000000000008',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-25 09:00:00+00', FALSE, NOW()),
        -- self-inbox for sender 민지
        (gen_random_uuid(), '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f',
          'a1000008-0000-4000-a000-000000000008',
          '92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f', '2026-04-25 09:00:00+00', FALSE, NOW()),

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
  } catch (err) {
    logger.error({ err }, "Seed data error");
    throw err;
  } finally {
    client.release();
  }
}
