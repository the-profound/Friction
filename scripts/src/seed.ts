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
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_DESTRUCTIVE_SEED) {
    console.error("❌ Refusing to run seed in production. Set ALLOW_DESTRUCTIVE_SEED=true to override.");
    process.exit(1);
  }

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
        { id: "00000000-0000-4000-a000-000000000001", email: "minji@test.com", nickname: "민지" },
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
          content:
            "커피 한 잔을 마시며 창밖을 바라보았다. 봄이 오고 있었다. 나뭇가지 끝에 연둣빛 새순이 돋아나고 있었고, 그 모습이 어쩐지 마음을 간질였다. 오랫동안 잊고 있던 감각이 되살아나는 것 같았다. 겨울 내내 닫아두었던 창문을 오늘은 조금 열었다. 바람이 커튼을 살며시 밀어 올렸고, 그 안으로 흙냄새가 섞인 공기가 들어왔다. " +
            "아침을 이렇게 천천히 맞이한 게 얼마 만인지 모르겠다. 요즘은 매일 알람 소리에 쫓기듯 일어나 눈도 제대로 뜨지 못한 채 하루를 시작했다. 오늘은 달랐다. 핸드폰을 멀리 두고 그냥 앉아 있었다. 아무것도 하지 않는 시간이 이렇게 충만할 수 있다는 것을 잊고 살았다는 생각이 들었다. " +
            "창밖의 나무 한 그루가 유독 눈에 들어왔다. 겨우내 앙상했던 그 나무가 지금은 살아 움직이고 있었다. 나무는 아무것도 서두르지 않는다. 계절이 오면 꽃을 피우고, 계절이 가면 잎을 떨군다. 그 자연스러움이 오늘따라 부럽게 느껴졌다. 나는 언제부터 이렇게 스스로를 닦달하며 살게 된 걸까. " +
            "커피가 식어갔다. 그래도 괜찮았다. 식은 커피도 커피니까. 오늘 하루를 무엇으로 채울지 아직 정하지 않았지만, 이 아침만으로도 이미 충분히 좋은 날인 것 같다는 예감이 들었다. 봄이 오고 있다. 그것만으로 지금은 충분하다. " +
            "이 단상을 글로 남기고 싶었다. 쓰고 나면 사라지는 것들이 있어서, 쓰지 않으면 기억할 수 없을 것 같아서. 오늘 아침의 이 고요함을, 창밖의 나무를, 식어가는 커피의 온도를. 언젠가 다시 읽을 내가 이 순간을 기억해줬으면 한다. " +
            "봄은 매년 오지만, 오늘 아침의 봄은 오늘 한 번뿐이다. 그 사실이 새삼 소중하게 느껴진다. 앞으로도 이런 아침을 자주 가지고 싶다. 서두르지 않고, 커피 한 잔을 온전히 마시며, 창밖을 바라보는 그런 아침을.",
          status: "DRAFT" as const,
        },
        {
          authorId: minji.id,
          title: "긴 여행의 기록",
          content:
            "첫째 날, 기차에 올랐다. 차창 밖으로 펼쳐지는 풍경은 마치 한 폭의 수채화 같았다. 도시의 빌딩들이 점점 멀어지고, 넓은 들판이 나타났다. 옆자리 승객은 조용히 책을 읽고 있었고, 나는 그 모습을 보며 괜히 기분이 좋아졌다. 낯선 사람과 같은 기차를 타고 같은 방향으로 가고 있다는 사실이 묘하게 위안이 되었다. 기차는 리드미컬하게 흔들렸고, 그 흔들림에 몸을 맡기니 오랫동안 쌓인 피로가 조금씩 풀리는 것 같았다. " +
            "둘째 날, 작은 마을에 도착했다. 골목길마다 이야기가 숨어 있었다. 낡은 담벼락에 핀 들꽃, 반쯤 열린 창문 너머로 들려오는 라디오 소리. 오래된 빵집 앞을 지나치는데 갓 구운 빵 냄새가 나를 멈추게 했다. 주인 할머니는 나를 보고 환하게 웃으며 빵 한 조각을 건네주었다. 말이 통하지 않아도 따뜻함은 통했다. 그 마을의 시간은 내가 살던 곳보다 훨씬 천천히 흐르고 있었다. " +
            "셋째 날, 바다를 보았다. 끝없이 펼쳐진 수평선 앞에서 나는 한없이 작아졌다. 파도는 쉬지 않고 밀려왔다가 사라졌다. 발을 담갔더니 생각보다 차가웠지만, 그 차가움이 오히려 정신을 맑게 해주었다. 해가 지면서 바다가 붉게 물들었다. 그 순간, 아무 생각도 나지 않았다. 그냥 서 있었다. 그것만으로 충분했다. " +
            "넷째 날, 산에 올랐다. 정상에서 내려다본 세상은 고요했다. 올라오는 길은 힘들었다. 몇 번이나 포기하고 싶었다. 하지만 한 발씩 내딛다 보니 어느새 정상이었다. 힘든 길이 끝나는 순간이 있다는 것, 그걸 몸으로 배웠다. 구름이 발 아래 있었다. 그 광경을 보며 나는 조용히 울었다. 왜 울었는지 정확히 모르겠다. 그냥 눈물이 났다. " +
            "다섯째 날, 집으로 돌아왔다. 여행은 끝났지만, 마음속에는 새로운 길이 열려 있었다. 짐을 풀고 침대에 누웠을 때, 여행 중 만났던 장면들이 파노라마처럼 스쳐 지나갔다. 기차의 흔들림, 마을 할머니의 미소, 바다의 차가움, 구름 위의 침묵. 이 모든 것이 내 안에 새롭게 쌓였다. 여행을 마치고 돌아온 나는 떠나기 전의 나와 조금 다른 사람이 되어 있었다. " +
            "여행은 언제나 질문을 남긴다. 나는 어디서 왔고 어디로 가는가. 무엇이 나를 행복하게 하는가. 매일 바쁘게 살면서 잊고 있던 질문들이 여행 중에 떠올랐다. 아직 답을 찾지 못했지만, 질문을 품고 사는 것 자체가 의미 있다는 걸 이번 여행에서 배웠다. 다음 여행을 벌써 기다리고 있다.",
          status: "DRAFT" as const,
        },
        {
          authorId: minji.id,
          title: "비 오는 날의 생각들",
          content:
            "빗소리를 들으며 글을 쓴다. 비는 항상 무언가를 씻어내려 하는 것 같다. 먼지 쌓인 지붕 위로, 지친 도시의 거리 위로 내리는 빗물은 세상을 조금 더 깨끗하게 만든다. 창에 부딪히는 빗방울 소리가 일정한 리듬을 만들고, 나는 그 리듬에 맞춰 생각을 정리한다. 비 오는 날은 글이 잘 써진다. 외부의 소음이 빗소리로 가려지기 때문인지도 모른다. " +
            "우산 없이 걸었던 그 날의 기억이 떠오른다. 젖은 신발, 차가운 바람, 그리고 따뜻한 카페. 그날은 갑자기 비가 쏟아졌다. 예보에 없던 비였다. 처음엔 당황했지만, 곧 포기하고 그냥 맞으며 걸었다. 어차피 이미 젖었으니까. 그 순간 이상하게도 자유로운 느낌이 들었다. 젖는 것을 두려워하지 않게 되자 빗속 걷기가 즐거워졌다. " +
            "비는 기억을 소환한다. 비 냄새를 맡으면 어린 시절 뛰놀던 골목이 떠오른다. 엄마가 우산을 들고 학교 앞에서 기다리던 날들. 처마 밑에서 비를 피하며 지나가는 행인들을 구경하던 시간. 그때는 비가 내리면 세상이 잠시 멈추는 것 같았다. 모두가 어딘가에 들어가 비를 피했고, 세상은 잠깐 조용해졌다. " +
            "지금도 비는 세상을 잠시 멈추는 것 같다. 사람들이 발걸음을 빠르게 하거나, 처마 밑으로 뛰어들거나, 카페 안으로 들어가 창밖을 바라본다. 나는 오늘 창가 자리에 앉아 빗속을 걷는 사람들을 보고 있다. 저마다 다른 우산 색깔, 다른 종종걸음. 각자의 이야기를 품고 비를 헤치며 어딘가로 향하고 있다. " +
            "비가 그치면 세상은 달라진다. 공기는 맑아지고, 빗물에 씻긴 나뭇잎은 더욱 선명한 초록빛을 띤다. 아스팔트 위의 물웅덩이에 하늘이 비친다. 그 작은 웅덩이 속 하늘이 어쩐지 실제 하늘보다 더 아름답게 느껴질 때가 있다. 비 다음의 세상은 항상 조금 더 좋아진 것 같다. " +
            "오늘 비 덕분에 오래 쓰지 않았던 글을 다시 꺼냈다. 빗소리가 없었다면 아마 이 글은 오늘도 서랍 속에 잠들어 있었을 것이다. 비에게 고마운 마음이 든다. 앞으로도 비 오는 날이면 이렇게 창가에 앉아 글을 쓰고 싶다. 빗소리와 함께, 따뜻한 차 한 잔과 함께.",
          status: "DIVIDING" as const,
          pages: [
            "빗소리를 들으며 글을 쓴다. 비는 항상 무언가를 씻어내려 하는 것 같다. 먼지 쌓인 지붕 위로, 지친 도시의 거리 위로 내리는 빗물은 세상을 조금 더 깨끗하게 만든다. 창에 부딪히는 빗방울 소리가 일정한 리듬을 만들고, 나는 그 리듬에 맞춰 생각을 정리한다. 비 오는 날은 글이 잘 써진다. 외부의 소음이 빗소리로 가려지기 때문인지도 모른다.",
            "우산 없이 걸었던 그 날의 기억이 떠오른다. 젖은 신발, 차가운 바람, 그리고 따뜻한 카페. 그날은 갑자기 비가 쏟아졌다. 예보에 없던 비였다. 처음엔 당황했지만, 곧 포기하고 그냥 맞으며 걸었다. 어차피 이미 젖었으니까. 그 순간 이상하게도 자유로운 느낌이 들었다. 젖는 것을 두려워하지 않게 되자 빗속 걷기가 즐거워졌다.",
            "비는 기억을 소환한다. 비 냄새를 맡으면 어린 시절 뛰놀던 골목이 떠오른다. 엄마가 우산을 들고 학교 앞에서 기다리던 날들. 처마 밑에서 비를 피하며 지나가는 행인들을 구경하던 시간. 그때는 비가 내리면 세상이 잠시 멈추는 것 같았다. 모두가 어딘가에 들어가 비를 피했고, 세상은 잠깐 조용해졌다.",
            "지금도 비는 세상을 잠시 멈추는 것 같다. 사람들이 발걸음을 빠르게 하거나, 처마 밑으로 뛰어들거나, 카페 안으로 들어가 창밖을 바라본다. 나는 오늘 창가 자리에 앉아 빗속을 걷는 사람들을 보고 있다. 저마다 다른 우산 색깔, 다른 종종걸음. 각자의 이야기를 품고 비를 헤치며 어딘가로 향하고 있다.",
            "비가 그치면 세상은 달라진다. 공기는 맑아지고, 빗물에 씻긴 나뭇잎은 더욱 선명한 초록빛을 띤다. 아스팔트 위의 물웅덩이에 하늘이 비친다. 그 작은 웅덩이 속 하늘이 어쩐지 실제 하늘보다 더 아름답게 느껴질 때가 있다. 비 다음의 세상은 항상 조금 더 좋아진 것 같다.",
            "오늘 비 덕분에 오래 쓰지 않았던 글을 다시 꺼냈다. 빗소리가 없었다면 아마 이 글은 오늘도 서랍 속에 잠들어 있었을 것이다. 비에게 고마운 마음이 든다. 앞으로도 비 오는 날이면 이렇게 창가에 앉아 글을 쓰고 싶다. 빗소리와 함께, 따뜻한 차 한 잔과 함께.",
          ],
        },
        {
          authorId: minji.id,
          title: "시간의 무게",
          content:
            "시간은 가볍기도 하고 무겁기도 하다. 기다리는 시간은 늘 무겁고, 즐거운 시간은 가볍다. 왜 그럴까. 같은 한 시간인데 어떤 날은 영원처럼 느껴지고, 어떤 날은 눈 깜짝할 사이에 사라진다. 시간의 무게는 그 안에 담긴 감정의 무게인지도 모른다. 기쁨은 시간을 가볍게 하고, 불안은 시간을 무겁게 한다. " +
            "우리는 시간 위를 걸으며 살아간다. 발자국은 남지만, 되돌아갈 수는 없다. 지나온 시간을 되짚어보면 가슴이 먹먹해질 때가 있다. 더 잘 할 수 있었던 순간들, 말하지 못했던 것들, 붙잡지 못한 기회들. 하지만 그 모든 후회가 결국 지금의 나를 만들었다고 생각하면 조금은 위안이 된다. " +
            "어린 시절에는 시간이 무한하다고 생각했다. 여름 방학은 끝나지 않을 것 같았고, 어른이 되는 건 까마득히 먼 일처럼 느껴졌다. 그런데 언제부턴가 시간이 빠르게 흐르기 시작했다. 일 년이 눈 깜짝할 사이에 지나간다. 계절이 바뀌는 걸 느낄 새도 없다. 시간이 빨라진 게 아니라 내가 느끼는 능력을 잃어가고 있는 건 아닐까. " +
            "천천히 살고 싶다. 지금 이 순간을 충분히 느끼며 살고 싶다. 그러려면 어떻게 해야 할까. 아마도 덜 바빠야 할 것이다. 덜 걱정해야 할 것이다. 지금 내 앞에 있는 것에 집중해야 할 것이다. 과거를 후회하거나 미래를 걱정하는 데 쓰는 시간을 줄이고, 현재를 느끼는 데 쓰는 시간을 늘려야 한다. " +
            "시간은 누구에게나 공평하다. 하루 스물네 시간, 한 주 일곱 날, 그것은 모두에게 같다. 하지만 그 시간을 어떻게 채우느냐는 각자가 결정한다. 나는 내 시간을 잘 채우고 있는 걸까. 매일 밤 잠들기 전에 스스로에게 물어보고 싶다. 오늘 하루, 나는 충분히 살았는가. " +
            "시간의 무게를 느끼는 것 자체가 어쩌면 살아 있다는 증거다. 무감각하게 흘러가는 날들이 아니라, 기쁘거나 슬프거나 무거운 감정이 담긴 날들을 보내고 있다는 것. 그 감각을 잃지 않고 싶다. 시간이 무겁게 느껴질 때도, 가볍게 날아갈 때도, 그 감각을 온전히 느끼며 살고 싶다.",
          status: "CLOSING" as const,
          pages: [
            "시간은 가볍기도 하고 무겁기도 하다. 기다리는 시간은 늘 무겁고, 즐거운 시간은 가볍다. 왜 그럴까. 같은 한 시간인데 어떤 날은 영원처럼 느껴지고, 어떤 날은 눈 깜짝할 사이에 사라진다. 시간의 무게는 그 안에 담긴 감정의 무게인지도 모른다. 기쁨은 시간을 가볍게 하고, 불안은 시간을 무겁게 한다.",
            "우리는 시간 위를 걸으며 살아간다. 발자국은 남지만, 되돌아갈 수는 없다. 지나온 시간을 되짚어보면 가슴이 먹먹해질 때가 있다. 더 잘 할 수 있었던 순간들, 말하지 못했던 것들, 붙잡지 못한 기회들. 하지만 그 모든 후회가 결국 지금의 나를 만들었다고 생각하면 조금은 위안이 된다.",
            "어린 시절에는 시간이 무한하다고 생각했다. 여름 방학은 끝나지 않을 것 같았고, 어른이 되는 건 까마득히 먼 일처럼 느껴졌다. 그런데 언제부턴가 시간이 빠르게 흐르기 시작했다. 일 년이 눈 깜짝할 사이에 지나간다. 계절이 바뀌는 걸 느낄 새도 없다. 시간이 빨라진 게 아니라 내가 느끼는 능력을 잃어가고 있는 건 아닐까.",
            "천천히 살고 싶다. 지금 이 순간을 충분히 느끼며 살고 싶다. 그러려면 어떻게 해야 할까. 아마도 덜 바빠야 할 것이다. 덜 걱정해야 할 것이다. 지금 내 앞에 있는 것에 집중해야 할 것이다. 과거를 후회하거나 미래를 걱정하는 데 쓰는 시간을 줄이고, 현재를 느끼는 데 쓰는 시간을 늘려야 한다.",
            "시간은 누구에게나 공평하다. 하루 스물네 시간, 한 주 일곱 날, 그것은 모두에게 같다. 하지만 그 시간을 어떻게 채우느냐는 각자가 결정한다. 나는 내 시간을 잘 채우고 있는 걸까. 매일 밤 잠들기 전에 스스로에게 물어보고 싶다. 오늘 하루, 나는 충분히 살았는가.",
            "시간의 무게를 느끼는 것 자체가 어쩌면 살아 있다는 증거다. 무감각하게 흘러가는 날들이 아니라, 기쁘거나 슬프거나 무거운 감정이 담긴 날들을 보내고 있다는 것. 그 감각을 잃지 않고 싶다. 시간이 무겁게 느껴질 때도, 가볍게 날아갈 때도, 그 감각을 온전히 느끼며 살고 싶다.",
          ],
          style: { fontFamily: "serif", fontSize: 18, lineHeight: 1.8 },
        },
        {
          authorId: minji.id,
          title: "계절의 편지",
          content:
            "봄이 오면 항상 너에게 편지를 쓰고 싶어져. 벚꽃이 피는 길을 걸으며 생각했어. 올해도 어김없이 꽃이 피었는데, 네가 보고 싶더라. 지난해 이맘때 우리가 함께 걸었던 길을 혼자 걸었어. 같은 길인데 왜 이렇게 달라 보이는 건지. 사람이 달라지면 풍경도 달라 보이나 봐. " +
            "우리가 함께 걸었던 그 길, 아직도 그대로일까. 올해도 꽃은 피겠지. 그 카페도 아직 있을까. 우리가 앉았던 창가 자리도. 지나가다 들어가 볼까 생각했는데, 혼자는 왠지 발이 안 떨어지더라. 그냥 지나쳤어. 다음에 같이 가자. " +
            "봄은 항상 새로운 시작의 계절이라고들 하는데, 나는 봄이 오면 오히려 지난 것들이 더 선명하게 떠오르는 것 같아. 새로운 꽃이 피면서 지난 꽃들이 졌다는 게 더 실감나는 걸까. 그래서 봄이 좋기도 하고 조금 슬프기도 해. " +
            "너는 요즘 어떻게 지내? 잘 먹고, 잘 자고 있어? 마지막으로 연락했던 게 언제인지 기억이 안 날 정도로 시간이 많이 흘렀네. 그래도 네 생각은 계속 나. 좋은 날 좋은 것들을 보면 같이 보여주고 싶어서. " +
            "오늘 벚꽃 사진 몇 장 찍었어. 잘 나온 건지 모르겠어. 카메라 실력이 늘지를 않아. 그래도 보내줄게, 사진. 꽃이 지기 전에. 우리가 함께 있었던 봄을 기억하면서. " +
            "편지를 쓰다 보니 하고 싶은 말이 너무 많아. 이 편지가 너에게 잘 닿았으면 좋겠어. 봄처럼 따뜻하게. 멀리 있어도 마음은 가까이 있다는 것, 네가 알아줬으면 해.",
          status: "LETTER" as const,
          pages: [
            "봄이 오면 항상 너에게 편지를 쓰고 싶어져. 벚꽃이 피는 길을 걸으며 생각했어. 올해도 어김없이 꽃이 피었는데, 네가 보고 싶더라. 지난해 이맘때 우리가 함께 걸었던 길을 혼자 걸었어. 같은 길인데 왜 이렇게 달라 보이는 건지. 사람이 달라지면 풍경도 달라 보이나 봐.",
            "우리가 함께 걸었던 그 길, 아직도 그대로일까. 올해도 꽃은 피겠지. 그 카페도 아직 있을까. 우리가 앉았던 창가 자리도. 지나가다 들어가 볼까 생각했는데, 혼자는 왠지 발이 안 떨어지더라. 그냥 지나쳤어. 다음에 같이 가자.",
            "봄은 항상 새로운 시작의 계절이라고들 하는데, 나는 봄이 오면 오히려 지난 것들이 더 선명하게 떠오르는 것 같아. 새로운 꽃이 피면서 지난 꽃들이 졌다는 게 더 실감나는 걸까. 그래서 봄이 좋기도 하고 조금 슬프기도 해.",
            "너는 요즘 어떻게 지내? 잘 먹고, 잘 자고 있어? 마지막으로 연락했던 게 언제인지 기억이 안 날 정도로 시간이 많이 흘렀네. 그래도 네 생각은 계속 나. 좋은 날 좋은 것들을 보면 같이 보여주고 싶어서.",
            "오늘 벚꽃 사진 몇 장 찍었어. 잘 나온 건지 모르겠어. 카메라 실력이 늘지를 않아. 그래도 보내줄게, 사진. 꽃이 지기 전에. 우리가 함께 있었던 봄을 기억하면서.",
            "편지를 쓰다 보니 하고 싶은 말이 너무 많아. 이 편지가 너에게 잘 닿았으면 좋겠어. 봄처럼 따뜻하게. 멀리 있어도 마음은 가까이 있다는 것, 네가 알아줬으면 해.",
          ],
          style: { fontFamily: "serif", fontSize: 16, lineHeight: 1.6 },
          letterAt: daysAgo(5),
        },
        {
          authorId: minji.id,
          title: "밤하늘 아래서",
          content:
            "별을 세다 잠이 들었어. 꿈속에서도 별이 떠 있었어. 오늘 밤은 유독 하늘이 맑아서 별이 많이 보였거든. 도시에 사니까 평소엔 별 보기가 힘든데, 오늘은 정전이 있었는지 주변이 평소보다 어두웠어. 덕분에 오랜만에 별을 제대로 볼 수 있었어. " +
            "옥상에 올라갔어. 담요 하나 들고. 누워서 하늘을 올려다봤어. 처음엔 춥다고 생각했는데, 점점 적응이 되더라. 별자리를 찾으려 했는데 도통 모르겠더라고. 어릴 때 별자리 책을 읽었는데 다 잊어버렸나 봐. 그냥 별이 예쁘다는 것만 알았어. " +
            "별을 보면 왜 그렇게 많은 생각이 드는 걸까. 저 별들 중에 이미 사라진 별도 있다는 거, 우리가 보는 건 수천 년 전의 빛이라는 거. 그 사실이 오늘따라 유독 실감이 나더라. 지금 이 순간도 언젠가는 과거가 되겠지. 지금 내가 보는 하늘이 누군가에겐 기억 속 풍경이 될 거야. " +
            "너도 오늘 밤하늘을 봤을까. 우리가 같은 하늘 아래 있다는 게 가끔은 신기해. 거리는 멀어도 같은 별을 보고 있을 수 있다는 것. 그 생각을 하면 멀리 있는 것들이 조금 가깝게 느껴져. " +
            "한참을 누워 있다가 별 하나를 골랐어. 제일 밝게 빛나는 것으로. 그걸 너라고 생각하기로 했어. 엉뚱하지? 그래도 그 생각을 하니까 기분이 좋아졌어. 하늘 어딘가에 네가 있는 것 같아서. " +
            "꿈속에서도 별이 떠 있었어. 그 별 아래에서 우리가 같이 있었어. 꿈이라서 아쉬웠지만, 일어나서도 기분이 좋았어. 오늘 밤도 같은 꿈을 꿀 수 있었으면.",
          status: "LETTER" as const,
          pages: [
            "별을 세다 잠이 들었어. 꿈속에서도 별이 떠 있었어. 오늘 밤은 유독 하늘이 맑아서 별이 많이 보였거든. 도시에 사니까 평소엔 별 보기가 힘든데, 오늘은 정전이 있었는지 주변이 평소보다 어두웠어. 덕분에 오랜만에 별을 제대로 볼 수 있었어.",
            "옥상에 올라갔어. 담요 하나 들고. 누워서 하늘을 올려다봤어. 처음엔 춥다고 생각했는데, 점점 적응이 되더라. 별자리를 찾으려 했는데 도통 모르겠더라고. 어릴 때 별자리 책을 읽었는데 다 잊어버렸나 봐. 그냥 별이 예쁘다는 것만 알았어.",
            "별을 보면 왜 그렇게 많은 생각이 드는 걸까. 저 별들 중에 이미 사라진 별도 있다는 거, 우리가 보는 건 수천 년 전의 빛이라는 거. 그 사실이 오늘따라 유독 실감이 나더라. 지금 이 순간도 언젠가는 과거가 되겠지. 지금 내가 보는 하늘이 누군가에겐 기억 속 풍경이 될 거야.",
            "너도 오늘 밤하늘을 봤을까. 우리가 같은 하늘 아래 있다는 게 가끔은 신기해. 거리는 멀어도 같은 별을 보고 있을 수 있다는 것. 그 생각을 하면 멀리 있는 것들이 조금 가깝게 느껴져.",
            "한참을 누워 있다가 별 하나를 골랐어. 제일 밝게 빛나는 것으로. 그걸 너라고 생각하기로 했어. 엉뚱하지? 그래도 그 생각을 하니까 기분이 좋아졌어. 하늘 어딘가에 네가 있는 것 같아서.",
            "꿈속에서도 별이 떠 있었어. 그 별 아래에서 우리가 같이 있었어. 꿈이라서 아쉬웠지만, 일어나서도 기분이 좋았어. 오늘 밤도 같은 꿈을 꿀 수 있었으면.",
          ],
          style: { fontFamily: "sans-serif", fontSize: 14, lineHeight: 1.5 },
          letterAt: daysAgo(3),
        },
        {
          authorId: minji.id,
          title: "도시의 소리",
          content:
            "아침이면 새소리 대신 차 소리가 들린다. 하지만 그 사이로 가끔, 피아노 소리가 들려온다. 어디서 나는 소리인지 정확히 모르겠다. 위층인지, 옆 건물인지. 하지만 매일 아침 비슷한 시간에 들려온다. 그 소리를 들을 때마다 나는 하던 일을 멈추고 귀를 기울인다. " +
            "어디선가 누군가 연습하고 있는 거겠지. 그 불완전한 멜로디가 좋다. 틀리고 다시 시작하고, 또 틀리고 다시 시작하는. 그 반복 속에서 조금씩 나아지는 것이 느껴진다. 처음 들었을 때보다 지금은 훨씬 자연스럽게 흐른다. 어느 날은 막힘없이 끝까지 이어지기도 한다. 그럴 때 나는 마음속으로 박수를 친다. " +
            "완벽하지 않아서 더 따뜻한, 도시의 음악. 완성된 연주는 아름답지만, 연습 중인 연주에는 다른 종류의 아름다움이 있다. 노력하는 사람의 온기가 담겨 있는 것 같다. 실수하면서도 포기하지 않고 계속하는 사람의 이야기가 멜로디 안에 들어 있는 것 같다. " +
            "도시에는 수많은 소리가 있다. 자동차 경적, 공사장 소음, 사람들의 발소리와 목소리. 그 모든 소리가 뒤섞여 도시의 배경음악을 이룬다. 처음엔 시끄럽기만 했던 그 소리들이 이제는 익숙하고 어떤 면에서는 위안이 된다. 도시가 살아 있다는 증거니까. " +
            "오늘도 피아노 소리가 들려왔다. 새로운 곡인 것 같았다. 아직 서툴렀지만 분명히 아름다운 멜로디였다. 누군지 모를 그 사람이 연습을 멈추지 않기를 바랐다. 언젠가 창문을 열면 완성된 그 곡이 들려올 날이 오기를. " +
            "그 소리 덕분에 오늘 아침이 조금 특별해졌다. 평범한 도시의 아침이 음악이 있는 아침이 되었다. 나도 오늘 하루, 내가 할 수 있는 것들을 조금씩 연습해보려 한다. 틀려도 괜찮다. 다시 시작하면 되니까.",
          status: "LETTER" as const,
          pages: [
            "아침이면 새소리 대신 차 소리가 들린다. 하지만 그 사이로 가끔, 피아노 소리가 들려온다. 어디서 나는 소리인지 정확히 모르겠다. 위층인지, 옆 건물인지. 하지만 매일 아침 비슷한 시간에 들려온다. 그 소리를 들을 때마다 나는 하던 일을 멈추고 귀를 기울인다.",
            "어디선가 누군가 연습하고 있는 거겠지. 그 불완전한 멜로디가 좋다. 틀리고 다시 시작하고, 또 틀리고 다시 시작하는. 그 반복 속에서 조금씩 나아지는 것이 느껴진다. 처음 들었을 때보다 지금은 훨씬 자연스럽게 흐른다. 어느 날은 막힘없이 끝까지 이어지기도 한다. 그럴 때 나는 마음속으로 박수를 친다.",
            "완벽하지 않아서 더 따뜻한, 도시의 음악. 완성된 연주는 아름답지만, 연습 중인 연주에는 다른 종류의 아름다움이 있다. 노력하는 사람의 온기가 담겨 있는 것 같다. 실수하면서도 포기하지 않고 계속하는 사람의 이야기가 멜로디 안에 들어 있는 것 같다.",
            "도시에는 수많은 소리가 있다. 자동차 경적, 공사장 소음, 사람들의 발소리와 목소리. 그 모든 소리가 뒤섞여 도시의 배경음악을 이룬다. 처음엔 시끄럽기만 했던 그 소리들이 이제는 익숙하고 어떤 면에서는 위안이 된다. 도시가 살아 있다는 증거니까.",
            "오늘도 피아노 소리가 들려왔다. 새로운 곡인 것 같았다. 아직 서툴렀지만 분명히 아름다운 멜로디였다. 누군지 모를 그 사람이 연습을 멈추지 않기를 바랐다. 언젠가 창문을 열면 완성된 그 곡이 들려올 날이 오기를.",
            "그 소리 덕분에 오늘 아침이 조금 특별해졌다. 평범한 도시의 아침이 음악이 있는 아침이 되었다. 나도 오늘 하루, 내가 할 수 있는 것들을 조금씩 연습해보려 한다. 틀려도 괜찮다. 다시 시작하면 되니까.",
          ],
          style: { fontFamily: "serif", fontSize: 16, lineHeight: 1.7 },
          letterAt: daysAgo(1),
        },
        {
          authorId: hayun.id,
          title: "나의 작은 정원",
          content:
            "베란다에 작은 화분을 놓았어. 매일 물을 주며 말을 걸어. 식물에게 말을 거는 게 처음엔 어색했는데, 이제는 자연스러워졌어. 아침에 일어나면 제일 먼저 화분 앞으로 가서 잎 상태를 확인해. 잘 자랐나, 어디 상한 데는 없나. 그러다 보면 하루가 시작되는 것 같아. " +
            "식물도 외로움을 타는 걸까. 잎이 나를 향해 자라는 것 같아서 기분이 좋았어. 매일 말을 걸어서인지, 아니면 그냥 햇빛을 향해 자라는 건지 모르겠지만. 어쨌든 나는 그 믿음을 유지하기로 했어. 내 말을 듣고 자라고 있다는 믿음. " +
            "작은 것들이 주는 위로가 있어. 아무리 힘든 날에도 화분 앞에 앉아 잎을 만지면 마음이 조금 가라앉아. 살아 있는 것과 함께 있다는 감각. 내가 돌봐야 하는 존재가 있다는 것. 그게 생각보다 큰 힘이 돼. " +
            "처음 화분을 샀을 때는 걱정이 많았어. 식물을 잘 키울 수 있을까. 금방 죽이는 건 아닐까. 그런데 생각보다 식물은 강해. 조금 물을 못 줘도, 조금 추워도, 나름대로 버티더라고. 어쩌면 그 강인함에서도 위로를 받는 것 같아. " +
            "요즘은 화분이 두 개로 늘었어. 하나는 잎이 크고 진한 초록색인 것, 하나는 작고 연한 연둣빛인 것. 둘이 나란히 놓여 있으면 참 예뻐. 서로 다른 모양이지만 잘 어울려. 우리 같지 않아? " +
            "봄이 오면 화분을 밖에 내놓으려 해. 진짜 흙냄새와 바람을 맞으며 더 잘 자랐으면 해서. 그때 사진 찍어서 보여줄게. 작은 정원을 가진 베란다 사진. 너도 식물 하나 키워봐. 분명히 좋아할 거야.",
          status: "LETTER" as const,
          pages: [
            "베란다에 작은 화분을 놓았어. 매일 물을 주며 말을 걸어. 식물에게 말을 거는 게 처음엔 어색했는데, 이제는 자연스러워졌어. 아침에 일어나면 제일 먼저 화분 앞으로 가서 잎 상태를 확인해. 잘 자랐나, 어디 상한 데는 없나. 그러다 보면 하루가 시작되는 것 같아.",
            "식물도 외로움을 타는 걸까. 잎이 나를 향해 자라는 것 같아서 기분이 좋았어. 매일 말을 걸어서인지, 아니면 그냥 햇빛을 향해 자라는 건지 모르겠지만. 어쨌든 나는 그 믿음을 유지하기로 했어. 내 말을 듣고 자라고 있다는 믿음.",
            "작은 것들이 주는 위로가 있어. 아무리 힘든 날에도 화분 앞에 앉아 잎을 만지면 마음이 조금 가라앉아. 살아 있는 것과 함께 있다는 감각. 내가 돌봐야 하는 존재가 있다는 것. 그게 생각보다 큰 힘이 돼.",
            "처음 화분을 샀을 때는 걱정이 많았어. 식물을 잘 키울 수 있을까. 금방 죽이는 건 아닐까. 그런데 생각보다 식물은 강해. 조금 물을 못 줘도, 조금 추워도, 나름대로 버티더라고. 어쩌면 그 강인함에서도 위로를 받는 것 같아.",
            "요즘은 화분이 두 개로 늘었어. 하나는 잎이 크고 진한 초록색인 것, 하나는 작고 연한 연둣빛인 것. 둘이 나란히 놓여 있으면 참 예뻐. 서로 다른 모양이지만 잘 어울려. 우리 같지 않아?",
            "봄이 오면 화분을 밖에 내놓으려 해. 진짜 흙냄새와 바람을 맞으며 더 잘 자랐으면 해서. 그때 사진 찍어서 보여줄게. 작은 정원을 가진 베란다 사진. 너도 식물 하나 키워봐. 분명히 좋아할 거야.",
          ],
          style: { fontFamily: "serif", fontSize: 16, lineHeight: 1.6 },
          letterAt: daysAgo(7),
        },
        {
          authorId: hayun.id,
          title: "책 읽는 밤",
          content:
            "오래된 책장에서 책 한 권을 꺼냈어. 종이 냄새가 참 좋더라. 오래된 책에는 특유의 냄새가 있잖아. 새 책의 날카로운 냄새가 아니라, 시간이 스민 부드러운 냄새. 그 냄새를 맡으면 어쩐지 마음이 차분해져. " +
            "한 줄 한 줄 읽다 보니 새벽이 되어 있었어. 처음엔 한 챕터만 읽으려 했는데, 페이지를 넘길 때마다 멈출 수가 없었어. 이야기가 나를 붙잡고 있었거든. 등장인물들이 살아 있는 것처럼 느껴졌어. 그 사람들의 선택에 마음을 졸이고, 그들의 감정에 같이 울고 웃었어. " +
            "책을 읽는 동안은 시간이 다르게 흐르는 것 같아. 바깥의 소리가 멀어지고, 오직 글자들만 남아. 그 세계에 완전히 들어가는 경험. 요즘 그 경험을 자주 하지 못했는데, 오랜만에 제대로 빠져들었어. " +
            "좋은 문장을 만나면 멈추게 돼. 다시 읽고, 또 읽고. 어떻게 이런 말을 생각해냈을까 감탄하면서. 오늘도 그런 문장이 몇 개 있었어. 메모해뒀어. 나중에 너한테도 알려줄게. " +
            "새벽 두 시에 책을 덮었어. 마지막 페이지를 읽고 나서 한동안 멍하니 있었어. 이야기가 끝났는데 마음속에서는 아직 끝나지 않은 것 같은 기분. 좋은 책을 읽은 후의 그 여운이 참 좋아. " +
            "너도 요즘 책 읽고 있어? 같이 읽고 이야기 나누고 싶다. 같은 책을 읽고 서로 다른 곳에서 다른 감상을 나누는 게 재미있잖아. 다음에 책 한 권 추천해줄게. 오늘 밤 내가 읽은 이 책으로.",
          status: "LETTER" as const,
          pages: [
            "오래된 책장에서 책 한 권을 꺼냈어. 종이 냄새가 참 좋더라. 오래된 책에는 특유의 냄새가 있잖아. 새 책의 날카로운 냄새가 아니라, 시간이 스민 부드러운 냄새. 그 냄새를 맡으면 어쩐지 마음이 차분해져.",
            "한 줄 한 줄 읽다 보니 새벽이 되어 있었어. 처음엔 한 챕터만 읽으려 했는데, 페이지를 넘길 때마다 멈출 수가 없었어. 이야기가 나를 붙잡고 있었거든. 등장인물들이 살아 있는 것처럼 느껴졌어. 그 사람들의 선택에 마음을 졸이고, 그들의 감정에 같이 울고 웃었어.",
            "책을 읽는 동안은 시간이 다르게 흐르는 것 같아. 바깥의 소리가 멀어지고, 오직 글자들만 남아. 그 세계에 완전히 들어가는 경험. 요즘 그 경험을 자주 하지 못했는데, 오랜만에 제대로 빠져들었어.",
            "좋은 문장을 만나면 멈추게 돼. 다시 읽고, 또 읽고. 어떻게 이런 말을 생각해냈을까 감탄하면서. 오늘도 그런 문장이 몇 개 있었어. 메모해뒀어. 나중에 너한테도 알려줄게.",
            "새벽 두 시에 책을 덮었어. 마지막 페이지를 읽고 나서 한동안 멍하니 있었어. 이야기가 끝났는데 마음속에서는 아직 끝나지 않은 것 같은 기분. 좋은 책을 읽은 후의 그 여운이 참 좋아.",
            "너도 요즘 책 읽고 있어? 같이 읽고 이야기 나누고 싶다. 같은 책을 읽고 서로 다른 곳에서 다른 감상을 나누는 게 재미있잖아. 다음에 책 한 권 추천해줄게. 오늘 밤 내가 읽은 이 책으로.",
          ],
          style: { fontFamily: "serif", fontSize: 16, lineHeight: 1.6 },
          letterAt: daysAgo(2),
        },
        {
          authorId: seojun.id,
          title: "산책의 기술",
          content:
            "좋은 산책에는 기술이 필요하다. 첫째, 목적지를 정하지 않는다. 목적지가 없으면 어디로든 갈 수 있고, 어디서든 멈출 수 있다. 발이 가는 곳으로 가면 된다. 그게 산책의 자유다. 계획 없는 걷기는 계획 없는 여행처럼 때로 최고의 발견을 선물한다. " +
            "둘째, 시계를 보지 않는다. 시간을 의식하는 순간 산책은 이동이 된다. 몇 시까지 돌아가야 한다는 생각이 있으면 걸음이 빨라진다. 걸음이 빨라지면 주변이 안 보인다. 산책은 속도가 아니라 감각의 문제다. " +
            "셋째, 발걸음을 느리게 한다. 그러면 평소에 보이지 않던 것들이 보이기 시작한다. 그 골목에 고양이가 살고 있었다는 것, 담벼락에 작은 벽화가 그려져 있다는 것, 어느 집 창가에 화분이 가득하다는 것. 빠르게 지나쳤을 때는 전혀 몰랐던 것들이 보인다. " +
            "넷째, 혼자 걷는 것을 두려워하지 않는다. 혼자 걷는 산책은 외롭지 않다. 오히려 더 많이 생각하고, 더 많이 볼 수 있다. 동행이 있으면 대화에 집중하느라 길을 보지 못할 때가 있다. 혼자 걷는 시간은 스스로와 대화하는 시간이다. " +
            "다섯째, 걷다가 멈추는 것을 망설이지 않는다. 예쁜 것이 보이면 멈추고, 냄새가 좋으면 그 자리에 서 있으면 된다. 벤치가 보이면 앉아도 된다. 산책은 목표가 없는 시간이니까 멈춤도 산책의 일부다. " +
            "이 기술들을 모두 갖추면 어떤 길도 산책이 된다. 집 앞 골목도, 복잡한 시장 골목도, 공원의 흙길도. 걷는 것이 즐거워지면 세상이 조금 달라 보인다. 오늘도 나는 걸으러 나간다.",
          status: "LETTER" as const,
          pages: [
            "좋은 산책에는 기술이 필요하다. 첫째, 목적지를 정하지 않는다. 목적지가 없으면 어디로든 갈 수 있고, 어디서든 멈출 수 있다. 발이 가는 곳으로 가면 된다. 그게 산책의 자유다. 계획 없는 걷기는 계획 없는 여행처럼 때로 최고의 발견을 선물한다.",
            "둘째, 시계를 보지 않는다. 시간을 의식하는 순간 산책은 이동이 된다. 몇 시까지 돌아가야 한다는 생각이 있으면 걸음이 빨라진다. 걸음이 빨라지면 주변이 안 보인다. 산책은 속도가 아니라 감각의 문제다.",
            "셋째, 발걸음을 느리게 한다. 그러면 평소에 보이지 않던 것들이 보이기 시작한다. 그 골목에 고양이가 살고 있었다는 것, 담벼락에 작은 벽화가 그려져 있다는 것, 어느 집 창가에 화분이 가득하다는 것. 빠르게 지나쳤을 때는 전혀 몰랐던 것들이 보인다.",
            "넷째, 혼자 걷는 것을 두려워하지 않는다. 혼자 걷는 산책은 외롭지 않다. 오히려 더 많이 생각하고, 더 많이 볼 수 있다. 동행이 있으면 대화에 집중하느라 길을 보지 못할 때가 있다. 혼자 걷는 시간은 스스로와 대화하는 시간이다.",
            "다섯째, 걷다가 멈추는 것을 망설이지 않는다. 예쁜 것이 보이면 멈추고, 냄새가 좋으면 그 자리에 서 있으면 된다. 벤치가 보이면 앉아도 된다. 산책은 목표가 없는 시간이니까 멈춤도 산책의 일부다.",
            "이 기술들을 모두 갖추면 어떤 길도 산책이 된다. 집 앞 골목도, 복잡한 시장 골목도, 공원의 흙길도. 걷는 것이 즐거워지면 세상이 조금 달라 보인다. 오늘도 나는 걸으러 나간다.",
          ],
          style: { fontFamily: "sans-serif", fontSize: 15, lineHeight: 1.6 },
          letterAt: daysAgo(4),
        },
        {
          authorId: hayun.id,
          title: "메모: 내일 할 일",
          content:
            "빨래하기, 장보기, 편지 쓰기. 오늘 미루었던 것들을 내일은 꼭 해야 한다. 빨래통이 이미 넘칠 지경이고, 냉장고는 거의 비어 있다. 편지는 한 달째 쓰다 만 채로 책상 위에 놓여 있다. 내일은 무조건 다 한다. 그리고 산책도 한 번 나가고, 오랫동안 연락 못 한 친구에게 전화도 해야겠다. 작은 것들을 하나씩 해나가다 보면 기분도 나아지겠지. 내일의 나에게 미리 응원을 보낸다.",
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
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Seed failed:", err);
    await pool.end();
    process.exit(1);
  });
