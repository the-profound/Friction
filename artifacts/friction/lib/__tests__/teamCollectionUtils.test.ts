import { describe, it, expect } from "vitest";
import {
  toKstDateKey,
  toKstCalendarDateKey,
  formatDateLabel,
  buildTeamArticleRows,
  type TeamArticleListRow,
} from "../teamCollectionUtils";
import type { TeamCollectionArticleWithDetails } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 1;
function makeArticle(
  overrides: Partial<TeamCollectionArticleWithDetails> & {
    title?: string;
    isNotice?: boolean;
    noticeDate?: string;
    sourceArticleId?: string | null;
  } = {},
): TeamCollectionArticleWithDetails {
  const id = `art-${_seq++}`;
  const { title, isNotice, noticeDate, sourceArticleId, ...rest } = overrides;
  return {
    id,
    teamCollectionId: "col-1",
    articleId: id,
    addedBy: "user-1",
    addedAt: "2026-04-25T09:00:00.000Z",
    visibleAt: "2026-04-25T09:00:00.000Z",
    sourceArticleId: sourceArticleId ?? null,
    parentInThisCollection: false,
    isDeletedPlaceholder: false,
    article: {
      id,
      authorId: "user-1",
      title: title ?? "글 제목",
      content: "{}",
      status: "LETTER",
      coverImageIds: [],
      isNotice: isNotice ?? false,
      noticeDate: noticeDate ?? null,
      sourceArticleId: sourceArticleId ?? null,
      createdAt: "2026-04-25T09:00:00.000Z",
      updatedAt: "2026-04-25T09:00:00.000Z",
    } as NonNullable<TeamCollectionArticleWithDetails["article"]>,
    ...rest,
  };
}

function articleIds(rows: TeamArticleListRow[]): string[] {
  return rows
    .filter((r): r is Extract<TeamArticleListRow, { type: "article" }> => r.type === "article")
    .map((r) => r.item.articleId);
}

function indents(rows: TeamArticleListRow[]): boolean[] {
  return rows
    .filter((r): r is Extract<TeamArticleListRow, { type: "article" }> => r.type === "article")
    .map((r) => r.indent);
}

// ---------------------------------------------------------------------------
// toKstDateKey
// ---------------------------------------------------------------------------

describe("toKstDateKey", () => {
  it("그룹은 KST 18:00 미만이면 당일", () => {
    // 2026-04-27 08:59 KST = 2026-04-26 23:59 UTC
    expect(toKstDateKey("2026-04-26T23:59:00.000Z")).toBe("2026-04-27");
  });

  it("KST 18:00 이상이면 다음 날 그룹", () => {
    // 2026-04-27 18:00 KST = 2026-04-27 09:00 UTC
    expect(toKstDateKey("2026-04-27T09:00:00.000Z")).toBe("2026-04-28");
  });

  it("KST 정확히 18:00이면 다음 날 그룹", () => {
    // 2026-04-25 18:00 KST = 2026-04-25 09:00 UTC
    expect(toKstDateKey("2026-04-25T09:00:00.000Z")).toBe("2026-04-26");
  });

  it("KST 17:59이면 당일 그룹", () => {
    // 2026-04-25 17:59 KST = 2026-04-25 08:59 UTC
    expect(toKstDateKey("2026-04-25T08:59:00.000Z")).toBe("2026-04-25");
  });
});

// ---------------------------------------------------------------------------
// buildTeamArticleRows — 기본 정렬
// ---------------------------------------------------------------------------

describe("buildTeamArticleRows — 기본 정렬", () => {
  it("빈 배열 → 빈 배열", () => {
    expect(buildTeamArticleRows([])).toEqual([]);
  });

  it("날짜 헤더가 각 그룹 앞에 삽입된다", () => {
    const a1 = makeArticle({ visibleAt: "2026-04-25T09:00:00.000Z", addedAt: "2026-04-25T09:00:00.000Z" });
    const a2 = makeArticle({ visibleAt: "2026-04-26T09:00:00.000Z", addedAt: "2026-04-26T09:00:00.000Z" });
    const rows = buildTeamArticleRows([a1, a2]);
    const headers = rows.filter((r) => r.type === "header");
    expect(headers).toHaveLength(2);
  });

  it("같은 날 내에서 visibleAt 내림차순 정렬", () => {
    const earlier = makeArticle({ visibleAt: "2026-04-25T05:00:00.000Z", addedAt: "2026-04-25T05:00:00.000Z", title: "이른글" });
    const later = makeArticle({ visibleAt: "2026-04-25T07:00:00.000Z", addedAt: "2026-04-25T07:00:00.000Z", title: "늦은글" });
    const rows = buildTeamArticleRows([earlier, later]);
    const ids = articleIds(rows);
    expect(ids[0]).toBe(later.articleId);
    expect(ids[1]).toBe(earlier.articleId);
  });
});

// ---------------------------------------------------------------------------
// buildTeamArticleRows — 공지(notice) 우선 정렬
// ---------------------------------------------------------------------------

describe("buildTeamArticleRows — 공지 우선", () => {
  it("공지글은 같은 날 최상단에 위치한다", () => {
    // visibleAt KST 18:00 → 컷오프 없이 당일(4/25) 그룹
    const dateKey = "2026-04-25";
    const visibleAt = "2026-04-25T09:00:00.000Z"; // KST 18:00 → 달력 기준 당일(4/25) 그룹

    const regular = makeArticle({ visibleAt, addedAt: visibleAt, title: "일반글" });
    const notice = makeArticle({
      visibleAt,
      addedAt: visibleAt,
      title: "오늘의 인사",
      isNotice: true,
      noticeDate: dateKey,
      article: undefined,
    });
    notice.article = {
      id: notice.articleId,
      authorId: "user-1",
      title: "오늘의 인사",
      content: "{}",
      status: "LETTER",
      coverImageIds: [],
      isNotice: true,
      noticeDate: dateKey,
      sourceArticleId: null,
      createdAt: visibleAt,
      updatedAt: visibleAt,
    } as NonNullable<TeamCollectionArticleWithDetails["article"]>;

    const rows = buildTeamArticleRows([regular, notice]);
    const ids = articleIds(rows);
    expect(ids[0]).toBe(notice.articleId);
    expect(ids[1]).toBe(regular.articleId);
  });

  it("공지에 대한 답장은 공지 바로 아래에 들여쓰기로 나타난다", () => {
    // visibleAt KST 18:00 → 컷오프 없이 당일(4/25) 그룹
    const dateKey = "2026-04-25";
    const visibleAt = "2026-04-25T09:00:00.000Z";

    const notice = makeArticle({
      visibleAt,
      addedAt: visibleAt,
      title: "오늘의 인사",
    });
    notice.article!.isNotice = true;
    notice.article!.noticeDate = dateKey;

    const replyToNotice = makeArticle({
      visibleAt,
      addedAt: visibleAt,
      title: "공지 답장",
      sourceArticleId: notice.articleId,
      parentInThisCollection: true,
    });
    replyToNotice.article!.sourceArticleId = notice.articleId;

    const rows = buildTeamArticleRows([notice, replyToNotice]);
    const ids = articleIds(rows);
    const ind = indents(rows);

    expect(ids[0]).toBe(notice.articleId);
    expect(ids[1]).toBe(replyToNotice.articleId);
    expect(ind[0]).toBe(false);
    expect(ind[1]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildTeamArticleRows — 답장 스레딩
// ---------------------------------------------------------------------------

describe("buildTeamArticleRows — 답장 스레딩", () => {
  it("답장은 원글 바로 아래 들여쓰기로 위치한다", () => {
    const visibleAt = "2026-04-25T05:00:00.000Z";

    const parent = makeArticle({ visibleAt, addedAt: visibleAt, title: "원글" });
    const reply = makeArticle({
      visibleAt,
      addedAt: visibleAt,
      title: "답장",
      sourceArticleId: parent.articleId,
      parentInThisCollection: true,
    });
    reply.article!.sourceArticleId = parent.articleId;

    const other = makeArticle({ visibleAt, addedAt: visibleAt, title: "다른글" });

    const rows = buildTeamArticleRows([parent, reply, other]);
    const ids = articleIds(rows);

    expect(ids.indexOf(reply.articleId)).toBe(ids.indexOf(parent.articleId) + 1);
    expect(indents(rows)[ids.indexOf(reply.articleId)]).toBe(true);
  });

  it("답장의 답장(재답장)도 1단계 들여쓰기, 원글→답장→재답장 순서", () => {
    const visibleAt = "2026-04-25T05:00:00.000Z";

    const parent = makeArticle({ visibleAt, addedAt: visibleAt, title: "원글" });
    const reply = makeArticle({
      visibleAt,
      addedAt: visibleAt,
      title: "답장",
      sourceArticleId: parent.articleId,
      parentInThisCollection: true,
    });
    reply.article!.sourceArticleId = parent.articleId;

    const reReply = makeArticle({
      visibleAt,
      addedAt: visibleAt,
      title: "재답장",
      sourceArticleId: reply.articleId,
      parentInThisCollection: true,
    });
    reReply.article!.sourceArticleId = reply.articleId;

    const rows = buildTeamArticleRows([parent, reply, reReply]);
    const ids = articleIds(rows);

    const pi = ids.indexOf(parent.articleId);
    const ri = ids.indexOf(reply.articleId);
    const rri = ids.indexOf(reReply.articleId);

    expect(pi).toBeLessThan(ri);
    expect(ri).toBeLessThan(rri);
    expect(indents(rows)[ri]).toBe(true);
    expect(indents(rows)[rri]).toBe(true);
  });

  it("부모가 다른 날짜 그룹에 있는 답장도 원글 바로 아래 들여쓰기로 붙는다 (크로스 날짜)", () => {
    const parentVisibleAt = "2026-04-25T05:00:00.000Z"; // 4/25 그룹
    const replyVisibleAt = "2026-04-26T05:00:00.000Z";  // 4/26이지만 원글 아래로 이동

    const parent = makeArticle({ visibleAt: parentVisibleAt, addedAt: parentVisibleAt, title: "원글" });
    const crossGroupReply = makeArticle({
      visibleAt: replyVisibleAt,
      addedAt: replyVisibleAt,
      title: "다른 날짜 답장",
      sourceArticleId: parent.articleId,
      parentInThisCollection: true,
    });
    crossGroupReply.article!.sourceArticleId = parent.articleId;

    const rows = buildTeamArticleRows([parent, crossGroupReply]);
    const ids = articleIds(rows);

    // 두 글 모두 포함
    expect(ids).toContain(parent.articleId);
    expect(ids).toContain(crossGroupReply.articleId);
    // 답장은 원글 바로 다음에 위치
    expect(ids.indexOf(crossGroupReply.articleId)).toBe(ids.indexOf(parent.articleId) + 1);
    // 답장은 들여쓰기됨
    expect(indents(rows)[ids.indexOf(crossGroupReply.articleId)]).toBe(true);
    // 날짜 헤더는 원글 날짜(4/25) 하나만 존재 (4/26 헤더 없음)
    const headers = rows.filter((r) => r.type === "header");
    expect(headers).toHaveLength(1);
    expect((headers[0] as Extract<typeof headers[0], { type: "header" }>).dateKey).toBe("2026-04-25");
  });
});

// ---------------------------------------------------------------------------
// buildTeamArticleRows — soft-delete placeholder
// ---------------------------------------------------------------------------

describe("buildTeamArticleRows — soft-delete placeholder", () => {
  it("placeholder는 최상위 row로 렌더링된다", () => {
    const visibleAt = "2026-04-25T05:00:00.000Z";

    // soft-delete placeholder는 inbox row가 없으므로 visibleAt = null;
    // addedAt 기준으로 dateKey가 결정된다.
    const placeholder = makeArticle({
      visibleAt: null,
      addedAt: visibleAt,
      title: "삭제됨",
      isDeletedPlaceholder: true,
    });
    const reply = makeArticle({
      visibleAt,
      addedAt: visibleAt,
      title: "삭제된 원글에 대한 답장",
      sourceArticleId: placeholder.articleId,
      parentInThisCollection: true,
    });
    reply.article!.sourceArticleId = placeholder.articleId;

    const rows = buildTeamArticleRows([placeholder, reply]);
    const ids = articleIds(rows);

    expect(ids).toContain(placeholder.articleId);
    expect(ids).toContain(reply.articleId);
    expect(indents(rows)[ids.indexOf(placeholder.articleId)]).toBe(false);
    expect(indents(rows)[ids.indexOf(reply.articleId)]).toBe(true);
  });

  it("모든 글은 반드시 결과에 포함된다 (드롭 없음)", () => {
    const visibleAt = "2026-04-25T05:00:00.000Z";
    const articles = Array.from({ length: 5 }, (_, i) =>
      makeArticle({ visibleAt, addedAt: visibleAt, title: `글 ${i}` }),
    );

    const rows = buildTeamArticleRows(articles);
    const ids = articleIds(rows);
    for (const a of articles) {
      expect(ids).toContain(a.articleId);
    }
  });
});

// ---------------------------------------------------------------------------
// toKstCalendarDateKey — 18:00 컷오프 없는 순수 KST 달력 날짜
// ---------------------------------------------------------------------------

describe("toKstCalendarDateKey", () => {
  it("KST 18:00 이후에도 당일 날짜를 반환한다", () => {
    // 2026-04-27 18:26 KST = 2026-04-27 09:26 UTC
    expect(toKstCalendarDateKey("2026-04-27T09:26:00.000Z")).toBe("2026-04-27");
  });

  it("KST 정각 18:00에도 당일 날짜를 반환한다", () => {
    // 2026-04-25 18:00 KST = 2026-04-25 09:00 UTC
    expect(toKstCalendarDateKey("2026-04-25T09:00:00.000Z")).toBe("2026-04-25");
  });

  it("KST 23:59에도 당일 날짜를 반환한다", () => {
    // 2026-04-25 23:59 KST = 2026-04-25 14:59 UTC
    expect(toKstCalendarDateKey("2026-04-25T14:59:00.000Z")).toBe("2026-04-25");
  });

  it("KST 00:00 직전(UTC 전날 14:59)은 전날 날짜", () => {
    // 2026-04-24 23:59 KST = 2026-04-24 14:59 UTC
    expect(toKstCalendarDateKey("2026-04-24T14:59:00.000Z")).toBe("2026-04-24");
  });
});

// ---------------------------------------------------------------------------
// buildTeamArticleRows — visibleAt=null, addedAt KST 18:00 이후 fallback
// ---------------------------------------------------------------------------

describe("buildTeamArticleRows — addedAt fallback, KST 18:00 이후", () => {
  it("visibleAt=null이고 addedAt이 KST 18:26이면 당일 그룹에 속한다", () => {
    // addedAt: 2026-04-27 18:26 KST = 2026-04-27 09:26 UTC → 그룹은 "2026-04-27"
    const placeholder = makeArticle({
      visibleAt: null,
      addedAt: "2026-04-27T09:26:00.000Z",
      title: "18시 이후 추가됨",
      isDeletedPlaceholder: true,
    });

    const rows = buildTeamArticleRows([placeholder]);
    const headers = rows.filter((r) => r.type === "header");
    expect(headers).toHaveLength(1);
    expect((headers[0] as Extract<typeof headers[0], { type: "header" }>).dateKey).toBe("2026-04-27");
  });

  it("visibleAt=null, addedAt KST 18:26인 글은 '내일' 그룹이 아닌 당일 그룹에 배치된다", () => {
    // 18:00 컷오프가 잘못 적용되면 2026-04-28 그룹으로 넘어가서 diffDays = -1이 됨
    const addedAt = "2026-04-27T09:26:00.000Z"; // 2026-04-27 18:26 KST

    const placeholder = makeArticle({
      visibleAt: null,
      addedAt,
      title: "삭제됨 — 18:26 추가",
      isDeletedPlaceholder: true,
    });

    const rows = buildTeamArticleRows([placeholder]);
    const header = rows.find((r) => r.type === "header") as Extract<typeof rows[0], { type: "header" }> | undefined;
    expect(header).toBeDefined();
    // 그룹 dateKey가 addedAt의 KST 달력 날짜와 일치해야 함
    expect(header!.dateKey).toBe("2026-04-27");
    // 다음 날 그룹(2026-04-28)으로 밀리지 않아야 함
    expect(header!.dateKey).not.toBe("2026-04-28");
  });

  it("visibleAt이 있어도 18:00 컷오프가 적용되지 않고 당일 그룹에 배치된다", () => {
    // 2026-04-27 18:00 KST = 2026-04-27 09:00 UTC → 컷오프 없이 당일(2026-04-27) 그룹
    const article = makeArticle({
      visibleAt: "2026-04-27T09:00:00.000Z",
      addedAt: "2026-04-27T09:00:00.000Z",
      title: "visibleAt 있음",
    });

    const rows = buildTeamArticleRows([article]);
    const header = rows.find((r) => r.type === "header") as Extract<typeof rows[0], { type: "header" }> | undefined;
    expect(header).toBeDefined();
    expect(header!.dateKey).toBe("2026-04-27");
    // 다음 날 그룹으로 밀리지 않아야 함
    expect(header!.dateKey).not.toBe("2026-04-28");
  });
});

// ---------------------------------------------------------------------------
// buildTeamArticleRows — visibleAt 정각 18:00 KST 당일 그룹핑 (버그 재현 방지)
// ---------------------------------------------------------------------------

describe("buildTeamArticleRows — visibleAt 정각 18:00 KST 당일 그룹", () => {
  it("visibleAt이 정각 18:00 KST이면 당일 그룹에 배치된다 ('-1일 전' 없음)", () => {
    // 2026-04-25 18:00:00 KST = 2026-04-25 09:00:00 UTC
    // 수정 전: toKstDateKey → "2026-04-26"(다음 날), diffDays = -1 → "-1일 전" 버그
    // 수정 후: toKstCalendarDateKey → "2026-04-25"(당일) → "오늘" 또는 날짜 라벨
    const article = makeArticle({
      visibleAt: "2026-04-25T09:00:00.000Z",
      addedAt: "2026-04-25T09:00:00.000Z",
      title: "18:00 정각 배달",
    });

    const rows = buildTeamArticleRows([article]);
    const header = rows.find((r) => r.type === "header") as Extract<typeof rows[0], { type: "header" }> | undefined;
    expect(header).toBeDefined();
    // 당일(2026-04-25) 그룹에 배치되어야 한다
    expect(header!.dateKey).toBe("2026-04-25");
    // 다음 날(2026-04-26) 그룹으로 밀리지 않아야 한다
    expect(header!.dateKey).not.toBe("2026-04-26");
  });

  it("어제 18:00 KST에 배달된 글은 어제 그룹에 배치된다", () => {
    // 2026-04-24 18:00:00 KST = 2026-04-24 09:00:00 UTC
    const article = makeArticle({
      visibleAt: "2026-04-24T09:00:00.000Z",
      addedAt: "2026-04-24T09:00:00.000Z",
      title: "어제 18:00 배달",
    });

    const rows = buildTeamArticleRows([article]);
    const header = rows.find((r) => r.type === "header") as Extract<typeof rows[0], { type: "header" }> | undefined;
    expect(header).toBeDefined();
    expect(header!.dateKey).toBe("2026-04-24");
    expect(header!.dateKey).not.toBe("2026-04-25");
  });
});
