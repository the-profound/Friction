import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY required");
  process.exit(1);
}

const PASSWORD = "00000000";

const TEST_ACCOUNTS = [
  { key: "minji",  email: "minji@test.com",  nickname: "민지" },
  { key: "hayun",  email: "hayun@test.com",  nickname: "하윤" },
  { key: "seojun", email: "seojun@test.com", nickname: "서준" },
  { key: "jia",    email: "jia@test.com",    nickname: "지아" },
  { key: "doyun",  email: "doyun@test.com",  nickname: "도윤" },
] as const;

type AccountKey = typeof TEST_ACCOUNTS[number]["key"];
type Ids = Record<AccountKey, string>;

interface SupabaseAuthResponse {
  user?: { id?: string };
  msg?: string;
  error?: string;
  error_description?: string;
}

async function readJson(res: Response): Promise<SupabaseAuthResponse> {
  try {
    return (await res.json()) as SupabaseAuthResponse;
  } catch {
    return {};
  }
}

async function ensureSupabaseUser(email: string, password: string): Promise<string> {
  const signup = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const signupJson = await readJson(signup);

  if (signup.ok && signupJson.user?.id) {
    console.log(`  ✓ signup ok: ${email} → ${signupJson.user.id}`);
    return signupJson.user.id;
  }

  const msg = (signupJson.msg ?? signupJson.error_description ?? signupJson.error ?? "").toLowerCase();
  const alreadyExists =
    signup.status === 422 ||
    signup.status === 400 ||
    msg.includes("registered") ||
    msg.includes("already") ||
    msg.includes("exist");

  if (!alreadyExists) {
    throw new Error(`signup failed for ${email}: ${signup.status} ${JSON.stringify(signupJson)}`);
  }

  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const tokenJson = await readJson(tokenRes);

  if (!tokenRes.ok || !tokenJson.user?.id) {
    throw new Error(
      `signin fallback failed for ${email}: ${tokenRes.status} ${JSON.stringify(tokenJson)}.\n` +
      `이미 등록된 계정의 비밀번호가 '${PASSWORD}'가 아닐 수 있습니다. Supabase 대시보드에서 비밀번호를 재설정하거나 사용자를 삭제 후 재실행하세요.`
    );
  }

  console.log(`  ↻ existing: ${email} → ${tokenJson.user.id}`);
  return tokenJson.user.id;
}

async function ensureAllAuthAccounts(): Promise<Ids> {
  console.log("🔐 Ensuring Supabase Auth accounts...");
  const ids = {} as Ids;
  for (const acc of TEST_ACCOUNTS) {
    ids[acc.key] = await ensureSupabaseUser(acc.email, PASSWORD);
  }
  return ids;
}

async function upsertUsersTable(ids: Ids) {
  console.log("👤 Upserting users table rows...");
  await db.transaction(async (tx) => {
    for (const acc of TEST_ACCOUNTS) {
      // 동일 이메일에 다른 id가 잔존할 경우(레거시 데이터) 먼저 정리해 unique 충돌을 방지한다.
      await tx.execute(sql`
        DELETE FROM users WHERE email = ${acc.email} AND id <> ${ids[acc.key]}::uuid
      `);
      await tx.execute(sql`
        INSERT INTO users (id, email, nickname)
        VALUES (${ids[acc.key]}::uuid, ${acc.email}, ${acc.nickname})
        ON CONFLICT (id) DO UPDATE
          SET email = EXCLUDED.email,
              nickname = EXCLUDED.nickname
      `);
    }
  });
}

interface CountRow extends Record<string, unknown> {
  minji_articles: number;
  minji_inbox: number;
  minji_neighbors: number;
  minji_pending: number;
  minji_collections: number;
  minji_archive_items: number;
  minji_team_members: number;
}

async function printPostSeedSummary(ids: Ids) {
  console.log("\n🔍 Post-seed counts for minji:");
  const res = await db.execute<CountRow>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM articles WHERE author_id = ${ids.minji}::uuid) AS minji_articles,
      (SELECT COUNT(*)::int FROM inbox WHERE recipient_id = ${ids.minji}::uuid) AS minji_inbox,
      (SELECT COUNT(*)::int FROM neighbors WHERE user_a_id = ${ids.minji}::uuid OR user_b_id = ${ids.minji}::uuid) AS minji_neighbors,
      (SELECT COUNT(*)::int FROM neighbor_requests WHERE recipient_id = ${ids.minji}::uuid) AS minji_pending,
      (SELECT COUNT(*)::int FROM my_collections WHERE owner_id = ${ids.minji}::uuid) AS minji_collections,
      (SELECT COUNT(*)::int FROM my_collection_articles mca
         JOIN my_collections mc ON mc.id = mca.my_collection_id
         WHERE mc.owner_id = ${ids.minji}::uuid AND mc.is_archive = true) AS minji_archive_items,
      (SELECT COUNT(*)::int FROM team_collection_memberships tcm
         JOIN team_collections tc ON tc.id = tcm.team_collection_id
         WHERE tc.creator_id = ${ids.minji}::uuid) AS minji_team_members
  `);
  const row = (res.rows ?? [])[0];
  if (row) console.log("  ", row);
}

async function seedRelationalData(ids: Ids) {
  console.log("🌱 Inserting seed data (idempotent)...");
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000);

  type ArticleCover =
    | { type: "color"; bgColor: string; textColor: string; align: "left" | "center" | "right" }
    | { type: "image"; imageUrl: string; textColor: string; align: "left" | "center" | "right" }
    | { type: "default"; textColor: string; align: "left" | "center" | "right" };

  type ArticleStatus = "DRAFT" | "DIVIDING" | "CLOSING" | "LETTER";

  interface ArticleRow {
    author: string;
    title: string;
    content: string;
    status: ArticleStatus;
    cover?: ArticleCover;
    letterAt?: Date | null;
  }

  type IdRow = { id: string } & Record<string, unknown>;

  const firstId = (result: { rows?: IdRow[] } | IdRow[]): string => {
    const rows = Array.isArray(result) ? result : (result.rows ?? []);
    const row = rows[0];
    if (!row) throw new Error("expected at least one row from RETURNING/SELECT");
    return row.id;
  };

  await db.transaction(async (tx) => {
    // ── neighbors (pair-normalized: userA < userB) ──
    const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
    const [a1, b1] = pair(ids.minji, ids.hayun);
    const [a2, b2] = pair(ids.minji, ids.seojun);
    await tx.execute(sql`
      INSERT INTO neighbors (user_a_id, user_b_id)
      VALUES (${a1}::uuid, ${b1}::uuid), (${a2}::uuid, ${b2}::uuid)
      ON CONFLICT ON CONSTRAINT neighbors_pair_unique DO NOTHING
    `);

    // ── neighbor_requests (jia → minji) ──
    await tx.execute(sql`
      INSERT INTO neighbor_requests (requester_id, recipient_id, status)
      VALUES (${ids.jia}::uuid, ${ids.minji}::uuid, 'PENDING')
      ON CONFLICT ON CONSTRAINT neighbor_requests_unique DO NOTHING
    `);

    const minjiArticles: ArticleRow[] = [
      {
        author: ids.minji,
        title: "오늘 아침의 단상",
        content:
          "커피 한 잔을 마시며 창밖을 바라보았다. 봄이 오고 있었다. 나뭇가지 끝에 연둣빛 새순이 돋아나고 있었고, 그 모습이 어쩐지 마음을 간질였다. 오랫동안 잊고 있던 감각이 되살아나는 것 같았다.",
        status: "DRAFT",
        cover: { type: "color", bgColor: "#F5E1C0", textColor: "#5C3D2E", align: "center" },
      },
      {
        author: ids.minji,
        title: "긴 여행의 기록",
        content:
          "첫째 날, 기차에 올랐다. 차창 밖으로 펼쳐지는 풍경은 마치 한 폭의 수채화 같았다. 옆자리 승객은 조용히 책을 읽고 있었고, 나는 그 모습을 보며 괜히 기분이 좋아졌다.",
        status: "DRAFT",
        cover: { type: "color", bgColor: "#D4E4F7", textColor: "#1A3A5C", align: "center" },
      },
      {
        author: ids.minji,
        title: "비 오는 날의 생각들",
        content:
          "비가 내린다. 창문을 두드리는 빗소리가 묘하게 마음을 가라앉혀준다.\n---\n어릴 적 비 오는 날에는 종이배를 접어 골목에 띄우곤 했다. 지금은 어디로 흘러갔을까.",
        status: "DIVIDING",
        cover: { type: "default", textColor: "#333333", align: "center" },
      },
      {
        author: ids.minji,
        title: "도시의 새벽",
        content:
          "도시는 잠들지 않는다. 새벽 4시, 가로등 아래 누군가 자전거를 타고 지나간다.\n---\n나도 일어나 차를 끓였다. 아무도 깨우지 않는 시간, 오롯이 나만의 것.",
        status: "CLOSING",
        cover: { type: "color", bgColor: "#1F2A44", textColor: "#FFFFFF", align: "center" },
      },
      {
        author: ids.minji,
        title: "햇살 한 조각",
        content:
          "오늘 받은 햇살을 너에게 나눠 보낸다. 우리 서로의 창문이 같은 해를 향해 있다는 사실만으로도 충분히 따뜻하다.",
        status: "LETTER",
        cover: { type: "color", bgColor: "#FFE8B5", textColor: "#6B4226", align: "center" },
        letterAt: daysAgo(5),
      },
      {
        author: ids.minji,
        title: "조용한 다짐",
        content:
          "올해는 더 천천히 살기로 했다. 빠르게 가는 것보다 멀리 가는 것을, 많이 가지는 것보다 깊이 보는 것을.",
        status: "LETTER",
        cover: { type: "default", textColor: "#222222", align: "left" },
        letterAt: daysAgo(12),
      },
      {
        author: ids.minji,
        title: "작은 책장 앞에서",
        content:
          "책장 앞에 한참을 서 있었다. 읽지 않은 책들이 나를 보고 있는 것 같았다. 읽지 않아도 곁에 있다는 사실만으로 위로가 되는 책들이 있다.",
        status: "LETTER",
        cover: { type: "color", bgColor: "#E8DCC4", textColor: "#3D2817", align: "center" },
        letterAt: daysAgo(20),
      },
    ];

    const otherLetters: ArticleRow[] = [
      { author: ids.hayun,  title: "골목 끝의 노을",      content: "골목 끝에서 노을을 만났다. 너에게도 보여주고 싶었다.", status: "LETTER", letterAt: hoursAgo(6),
        cover: { type: "color", bgColor: "#FFB084", textColor: "#3A1F0E", align: "center" } },
      { author: ids.hayun,  title: "퇴근길에",            content: "지하철 창문에 비친 내 얼굴이 낯설었다. 오늘은 좀 쉬어가야겠다.", status: "LETTER", letterAt: daysAgo(2),
        cover: { type: "default", textColor: "#222222", align: "center" } },
      { author: ids.hayun,  title: "고요한 토요일",        content: "오늘은 아무 약속도 잡지 않았다. 그래서 하루가 길고 다정했다.", status: "LETTER", letterAt: daysAgo(8),
        cover: { type: "color", bgColor: "#C8D6B9", textColor: "#2E3D24", align: "center" } },
      { author: ids.seojun, title: "새벽 산책",           content: "잠이 오지 않아 새벽 산책을 했다. 누구에게라도 이 새벽을 들려주고 싶었다.", status: "LETTER", letterAt: hoursAgo(18),
        cover: { type: "color", bgColor: "#2A3E5C", textColor: "#FFFFFF", align: "center" } },
      { author: ids.seojun, title: "엄마의 김치찌개",     content: "엄마가 끓여주신 김치찌개. 별 거 아닌데 오늘은 그 맛이 자꾸 떠올라.", status: "LETTER", letterAt: daysAgo(3),
        cover: { type: "default", textColor: "#222222", align: "left" } },
      { author: ids.seojun, title: "오래된 노래",          content: "라디오에서 오래된 노래가 흘러나왔다. 그 노래를 같이 듣던 네가 떠올랐어.", status: "LETTER", letterAt: daysAgo(10),
        cover: { type: "color", bgColor: "#E8C5D5", textColor: "#4A1F33", align: "center" } },
      { author: ids.jia,    title: "처음 인사",            content: "안녕, 처음 보내는 편지야. 우리 잘 지내보자.", status: "LETTER", letterAt: hoursAgo(2),
        cover: { type: "color", bgColor: "#FFD9A0", textColor: "#5C3000", align: "center" } },
      { author: ids.jia,    title: "초록의 오후",          content: "공원 벤치에 앉아 있다. 바람이 좋아. 너에게 이 바람을 보내고 싶다.", status: "LETTER", letterAt: daysAgo(1),
        cover: { type: "color", bgColor: "#A8D5BA", textColor: "#1F3D2A", align: "center" } },
      { author: ids.doyun,  title: "별 보는 밤",           content: "베란다에 앉아 별을 셌다. 다 못 셌지만 충분했다.", status: "LETTER", letterAt: daysAgo(4),
        cover: { type: "color", bgColor: "#0F1A3D", textColor: "#FFE066", align: "center" } },
      { author: ids.doyun,  title: "비 그친 후",           content: "비가 그치고 무지개가 떴다. 아주 잠깐. 그래서 더 소중했어.", status: "LETTER", letterAt: daysAgo(15),
        cover: { type: "color", bgColor: "#D4C5E8", textColor: "#3D2A5C", align: "center" } },
    ];

    // Idempotent insert: stable identity on (author, title) — re-runs skip if same row exists.
    const allArticles = [...minjiArticles, ...otherLetters];
    const articleIdByKey: Record<string, string> = {};

    for (const a of allArticles) {
      const res = await tx.execute<IdRow>(sql`
        WITH ins AS (
          INSERT INTO articles (author_id, title, content, status, cover, letter_at)
          SELECT ${a.author}::uuid, ${a.title}, ${a.content}, ${a.status}::article_status,
                 ${a.cover ? JSON.stringify(a.cover) : null}::jsonb,
                 ${a.letterAt ?? null}::timestamptz
          WHERE NOT EXISTS (
            SELECT 1 FROM articles WHERE author_id = ${a.author}::uuid AND title = ${a.title}
          )
          RETURNING id
        )
        SELECT id FROM ins
        UNION ALL
        SELECT id FROM articles WHERE author_id = ${a.author}::uuid AND title = ${a.title}
        LIMIT 1
      `);
      articleIdByKey[`${a.author}::${a.title}`] = firstId(res);
    }

    // ── inbox: deliver other LETTERs to minji (visible_at = letter_at) ──
    for (const a of otherLetters) {
      const articleId = articleIdByKey[`${a.author}::${a.title}`];
      const visibleAt = a.letterAt ?? hoursAgo(1);
      await tx.execute(sql`
        INSERT INTO inbox (recipient_id, article_id, sender_id, visible_at)
        SELECT ${ids.minji}::uuid, ${articleId}::uuid, ${a.author}::uuid, ${visibleAt}::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM inbox
          WHERE recipient_id = ${ids.minji}::uuid AND article_id = ${articleId}::uuid
        )
      `);
    }

    // ── my_collections: minji 기록함 (archive) + 일반 모음 ──
    const archiveRes = await tx.execute<IdRow>(sql`
      WITH ins AS (
        INSERT INTO my_collections (owner_id, name, is_archive, is_public)
        SELECT ${ids.minji}::uuid, '기록함', true, false
        WHERE NOT EXISTS (
          SELECT 1 FROM my_collections WHERE owner_id = ${ids.minji}::uuid AND is_archive = true
        )
        RETURNING id
      )
      SELECT id FROM ins
      UNION ALL
      SELECT id FROM my_collections WHERE owner_id = ${ids.minji}::uuid AND is_archive = true
      LIMIT 1
    `);
    const archiveId = firstId(archiveRes);

    const collRes = await tx.execute<IdRow>(sql`
      WITH ins AS (
        INSERT INTO my_collections (owner_id, name, description, is_public)
        SELECT ${ids.minji}::uuid, '좋아하는 편지들', '오래 두고 읽고 싶은 편지', false
        WHERE NOT EXISTS (
          SELECT 1 FROM my_collections WHERE owner_id = ${ids.minji}::uuid AND name = '좋아하는 편지들'
        )
        RETURNING id
      )
      SELECT id FROM ins
      UNION ALL
      SELECT id FROM my_collections WHERE owner_id = ${ids.minji}::uuid AND name = '좋아하는 편지들'
      LIMIT 1
    `);
    const favCollId = firstId(collRes);

    // 기록함에는 minji 본인의 LETTER + 받은 일부 편지
    const archiveTargets = [
      ...minjiArticles.filter(a => a.status === "LETTER"),
      ...otherLetters.slice(0, 4),
    ];
    for (const a of archiveTargets) {
      const articleId = articleIdByKey[`${a.author}::${a.title}`];
      await tx.execute(sql`
        INSERT INTO my_collection_articles (my_collection_id, article_id)
        VALUES (${archiveId}::uuid, ${articleId}::uuid)
        ON CONFLICT ON CONSTRAINT my_collection_articles_unique DO NOTHING
      `);
    }

    // 좋아하는 편지들 모음 — 받은 편지 일부
    for (const a of otherLetters.slice(4, 7)) {
      const articleId = articleIdByKey[`${a.author}::${a.title}`];
      await tx.execute(sql`
        INSERT INTO my_collection_articles (my_collection_id, article_id)
        VALUES (${favCollId}::uuid, ${articleId}::uuid)
        ON CONFLICT ON CONSTRAINT my_collection_articles_unique DO NOTHING
      `);
    }

    // ── team_collections: minji가 만든 단체 모음 ──
    const teamRes = await tx.execute<IdRow>(sql`
      WITH ins AS (
        INSERT INTO team_collections (name, description, creator_id)
        SELECT '편지 모임', '함께 편지를 모으는 곳', ${ids.minji}::uuid
        WHERE NOT EXISTS (
          SELECT 1 FROM team_collections WHERE name = '편지 모임' AND creator_id = ${ids.minji}::uuid
        )
        RETURNING id
      )
      SELECT id FROM ins
      UNION ALL
      SELECT id FROM team_collections WHERE name = '편지 모임' AND creator_id = ${ids.minji}::uuid
      LIMIT 1
    `);
    const teamId = firstId(teamRes);

    // memberships: minji=OWNER, hayun=MEMBER, seojun=MEMBER
    const members: Array<[string, "OWNER" | "MEMBER"]> = [
      [ids.minji, "OWNER"],
      [ids.hayun, "MEMBER"],
      [ids.seojun, "MEMBER"],
    ];
    for (const [uid, role] of members) {
      await tx.execute(sql`
        INSERT INTO team_collection_memberships (team_collection_id, user_id, role)
        VALUES (${teamId}::uuid, ${uid}::uuid, ${role}::team_member_role)
        ON CONFLICT ON CONSTRAINT team_collection_memberships_unique DO NOTHING
      `);
    }

    // 단체 모음에 글 1~2개 (각자 본인 글만 추가 가능 정책 → addedBy=author)
    const teamArticles = [
      minjiArticles.find(a => a.title === "햇살 한 조각")!,
      otherLetters.find(a => a.title === "고요한 토요일")!,
    ];
    for (const a of teamArticles) {
      const articleId = articleIdByKey[`${a.author}::${a.title}`];
      await tx.execute(sql`
        INSERT INTO team_collection_articles (team_collection_id, article_id, added_by)
        VALUES (${teamId}::uuid, ${articleId}::uuid, ${a.author}::uuid)
        ON CONFLICT ON CONSTRAINT team_collection_articles_unique DO NOTHING
      `);
    }
  });
}

async function main() {
  try {
    const ids = await ensureAllAuthAccounts();
    await upsertUsersTable(ids);
    await seedRelationalData(ids);
    await printPostSeedSummary(ids);

    console.log("\n✅ Done.\n");
    console.log("=== Test Account UUIDs ===");
    for (const acc of TEST_ACCOUNTS) {
      console.log(`  ${acc.nickname.padEnd(2)} (${acc.email.padEnd(20)}) → ${ids[acc.key]}`);
    }
    console.log("\n👉 Update FALLBACK_USER_ID in artifacts/friction/contexts/UserContext.tsx to:");
    console.log(`   "${ids.minji}"\n`);
    console.log(`Password (all accounts): ${PASSWORD}`);
    console.log("\n⚠️  Supabase 대시보드에서 Email Confirmation을 꺼야 즉시 로그인이 가능합니다.");
  } catch (err) {
    console.error("\n❌ Seed failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
