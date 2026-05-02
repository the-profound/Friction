import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── 환경 가드 ──────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  console.error("❌ seed:articles 는 production 환경에서 실행할 수 없습니다.");
  process.exit(1);
}

// ── CLI 파싱 ───────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    user: "minji@test.com",
    count: 10,
    status: "LETTER" as "DRAFT" | "DIVIDING" | "CLOSING" | "LETTER",
    myCollection: null as string | null,
    teamCollection: null as string | null,
    visibleAtPast: 1,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--user" && args[i + 1]) {
      result.user = args[++i];
    } else if (arg === "--count" && args[i + 1]) {
      const raw = parseInt(args[++i], 10);
      if (isNaN(raw)) {
        console.error(`❌ --count 는 정수여야 합니다.`);
        process.exit(1);
      }
      result.count = Math.min(10, Math.max(1, raw));
    } else if (arg === "--status" && args[i + 1]) {
      const s = args[++i].toUpperCase();
      if (["DRAFT", "DIVIDING", "CLOSING", "LETTER"].includes(s)) {
        result.status = s as typeof result.status;
      } else {
        console.error(`❌ --status 는 DRAFT|DIVIDING|CLOSING|LETTER 중 하나여야 합니다. (받은 값: ${s})`);
        process.exit(1);
      }
    } else if (arg === "--my-collection" && args[i + 1]) {
      result.myCollection = args[++i];
    } else if (arg === "--team-collection" && args[i + 1]) {
      result.teamCollection = args[++i];
    } else if (arg === "--visible-at-past" && args[i + 1]) {
      const raw = parseFloat(args[++i]);
      if (isNaN(raw) || raw < 0) {
        console.error(`❌ --visible-at-past 는 0 이상의 숫자여야 합니다.`);
        process.exit(1);
      }
      result.visibleAtPast = raw;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    }
  }

  return result;
}

// ── 긴 글 본문 10개 ─────────────────────────────────────────────────────────
type ArticleCover =
  | { type: "color"; bgColor: string; textColor: string; align: "left" | "center" | "right" }
  | { type: "default"; textColor: string; align: "left" | "center" | "right" };

interface LongArticle {
  title: string;
  content: string;
  defaultCover: ArticleCover;
}

const LONG_ARTICLES: LongArticle[] = [
  {
    title: "봄비가 내리던 날의 기억",
    content: `사월의 봄비는 소리가 다르다. 겨우내 굳어 있던 땅을 두드리는 소리가 마치 오랜 친구의 노크처럼 부드럽고 반갑다. 나는 그날 우산도 챙기지 않은 채 집을 나섰다. 빗속을 걷다 보면 머릿속이 깨끗해지는 기분이 들어서였다.

---

골목을 돌아 작은 서점 앞에 멈춰 섰다. 오래된 간판 아래로 빗물이 흘러내리고, 진열창에 놓인 시집 한 권이 유독 눈에 들어왔다. 표지에는 아무 그림도 없이 제목만 적혀 있었다. 《비가 오면 생각나는 것들》. 웃음이 나왔다. 꼭 지금 내 상황 같았다.

---

서점 안은 따뜻했다. 주인 할머니가 아무 말 없이 손수건을 건네주셨고, 나는 그 조용한 친절에 괜히 코끝이 찡해졌다. 책을 한 권 사서 나오니 비가 조금 잦아들어 있었다. 봄비는 오래 머물지 않는다. 그래서 더 소중한 건지도 모른다. 오늘 이 비를, 이 서점을, 그 손수건을 오래 기억하고 싶다.`,
    defaultCover: { type: "color", bgColor: "#D6E4F0", textColor: "#1A3A5C", align: "center" },
  },
  {
    title: "할머니의 된장찌개",
    content: `어릴 적 할머니 댁 부엌에서 나던 냄새는 지금도 선명하다. 된장이 끓으며 내는 구수한 향, 파가 지글거리는 소리, 뚝배기 뚜껑을 살짝 열 때 피어오르는 하얀 김. 그 모든 것이 뒤섞인 공간이 나에게는 세상에서 가장 안전한 곳이었다.

---

할머니는 된장을 담그는 날이면 새벽부터 일어나셨다. 콩을 삶고, 메주를 빚고, 볕 좋은 날에 항아리를 열어 뒤적이시던 그 손놀림이 아직도 눈에 선하다. 된장 하나를 만들기 위해 그토록 긴 시간을 들이는 이유를 어릴 때는 몰랐다. 지금은 안다. 기다림이 맛이 된다는 것을.

---

지난 주말, 처음으로 된장찌개를 끓여봤다. 할머니의 방식대로 두부를 큼직하게 썰고, 감자를 넉넉히 넣었다. 맛이 완전히 같지는 않았지만, 어딘가 비슷한 온기가 있었다. 그 온기가 코끝에 닿는 순간, 할머니가 보고 싶어졌다. 된장찌개는 음식이 아니라 기억이다.`,
    defaultCover: { type: "color", bgColor: "#F5E6D3", textColor: "#5C3D1E", align: "center" },
  },
  {
    title: "지하철 7호선에서",
    content: `퇴근 시간 지하철은 언제나 사람으로 가득 찬다. 오늘은 유독 붐볐다. 손잡이를 잡고 서서, 어쩔 수 없이 사람들의 얼굴을 보게 됐다. 누군가는 이어폰을 꽂고 눈을 감고 있었고, 누군가는 스마트폰 화면을 멍하니 보고 있었다. 피곤함이 얼굴에 얇게 내려앉은 사람들.

---

그 중 한 아이가 눈에 들어왔다. 초등학생쯤 돼 보이는 남자아이였는데, 창밖의 터널을 내내 신기한 눈으로 바라보고 있었다. 터널을 빠져나와 빛이 쏟아질 때마다 아이는 살짝 눈을 찌푸리다가 이내 다시 창에 달라붙었다. 그 표정이 어찌나 순수한지, 나도 모르게 따라 창밖을 봤다.

---

그냥 지나쳐 왔던 풍경이었다. 선로 옆으로 핀 들꽃, 멀리 보이는 아파트 창문마다 걸린 빨래, 어스름한 하늘에 걸친 비행기 한 대. 아이의 눈으로 보니 새로웠다. 오늘의 지하철이 고맙다. 지치지 않는 눈을 잠시 빌려줘서.`,
    defaultCover: { type: "default", textColor: "#222222", align: "left" },
  },
  {
    title: "나무 한 그루와의 대화",
    content: `우리 동네에는 수령이 300년 넘었다는 느티나무가 있다. 시에서 보호수로 지정해 작은 울타리를 쳐두었는데, 그 나무 앞을 지날 때마다 나는 발걸음이 느려진다. 300년이라는 시간이 얼마나 긴 건지 가늠이 되지 않아서.

---

오늘은 벤치에 앉아 한참 그 나무를 바라봤다. 이 나무가 처음 싹을 틔웠을 때 이 자리에는 무엇이 있었을까. 논이었을까, 밭이었을까. 전쟁을 겪었을 때 이 나무는 무엇을 보았을까. 묻고 싶은 것이 많은데 나무는 그냥 거기 서서 바람에 잎을 흔들 뿐이다.

---

그런데 그것으로 충분한 것 같다. 대답하지 않아도, 설명하지 않아도, 그냥 거기 있다는 것. 300년이라는 시간을 그렇게 버텨온 것. 어쩌면 나무에게서 배울 것은 바로 그것인지도 모른다. 아무것도 증명하지 않아도, 그냥 서 있는 것만으로도 충분하다는 것.`,
    defaultCover: { type: "color", bgColor: "#D4E8C2", textColor: "#2E4A1E", align: "center" },
  },
  {
    title: "혼자 여행한 제주에서",
    content: `처음 혼자 여행을 떠났다. 목적지는 제주. 비행기에 오르면서도 반쯤은 불안했다. 밥은 어디서 먹지, 심심하면 어떡하지. 그런데 막상 도착하고 나니 그 걱정들이 우스워졌다. 제주 공기가 처음부터 달랐다.

---

이틀째, 성산일출봉을 올랐다. 오르는 내내 숨이 찼지만 정상에서 본 바다는 그 수고를 한 번에 갚아줬다. 옥색과 남색이 섞인 물빛이 햇빛에 반짝이고 있었다. 옆에 아무도 없었는데, 오히려 그래서 온전히 눈에 담을 수 있었다. 혼자라는 것이 외로움이 아니라 자유였다.

---

사흘째 밤, 작은 게스트하우스 마당에서 별을 봤다. 서울에선 보이지 않던 별들이 제주 하늘을 가득 채우고 있었다. 같은 나라인데 이렇게 다른 하늘이 있다는 것이 신기했다. 집에 돌아와서도 그 별들이 자꾸 생각난다. 다음에 또 오겠다고, 하늘에 약속했다.`,
    defaultCover: { type: "color", bgColor: "#C8E6F0", textColor: "#0E3A5C", align: "center" },
  },
  {
    title: "오래된 일기장을 펼치며",
    content: `이사 준비를 하다가 오래된 상자 하나를 발견했다. 안에는 중학교 때 쓰던 일기장 세 권이 들어 있었다. 표지에 스티커가 잔뜩 붙어 있고, 자물쇠가 달린 일기장. 열쇠는 어디 갔는지 모르겠지만 자물쇠는 이미 고장 나 있었다.

---

첫 페이지를 펼쳤다. 글씨가 삐뚤빼뚤했다. 내용은 더 가관이었다. 친구와 싸운 일, 짝사랑하던 남자아이 이야기, 시험을 망친 날의 자책. 지금의 나라면 별 것도 아닌 일들인데, 그때의 나에게는 세상이 끝나는 것처럼 느껴졌던 모양이다. 한 줄 한 줄이 진지하고 절절했다.

---

한참을 읽다가 덮었다. 그 시절의 나에게 고생했다고 말해주고 싶었다. 그 모든 사소한 아픔들이 쌓여서 지금의 내가 됐다고. 일기장을 다시 상자에 넣었다. 버리지 않기로 했다. 나의 역사니까. 언젠가 또 꺼내 읽을 날이 올 것이다.`,
    defaultCover: { type: "color", bgColor: "#F0E6C8", textColor: "#4A3510", align: "left" },
  },
  {
    title: "도서관의 오후",
    content: `오후 두 시의 도서관은 묘한 공기가 있다. 햇빛이 비스듬히 창을 통해 들어와 책상 위에 긴 그림자를 만들고, 사람들은 저마다 다른 세계에 빠져 있다. 그 속에 앉아 있으면 나도 잠시 세상으로부터 분리되는 기분이 든다.

---

오늘은 책을 빌리러 왔다가 그냥 앉아버렸다. 빌릴 책을 고르다가 읽고 싶은 구절에 눈이 멈췄고, 앉아서 조금만 읽으려다가 한 시간이 훌쩍 지나버렸다. 그래도 아깝지 않았다. 도서관에서 흘러가는 시간은 다른 곳에서의 시간과 질이 다르다.

---

돌아오는 길에 노을이 지고 있었다. 오늘 도서관에서 읽은 소설의 한 문장이 계속 머릿속에 맴돌았다. "삶은 읽히는 것이 아니라 쓰이는 것이다." 오늘 이 문장을 만난 것이 좋았다. 내가 지금 쓰고 있는 나의 이야기가 어떤 문장들로 채워지고 있는지 생각해보게 되었다.`,
    defaultCover: { type: "color", bgColor: "#E8DCC4", textColor: "#3D2817", align: "center" },
  },
  {
    title: "첫눈이 내리던 저녁",
    content: `올 겨울 첫눈이 내렸다. 퇴근하고 나오니 하늘에서 하얀 것들이 내려오고 있었다. 처음엔 눈인지 모르고 그냥 걸었는데, 코트 소매에 내려앉은 눈송이를 보고서야 알았다. 작고 온전한 결정체 하나가 잠깐 있다가 사라졌다.

---

사람들이 하나둘 발걸음을 멈추고 하늘을 올려다봤다. 어른들도 잠깐은 아이가 되는 것 같았다. 스마트폰을 꺼내 사진을 찍는 사람, 손을 내밀어 눈을 받으려는 사람. 첫눈 앞에서는 다들 비슷해진다. 반갑고 설레는 마음이 표정 위로 올라왔다.

---

집에 돌아와 창가에 앉아 눈 내리는 것을 봤다. 가로등 빛을 받아 눈송이들이 빛나며 내려왔다. 세상이 조용해지는 소리가 났다. 아무것도 안 해도 되는 저녁이었다. 그냥 이대로, 이 창가에서 눈이 차곡차곡 쌓이는 것을 보는 것만으로 충분한 밤이었다.`,
    defaultCover: { type: "color", bgColor: "#E8EEF5", textColor: "#2A3D5C", align: "center" },
  },
  {
    title: "음악이 필요한 날",
    content: `어떤 날은 음악 없이 하루를 버티기가 힘들다. 오늘이 그런 날이었다. 아침부터 일이 꼬이고, 말이 많아지고, 머릿속이 시끄러웠다. 결국 퇴근 후 이어폰을 꽂고 오래 듣지 않았던 앨범을 틀었다.

---

첫 곡이 시작되는 순간, 어깨에서 뭔가 스르르 내려가는 느낌이 들었다. 음악은 말하지 않는다. 그냥 옆에 있어준다. 오늘 하루 있었던 일들을 따지지도 않고, 위로의 말을 찾지도 않으면서, 그냥 소리로 함께 있어준다. 그것만으로 충분할 때가 있다.

---

앨범 한 장을 다 듣고 나니 밖이 어두워져 있었다. 배도 고팠다. 하지만 이상하게 기분이 가벼워져 있었다. 음악이 뭔가를 해결해준 것은 아닌데, 그래도 달라져 있었다. 오늘 이 음악을 발견한 과거의 내가 고맙다. 좋은 음악들을 잘 모아뒀다고, 그 선택에 감사하다고 말해주고 싶다.`,
    defaultCover: { type: "default", textColor: "#333333", align: "left" },
  },
  {
    title: "편지를 쓴다는 것",
    content: `요즘은 손으로 편지를 쓰는 사람이 드물다. 나도 오랫동안 그랬다. 메시지를 보내면 되고, 이메일이면 되고, 굳이 시간을 들여 편지를 쓸 이유가 없었다. 그러다 작년에 친구에게서 손편지 한 장을 받았다.

---

봉투를 뜯는 손이 떨렸다. 안에서 엽서 크기의 종이가 나왔고, 친구의 필체가 가득 채워져 있었다. 문장이 특별히 아름다운 것도 아니었다. 하지만 그 편지를 읽는 동안, 그 친구의 손이 이 종이 위를 움직이던 시간이 느껴졌다. 나를 생각하며 앉아 있었던 그 시간이 고스란히 전해져 왔다.

---

그 이후로 가끔 편지를 쓴다. 느리고 번거롭지만, 그 느림과 번거로움 속에 진심이 담기는 것 같다. 편지는 도착하기까지 시간이 걸린다. 그 기다림 동안 마음도 함께 숙성된다. 이 글도 그렇게 가 닿기를 바란다.`,
    defaultCover: { type: "color", bgColor: "#F5E8D5", textColor: "#5C3A1A", align: "center" },
  },
];

// ── DB 헬퍼 타입 ─────────────────────────────────────────────────────────────
type IdRow = { id: string } & Record<string, unknown>;
type InsertResultRow = { id: string; inserted: boolean } & Record<string, unknown>;

function firstId(result: { rows?: IdRow[] } | IdRow[]): string {
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const row = rows[0];
  if (!row) throw new Error("expected at least one row");
  return row.id;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  console.log("📋 Options:", {
    user: opts.user,
    count: opts.count,
    status: opts.status,
    myCollection: opts.myCollection,
    teamCollection: opts.teamCollection,
    visibleAtPast: opts.visibleAtPast,
    dryRun: opts.dryRun,
  });

  const articlesToInsert = LONG_ARTICLES.slice(0, opts.count);

  if (opts.dryRun) {
    console.log("\n🧪 DRY RUN — 삽입될 글 목록:");
    for (const a of articlesToInsert) {
      console.log(`  - "${a.title}" (${a.content.length}자)`);
    }
    console.log(`\n총 ${articlesToInsert.length}개의 글이 삽입될 예정입니다.`);
    return;
  }

  // 사용자 조회
  const userRes = await db.execute<IdRow>(sql`
    SELECT id FROM users
    WHERE nickname = ${opts.user} OR email = ${opts.user}
    LIMIT 1
  `);
  const userId = (userRes.rows ?? [])[0]?.id;
  if (!userId) {
    console.error(`❌ 사용자를 찾을 수 없습니다: ${opts.user}`);
    process.exit(1);
  }
  console.log(`\n👤 사용자 확인: ${opts.user} → ${userId}`);

  const now = new Date();
  const visibleAt = new Date(now.getTime() - opts.visibleAtPast * 3600000);

  const insertedIds: string[] = [];
  const skippedTitles: string[] = [];
  const allIds: string[] = [];

  await db.transaction(async (tx) => {
    // 글 삽입 — CTE RETURNING 으로 삽입 여부를 결정론적으로 판별
    for (const a of articlesToInsert) {
      const letterAt = opts.status === "LETTER" ? visibleAt : null;

      const res = await tx.execute<InsertResultRow>(sql`
        WITH ins AS (
          INSERT INTO articles (author_id, title, content, status, cover, letter_at)
          SELECT
            ${userId}::uuid,
            ${a.title},
            ${a.content},
            ${opts.status}::article_status,
            ${JSON.stringify(a.defaultCover)}::jsonb,
            ${letterAt}::timestamptz
          WHERE NOT EXISTS (
            SELECT 1 FROM articles WHERE author_id = ${userId}::uuid AND title = ${a.title}
          )
          RETURNING id
        )
        SELECT id, true AS inserted FROM ins
        UNION ALL
        SELECT id, false AS inserted FROM articles
          WHERE author_id = ${userId}::uuid AND title = ${a.title}
            AND NOT EXISTS (SELECT 1 FROM ins)
        LIMIT 1
      `);

      const row = (res.rows ?? [])[0];
      if (!row) throw new Error(`글 삽입/조회 실패: "${a.title}"`);

      allIds.push(row.id);

      if (row.inserted) {
        insertedIds.push(row.id);
        console.log(`  ✓ INSERT: "${a.title}" → ${row.id}`);
      } else {
        skippedTitles.push(a.title);
        console.log(`  ↩ SKIP: "${a.title}" (이미 존재, id: ${row.id})`);
      }
    }

    // 개인 모음 연결
    if (opts.myCollection) {
      const collRes = await tx.execute<IdRow>(sql`
        WITH ins AS (
          INSERT INTO my_collections (owner_id, name, is_public)
          SELECT ${userId}::uuid, ${opts.myCollection}, false
          WHERE NOT EXISTS (
            SELECT 1 FROM my_collections WHERE owner_id = ${userId}::uuid AND name = ${opts.myCollection}
          )
          RETURNING id
        )
        SELECT id FROM ins
        UNION ALL
        SELECT id FROM my_collections WHERE owner_id = ${userId}::uuid AND name = ${opts.myCollection}
        LIMIT 1
      `);
      const collId = firstId(collRes);
      console.log(`\n📁 개인 모음 "${opts.myCollection}" (${collId}) 에 글 연결 중...`);

      for (const articleId of allIds) {
        await tx.execute(sql`
          INSERT INTO my_collection_articles (my_collection_id, article_id)
          VALUES (${collId}::uuid, ${articleId}::uuid)
          ON CONFLICT ON CONSTRAINT my_collection_articles_unique DO NOTHING
        `);
      }
      console.log(`  ✓ ${allIds.length}개 글 연결 완료`);
    }

    // 단체 모음 연결
    if (opts.teamCollection) {
      const teamRes = await tx.execute<IdRow>(sql`
        WITH ins AS (
          INSERT INTO team_collections (name, creator_id)
          SELECT ${opts.teamCollection}, ${userId}::uuid
          WHERE NOT EXISTS (
            SELECT 1 FROM team_collections WHERE name = ${opts.teamCollection} AND creator_id = ${userId}::uuid
          )
          RETURNING id
        )
        SELECT id FROM ins
        UNION ALL
        SELECT id FROM team_collections WHERE name = ${opts.teamCollection} AND creator_id = ${userId}::uuid
        LIMIT 1
      `);
      const teamId = firstId(teamRes);
      console.log(`\n👥 단체 모음 "${opts.teamCollection}" (${teamId}) 에 글 연결 중...`);

      // 멤버십 확인/추가 (OWNER)
      await tx.execute(sql`
        INSERT INTO team_collection_memberships (team_collection_id, user_id, role)
        VALUES (${teamId}::uuid, ${userId}::uuid, 'OWNER'::team_member_role)
        ON CONFLICT ON CONSTRAINT team_collection_memberships_unique DO NOTHING
      `);

      for (const articleId of allIds) {
        await tx.execute(sql`
          INSERT INTO team_collection_articles (team_collection_id, article_id, added_by)
          VALUES (${teamId}::uuid, ${articleId}::uuid, ${userId}::uuid)
          ON CONFLICT ON CONSTRAINT team_collection_articles_unique DO NOTHING
        `);
      }
      console.log(`  ✓ ${allIds.length}개 글 연결 완료`);
    }
  });

  console.log(`\n✅ 완료`);
  console.log(`   삽입: ${insertedIds.length}개 | 스킵: ${skippedTitles.length}개`);
  if (insertedIds.length > 0) {
    console.log(`   삽입된 ID 목록:`);
    for (const id of insertedIds) {
      console.log(`     ${id}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("\n❌ seed:articles 실패:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
