import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  usersTable,
  articlesTable,
  inboxTable,
  sendRecordsTable,
  neighborsTable,
  neighborRequestsTable,
  readingRecordsTable,
  userArticleReadsTable,
  storedSentencesTable,
  myCollectionsTable,
  myCollectionArticlesTable,
  teamCollectionsTable,
  teamCollectionMembershipsTable,
  teamCollectionArticlesTable,
} from "@workspace/db/schema";

async function seed() {
  console.log("🌱 Seeding database...\n");

  await db.transaction(async (tx) => {
    console.log("  Cleaning existing data...");
    await tx.execute(sql`TRUNCATE TABLE
      team_collection_articles,
      team_collection_memberships,
      team_collections,
      my_collection_articles,
      my_collections,
      stored_sentences,
      reading_records,
      user_article_reads,
      send_records,
      inbox,
      neighbor_requests,
      neighbors,
      articles,
      users
    CASCADE`);

    // ─── 1. Users ───
    console.log("  Creating users...");
    const [minji, hayun, seojun, jia, doyun] = await tx
      .insert(usersTable)
      .values([
        { email: "minji@test.com", nickname: "민지" },
        { email: "hayun@test.com", nickname: "하윤" },
        { email: "seojun@test.com", nickname: "서준" },
        { email: "jia@test.com", nickname: "지아" },
        { email: "doyun@test.com", nickname: "도윤" },
      ])
      .returning();

    // ─── 2. Neighbors ───
    console.log("  Creating neighbor relationships...");
    await tx.insert(neighborsTable).values([
      { userAId: minji.id, userBId: hayun.id },
      { userAId: minji.id, userBId: seojun.id },
    ]);

    await tx.insert(neighborRequestsTable).values([
      { requesterId: jia.id, recipientId: minji.id, status: "PENDING" },
    ]);

    // ─── 3. Articles ───
    console.log("  Creating articles...");

    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);

    const [
      minjiDraft1,
      minjiDraft2,
      minjiDividing,
      minjiClosing,
      minjiLetter1,
      minjiLetter2,
      minjiLetter3,
      hayunLetter1,
      hayunLetter2,
      seojunLetter1,
      hayunDraft1,
    ] = await tx
      .insert(articlesTable)
      .values([
        {
          authorId: minji.id,
          title: "오늘 아침의 단상",
          content: "커피 한 잔을 마시며 창밖을 바라보았다. 봄이 오고 있었다.",
          status: "DRAFT" as const,
        },
        {
          authorId: minji.id,
          title: "긴 여행의 기록",
          content:
            "첫째 날, 기차에 올랐다. 차창 밖으로 펼쳐지는 풍경은 마치 한 폭의 수채화 같았다. " +
            "둘째 날, 작은 마을에 도착했다. 골목길마다 이야기가 숨어 있었다. " +
            "셋째 날, 바다를 보았다. 끝없이 펼쳐진 수평선 앞에서 나는 한없이 작아졌다. " +
            "넷째 날, 산에 올랐다. 정상에서 내려다본 세상은 고요했다. " +
            "다섯째 날, 집으로 돌아왔다. 여행은 끝났지만, 마음속에는 새로운 길이 열려 있었다.",
          status: "DRAFT" as const,
        },
        {
          authorId: minji.id,
          title: "비 오는 날의 생각들",
          content:
            "빗소리를 들으며 글을 쓴다. 비는 항상 무언가를 씻어내려 하는 것 같다. " +
            "우산 없이 걸었던 그 날의 기억이 떠오른다. 젖은 신발, 차가운 바람, 그리고 따뜻한 카페.",
          status: "DIVIDING" as const,
          pages: [
            { pageNumber: 1, content: "빗소리를 들으며 글을 쓴다. 비는 항상 무언가를 씻어내려 하는 것 같다." },
            { pageNumber: 2, content: "우산 없이 걸었던 그 날의 기억이 떠오른다. 젖은 신발, 차가운 바람, 그리고 따뜻한 카페." },
          ],
        },
        {
          authorId: minji.id,
          title: "시간의 무게",
          content:
            "시간은 가볍기도 하고 무겁기도 하다. 기다리는 시간은 늘 무겁고, 즐거운 시간은 가볍다. " +
            "우리는 시간 위를 걸으며 살아간다. 발자국은 남지만, 되돌아갈 수는 없다.",
          status: "CLOSING" as const,
          pages: [
            { pageNumber: 1, content: "시간은 가볍기도 하고 무겁기도 하다. 기다리는 시간은 늘 무겁고, 즐거운 시간은 가볍다." },
            { pageNumber: 2, content: "우리는 시간 위를 걸으며 살아간다. 발자국은 남지만, 되돌아갈 수는 없다." },
          ],
          style: { fontFamily: "serif", fontSize: 18, lineHeight: 1.8 },
        },
        {
          authorId: minji.id,
          title: "계절의 편지",
          content:
            "봄이 오면 항상 너에게 편지를 쓰고 싶어져. 벚꽃이 피는 길을 걸으며 생각했어. " +
            "우리가 함께 걸었던 그 길, 아직도 그대로일까. 올해도 꽃은 피겠지.",
          status: "LETTER" as const,
          pages: [
            { pageNumber: 1, content: "봄이 오면 항상 너에게 편지를 쓰고 싶어져. 벚꽃이 피는 길을 걸으며 생각했어." },
            { pageNumber: 2, content: "우리가 함께 걸었던 그 길, 아직도 그대로일까. 올해도 꽃은 피겠지." },
          ],
          style: { fontFamily: "serif", fontSize: 16, lineHeight: 1.6 },
          letterAt: daysAgo(5),
        },
        {
          authorId: minji.id,
          title: "밤하늘 아래서",
          content: "별을 세다 잠이 들었어. 꿈속에서도 별이 떠 있었어.",
          status: "LETTER" as const,
          pages: [
            { pageNumber: 1, content: "별을 세다 잠이 들었어. 꿈속에서도 별이 떠 있었어." },
          ],
          style: { fontFamily: "sans-serif", fontSize: 14, lineHeight: 1.5 },
          letterAt: daysAgo(3),
        },
        {
          authorId: minji.id,
          title: "도시의 소리",
          content:
            "아침이면 새소리 대신 차 소리가 들린다. 하지만 그 사이로 가끔, 피아노 소리가 들려온다. " +
            "어디선가 누군가 연습하고 있는 거겠지. 그 불완전한 멜로디가 좋다. " +
            "완벽하지 않아서 더 따뜻한, 도시의 음악.",
          status: "LETTER" as const,
          pages: [
            { pageNumber: 1, content: "아침이면 새소리 대신 차 소리가 들린다. 하지만 그 사이로 가끔, 피아노 소리가 들려온다." },
            { pageNumber: 2, content: "어디선가 누군가 연습하고 있는 거겠지. 그 불완전한 멜로디가 좋다." },
            { pageNumber: 3, content: "완벽하지 않아서 더 따뜻한, 도시의 음악." },
          ],
          style: { fontFamily: "serif", fontSize: 16, lineHeight: 1.7 },
          letterAt: daysAgo(1),
        },
        {
          authorId: hayun.id,
          title: "나의 작은 정원",
          content:
            "베란다에 작은 화분을 놓았어. 매일 물을 주며 말을 걸어. " +
            "식물도 외로움을 타는 걸까. 잎이 나를 향해 자라는 것 같아서 기분이 좋았어. " +
            "작은 것들이 주는 위로가 있어.",
          status: "LETTER" as const,
          pages: [
            { pageNumber: 1, content: "베란다에 작은 화분을 놓았어. 매일 물을 주며 말을 걸어." },
            { pageNumber: 2, content: "식물도 외로움을 타는 걸까. 잎이 나를 향해 자라는 것 같아서 기분이 좋았어." },
            { pageNumber: 3, content: "작은 것들이 주는 위로가 있어." },
          ],
          style: { fontFamily: "serif", fontSize: 16, lineHeight: 1.6 },
          letterAt: daysAgo(7),
        },
        {
          authorId: hayun.id,
          title: "책 읽는 밤",
          content:
            "오래된 책장에서 책 한 권을 꺼냈어. 종이 냄새가 참 좋더라. " +
            "한 줄 한 줄 읽다 보니 새벽이 되어 있었어.",
          status: "LETTER" as const,
          pages: [
            { pageNumber: 1, content: "오래된 책장에서 책 한 권을 꺼냈어. 종이 냄새가 참 좋더라." },
            { pageNumber: 2, content: "한 줄 한 줄 읽다 보니 새벽이 되어 있었어." },
          ],
          style: { fontFamily: "serif", fontSize: 16, lineHeight: 1.6 },
          letterAt: daysAgo(2),
        },
        {
          authorId: seojun.id,
          title: "산책의 기술",
          content:
            "좋은 산책에는 기술이 필요하다. 첫째, 목적지를 정하지 않는다. " +
            "둘째, 시계를 보지 않는다. 셋째, 발걸음을 느리게 한다. " +
            "그러면 평소에 보이지 않던 것들이 보이기 시작한다.",
          status: "LETTER" as const,
          pages: [
            { pageNumber: 1, content: "좋은 산책에는 기술이 필요하다. 첫째, 목적지를 정하지 않는다." },
            { pageNumber: 2, content: "둘째, 시계를 보지 않는다. 셋째, 발걸음을 느리게 한다." },
            { pageNumber: 3, content: "그러면 평소에 보이지 않던 것들이 보이기 시작한다." },
          ],
          style: { fontFamily: "sans-serif", fontSize: 15, lineHeight: 1.6 },
          letterAt: daysAgo(4),
        },
        {
          authorId: hayun.id,
          title: "메모: 내일 할 일",
          content: "빨래하기, 장보기, 편지 쓰기",
          status: "DRAFT" as const,
        },
      ])
      .returning();

    // ─── 4. Inbox + 5. Send Records ───
    console.log("  Creating inbox and send records...");

    const pastSlot = daysAgo(1);
    const futureSlot = new Date(now.getTime() + 2 * 86400000);

    const [inbox1] = await tx
      .insert(inboxTable)
      .values({
        recipientId: minji.id,
        articleId: hayunLetter1.id,
        senderId: hayun.id,
        visibleAt: daysAgo(6),
        openedAt: daysAgo(5),
        isRead: true,
      })
      .returning();

    const [inbox2] = await tx
      .insert(inboxTable)
      .values({
        recipientId: minji.id,
        articleId: hayunLetter2.id,
        senderId: hayun.id,
        visibleAt: daysAgo(1),
        openedAt: daysAgo(0),
        isRead: false,
      })
      .returning();

    const [inbox3] = await tx
      .insert(inboxTable)
      .values({
        recipientId: minji.id,
        articleId: seojunLetter1.id,
        senderId: seojun.id,
        visibleAt: futureSlot,
        openedAt: null,
        isRead: false,
      })
      .returning();

    const [inbox4] = await tx
      .insert(inboxTable)
      .values({
        recipientId: hayun.id,
        articleId: minjiLetter1.id,
        senderId: minji.id,
        visibleAt: daysAgo(4),
        openedAt: daysAgo(3),
        isRead: true,
      })
      .returning();

    const [inbox5] = await tx
      .insert(inboxTable)
      .values({
        recipientId: hayun.id,
        articleId: minjiLetter2.id,
        senderId: minji.id,
        visibleAt: daysAgo(2),
        openedAt: null,
        isRead: false,
      })
      .returning();

    const [inbox6] = await tx
      .insert(inboxTable)
      .values({
        recipientId: seojun.id,
        articleId: minjiLetter3.id,
        senderId: minji.id,
        visibleAt: daysAgo(0),
        openedAt: null,
        isRead: false,
      })
      .returning();

    await tx.insert(sendRecordsTable).values([
      {
        senderId: hayun.id,
        recipientId: minji.id,
        articleId: hayunLetter1.id,
        inboxId: inbox1.id,
        deliverySlot: daysAgo(6),
        sentAt: daysAgo(7),
      },
      {
        senderId: hayun.id,
        recipientId: minji.id,
        articleId: hayunLetter2.id,
        inboxId: inbox2.id,
        deliverySlot: daysAgo(1),
        sentAt: daysAgo(2),
      },
      {
        senderId: seojun.id,
        recipientId: minji.id,
        articleId: seojunLetter1.id,
        inboxId: inbox3.id,
        deliverySlot: futureSlot,
        sentAt: daysAgo(0),
      },
      {
        senderId: minji.id,
        recipientId: hayun.id,
        articleId: minjiLetter1.id,
        inboxId: inbox4.id,
        deliverySlot: daysAgo(4),
        sentAt: daysAgo(5),
      },
      {
        senderId: minji.id,
        recipientId: hayun.id,
        articleId: minjiLetter2.id,
        inboxId: inbox5.id,
        deliverySlot: daysAgo(2),
        sentAt: daysAgo(3),
      },
      {
        senderId: minji.id,
        recipientId: seojun.id,
        articleId: minjiLetter3.id,
        inboxId: inbox6.id,
        deliverySlot: daysAgo(0),
        sentAt: daysAgo(1),
      },
    ]);

    // ─── 6. Reading Records ───
    console.log("  Creating reading records...");

    await tx.insert(userArticleReadsTable).values([
      { userId: minji.id, articleId: hayunLetter1.id, completedAt: daysAgo(4) },
      { userId: hayun.id, articleId: minjiLetter1.id, completedAt: daysAgo(2) },
    ]);

    await tx.insert(readingRecordsTable).values([
      {
        userId: minji.id,
        articleId: hayunLetter2.id,
        currentPage: 2,
        scrollPosition: 0.5,
      },
    ]);

    // ─── 7. Stored Sentences ───
    console.log("  Creating stored sentences...");

    await tx.insert(storedSentencesTable).values([
      {
        userId: minji.id,
        articleId: hayunLetter1.id,
        text: "작은 것들이 주는 위로가 있어.",
        position: { page: 3, offset: 0 },
        isFavorite: true,
      },
      {
        userId: minji.id,
        articleId: hayunLetter1.id,
        text: "식물도 외로움을 타는 걸까.",
        position: { page: 2, offset: 0 },
        isFavorite: false,
      },
      {
        userId: minji.id,
        articleId: seojunLetter1.id,
        text: "그러면 평소에 보이지 않던 것들이 보이기 시작한다.",
        position: { page: 3, offset: 0 },
        isFavorite: false,
      },
    ]);

    // ─── 8. My Collections ───
    console.log("  Creating personal collections...");

    const [minjiCollection1] = await tx
      .insert(myCollectionsTable)
      .values({
        ownerId: minji.id,
        name: "좋아하는 편지",
        description: "마음에 드는 편지들을 모아두는 곳",
        isPublic: false,
      })
      .returning();

    await tx.insert(myCollectionsTable).values({
      ownerId: minji.id,
      name: "영감",
      description: "글을 쓸 때 영감이 되는 것들",
      isPublic: false,
    });

    const [hayunCollection1] = await tx
      .insert(myCollectionsTable)
      .values({
        ownerId: hayun.id,
        name: "기억하고 싶은 글",
        description: "다시 읽고 싶은 편지들",
        isPublic: true,
      })
      .returning();

    await tx.insert(myCollectionArticlesTable).values([
      { myCollectionId: minjiCollection1.id, articleId: hayunLetter1.id },
      { myCollectionId: hayunCollection1.id, articleId: minjiLetter1.id },
    ]);

    // ─── 9. Team Collections ───
    console.log("  Creating team collections...");

    const [writingTeam] = await tx
      .insert(teamCollectionsTable)
      .values({
        name: "글쓰기 모임",
        description: "함께 글을 쓰고 나누는 모임",
        creatorId: minji.id,
      })
      .returning();

    const [readingTeam] = await tx
      .insert(teamCollectionsTable)
      .values({
        name: "독서 클럽",
        description: "좋은 글을 함께 읽는 모임",
        creatorId: hayun.id,
      })
      .returning();

    await tx.insert(teamCollectionMembershipsTable).values([
      { teamCollectionId: writingTeam.id, userId: minji.id, role: "OWNER" },
      { teamCollectionId: writingTeam.id, userId: hayun.id, role: "MEMBER" },
      { teamCollectionId: readingTeam.id, userId: hayun.id, role: "OWNER" },
      { teamCollectionId: readingTeam.id, userId: seojun.id, role: "MEMBER" },
    ]);

    await tx.insert(teamCollectionArticlesTable).values([
      { teamCollectionId: writingTeam.id, articleId: minjiLetter1.id, addedBy: minji.id },
      { teamCollectionId: writingTeam.id, articleId: hayunLetter1.id, addedBy: hayun.id },
    ]);
  });

  console.log("\n✅ Seed complete! Data summary:");
  console.log("  • 5 users (민지, 하윤, 서준, 지아, 도윤)");
  console.log("  • 2 neighbor pairs + 1 pending request");
  console.log("  • 11 articles (2 DRAFT, 1 DIVIDING, 1 CLOSING, 7 LETTER)");
  console.log("  • 6 inbox entries (various read/open states)");
  console.log("  • 6 send records");
  console.log("  • 2 completed reads + 1 in-progress reading record");
  console.log("  • 3 stored sentences (1 favorite)");
  console.log("  • 3 personal collections (2 with articles)");
  console.log("  • 2 team collections (1 with articles)");
}

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  });
