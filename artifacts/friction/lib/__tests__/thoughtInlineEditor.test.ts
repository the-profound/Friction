import { describe, expect, it } from "vitest";
import {
  formatReadingThoughtQuote,
  getThoughtInlineCommitAction,
  isCurrentOptimisticRequest,
  mergeReadingThoughtsById,
  type OptimisticReadingThought,
} from "../thoughtInlineEditor";

describe("inline reading thought lifecycle", () => {
  it("discards an empty new card without creating a thought", () => {
    expect(getThoughtInlineCommitAction({
      isExisting: false,
      text: " \n ",
      initialText: "",
    })).toBe("discard-new");
  });

  it("deletes an existing thought when its card is emptied", () => {
    expect(getThoughtInlineCommitAction({
      isExisting: true,
      text: "",
      initialText: "기존 단상",
    })).toBe("delete");
  });

  it("distinguishes changed and unchanged existing thoughts", () => {
    expect(getThoughtInlineCommitAction({
      isExisting: true,
      text: "수정한 단상",
      initialText: "기존 단상",
    })).toBe("update");
    expect(getThoughtInlineCommitAction({
      isExisting: true,
      text: " 기존 단상 ",
      initialText: "기존 단상",
    })).toBe("unchanged");
  });

  it("formats selected text and its source in the new inline card", () => {
    expect(formatReadingThoughtQuote("첫 줄\n둘째 줄", "작가, 제목, 2면"))
      .toBe("> 첫 줄\n> 둘째 줄\n\n— 작가, 제목, 2면");
  });

  const optimistic = (
    overrides: Partial<OptimisticReadingThought> = {},
  ): OptimisticReadingThought => ({
    id: "client-thought",
    content: "응답을 기다리지 않는 단상",
    createdAt: "2026-09-04T00:00:00.000Z",
    saveState: "pending",
    requestGeneration: 1,
    ...overrides,
  });

  it("keeps a pending optimistic card visible during an empty refetch", () => {
    expect(mergeReadingThoughtsById([], [optimistic()])).toEqual([optimistic()]);
  });

  it("reconciles a server response with the same client ID without duplication", () => {
    const serverThought = {
      id: "client-thought",
      content: "서버 단상",
      createdAt: "2026-09-04T00:00:01.000Z",
    };
    const merged = mergeReadingThoughtsById([serverThought], [optimistic()]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "client-thought", saveState: "pending" });
  });

  it("preserves failed content for a same-ID retry", () => {
    const failed = optimistic({
      saveState: "failed",
      error: "저장하지 못했어요. 다시 시도해 주세요.",
    });
    expect(mergeReadingThoughtsById([], [failed])).toEqual([failed]);
    expect(failed.id).toBe("client-thought");
  });

  it("rejects a late response after a newer retry generation starts", () => {
    const retrying = optimistic({ requestGeneration: 2 });
    expect(isCurrentOptimisticRequest(retrying, 1)).toBe(false);
    expect(isCurrentOptimisticRequest(retrying, 2)).toBe(true);
  });

  it("keeps a confirmed local fence visible until a server refetch contains its ID", () => {
    const confirmed = optimistic({ saveState: "confirmed" });
    expect(mergeReadingThoughtsById([], [confirmed])).toEqual([confirmed]);
    expect(mergeReadingThoughtsById(
      [{ id: confirmed.id, content: confirmed.content }],
      [confirmed],
    )).toHaveLength(1);
  });
});