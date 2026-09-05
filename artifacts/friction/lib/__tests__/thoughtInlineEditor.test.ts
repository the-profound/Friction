import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import {
  createKeyedSingleFlight,
  formatReadingThoughtQuote,
  getThoughtInlineCommitAction,
  isCurrentEditorCommit,
  isCurrentOptimisticRequest,
  mergeReadingThoughtsById,
  normalizeThoughtLineBreaks,
  reconcileConfirmedThoughts,
  reconcileDeletedThoughtIds,
  shouldShowReadingThoughtToolbar,
  startImmediateClose,
  type OptimisticReadingThought,
} from "../thoughtInlineEditor";

describe("inline reading thought lifecycle", () => {
  it("shows the restricted toolbar only for a focused native editor with an open keyboard", () => {
    const active = {
      visible: true,
      editorActive: true,
      editorFocused: true,
      keyboardVisible: true,
      native: true,
    };

    expect(shouldShowReadingThoughtToolbar(active)).toBe(true);
    expect(shouldShowReadingThoughtToolbar({ ...active, visible: false })).toBe(false);
    expect(shouldShowReadingThoughtToolbar({ ...active, editorActive: false })).toBe(false);
    expect(shouldShowReadingThoughtToolbar({ ...active, editorFocused: false })).toBe(false);
    expect(shouldShowReadingThoughtToolbar({ ...active, keyboardVisible: false })).toBe(false);
    expect(shouldShowReadingThoughtToolbar({ ...active, native: false })).toBe(false);
  });

  it("wires both reading inputs to one restricted toolbar above the keyboard spacer", () => {
    const source = readFileSync(
      join(__dirname, "../../components/ThoughtsBottomSheet/ThoughtsBottomSheet.tsx"),
      "utf8",
    );

    expect(source.match(/onFocus=\{\(\) => setEditorFocused\(true\)\}/g)).toHaveLength(2);
    expect(source.match(/onBlur=\{\(\) => setEditorFocused\(false\)\}/g)).toHaveLength(2);
    expect(source).toContain('mode="restricted"');
    expect(source).toContain("inputRef.current?.blur();");
    expect(source.indexOf("{showKeyboardToolbar && (")).toBeLessThan(
      source.indexOf('<Animated.View style={{ height: inputPadAnim }} pointerEvents="none" />'),
    );
  });

  it("starts closing immediately without waiting for the save result", async () => {
    let resolveSave!: (value: boolean) => void;
    const events: string[] = [];
    const save = () => {
      events.push("snapshot");
      return new Promise<boolean>((resolve) => { resolveSave = resolve; });
    };

    const pending = startImmediateClose(save, () => { events.push("close"); });

    expect(events).toEqual(["snapshot", "close"]);
    resolveSave(true);
    await expect(pending).resolves.toBe(true);
  });

  it("shares one physical save across consecutive close requests", async () => {
    const singleFlight = createKeyedSingleFlight<string>();
    let resolveSave!: (value: string) => void;
    let requestCount = 0;
    const operation = () => {
      requestCount += 1;
      return new Promise<string>((resolve) => { resolveSave = resolve; });
    };

    const first = singleFlight.run("same-editor", operation);
    const second = singleFlight.run("same-editor", operation);
    expect(first).toBe(second);
    expect(requestCount).toBe(1);
    expect(singleFlight.pendingKey()).toBe("same-editor");

    resolveSave("saved");
    await expect(first).resolves.toBe("saved");
    expect(singleFlight.pendingKey()).toBeUndefined();
  });

  it("allows a fresh retry after a failed shared save", async () => {
    const singleFlight = createKeyedSingleFlight<string>();
    await expect(singleFlight.run("editor", () => Promise.reject(new Error("offline"))))
      .rejects.toThrow("offline");
    await expect(singleFlight.run("editor", () => Promise.resolve("retried")))
      .resolves.toBe("retried");
  });

  it("queues a newer editor instead of sharing the older editor result", async () => {
    const singleFlight = createKeyedSingleFlight<string>();
    let finishOld!: () => void;
    const calls: string[] = [];
    const oldSave = singleFlight.run("old", () => new Promise<string>((resolve) => {
      calls.push("old");
      finishOld = () => resolve("old-saved");
    }));
    const newSave = singleFlight.run("new", async () => {
      calls.push("new");
      return "new-saved";
    });

    expect(calls).toEqual(["old"]);
    finishOld();
    await expect(oldSave).resolves.toBe("old-saved");
    await expect(newSave).resolves.toBe("new-saved");
    expect(calls).toEqual(["old", "new"]);
  });

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

  it("canonicalizes platform line separators without trimming intentional structure", () => {
    expect(normalizeThoughtLineBreaks("\r\n첫 줄\r둘째 줄\u2028\u2029끝\n"))
      .toBe("\n첫 줄\n둘째 줄\n\n끝\n");
  });

  it("treats equivalent CRLF and LF content as unchanged", () => {
    expect(getThoughtInlineCommitAction({
      isExisting: true,
      text: "첫 줄\r\n\r\n셋째 줄",
      initialText: "첫 줄\n\n셋째 줄",
    })).toBe("unchanged");
  });

  it("preserves user line breaks through optimistic and confirmed merges", () => {
    const content = normalizeThoughtLineBreaks("첫 줄\r\n\r\n셋째 줄");
    const local: OptimisticReadingThought = {
      id: "multiline",
      content,
      createdAt: "2026-09-04T00:00:00.000Z",
      saveState: "confirmed",
      requestGeneration: 1,
    };

    expect(mergeReadingThoughtsById(
      [{ id: "multiline", content: "stale soft-wrapped text" }],
      [local],
    )).toEqual([{ id: "multiline", content: "첫 줄\n\n셋째 줄" }]);
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

  it("keeps independent cards isolated when save responses finish in either order", () => {
    const first = optimistic({ id: "first", content: "첫 단상" });
    const second = optimistic({ id: "second", content: "둘째 단상" });
    const afterSecond = [first, { ...second, saveState: "confirmed" as const }];
    const afterFirst = afterSecond.map((item) =>
      item.id === first.id ? { ...item, saveState: "confirmed" as const } : item
    );

    expect(afterFirst).toEqual([
      expect.objectContaining({ id: "first", content: "첫 단상", saveState: "confirmed" }),
      expect.objectContaining({ id: "second", content: "둘째 단상", saveState: "confirmed" }),
    ]);
    expect(reconcileConfirmedThoughts(
      [{ id: "second", content: "둘째 단상" }],
      afterFirst,
    )).toEqual([expect.objectContaining({ id: "first", content: "첫 단상" })]);
  });

  it("rejects a save result after a different editor session opens", () => {
    expect(isCurrentEditorCommit("new-session", "old-session")).toBe(false);
    expect(isCurrentEditorCommit("same-session", "same-session")).toBe(true);
    expect(isCurrentEditorCommit(undefined, "closed-session")).toBe(false);
  });

  it("keeps a confirmed local fence visible until a server refetch contains its ID", () => {
    const confirmed = optimistic({ saveState: "confirmed" });
    expect(mergeReadingThoughtsById([], [confirmed])).toEqual([confirmed]);
    expect(mergeReadingThoughtsById(
      [{ id: confirmed.id, content: "stale server content" }],
      [confirmed],
    )).toEqual([{ id: confirmed.id, content: confirmed.content }]);
    expect(reconcileConfirmedThoughts(
      [{ id: confirmed.id, content: "stale server content" }],
      [confirmed],
    )).toEqual([confirmed]);
    expect(reconcileConfirmedThoughts(
      [{ id: confirmed.id, content: confirmed.content }],
      [confirmed],
    )).toEqual([]);
  });

  it("keeps a deletion fence until the server list confirms absence", () => {
    const deleted = new Set(["deleted-thought"]);
    expect(reconcileDeletedThoughtIds([{ id: "deleted-thought" }], deleted))
      .toEqual(deleted);
    expect(reconcileDeletedThoughtIds([], deleted)).toEqual(new Set());
  });

  it("keeps confirmed cache data after retiring a pre-save list request", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const scopedKey = ["/api/thoughts", { sourceArticleId: "article" }] as const;
    const allKey = ["/api/thoughts"] as const;
    let resolveScoped!: (value: Array<{ id: string; content: string }>) => void;
    let resolveAll!: (value: Array<{ id: string; content: string }>) => void;
    const makeStaleQuery = (
      resolveRef: (resolve: (value: Array<{ id: string; content: string }>) => void) => void,
    ) => ({ signal }: { signal: AbortSignal }) => new Promise<Array<{ id: string; content: string }>>(
      (resolve, reject) => {
        resolveRef(resolve);
        signal.addEventListener("abort", () => reject(new Error("cancelled")));
      },
    );
    const scopedRequest = client.fetchQuery({
      queryKey: scopedKey,
      queryFn: makeStaleQuery((resolve) => { resolveScoped = resolve; }),
    }).catch(() => undefined);
    const allRequest = client.fetchQuery({
      queryKey: allKey,
      queryFn: makeStaleQuery((resolve) => { resolveAll = resolve; }),
    }).catch(() => undefined);

    await Promise.all([
      client.cancelQueries({ queryKey: scopedKey }),
      client.cancelQueries({ queryKey: allKey }),
    ]);
    const confirmed = [{ id: "thought", content: "latest" }];
    client.setQueryData(scopedKey, confirmed);
    client.setQueryData(allKey, confirmed);
    resolveScoped([{ id: "thought", content: "stale" }]);
    resolveAll([{ id: "thought", content: "stale" }]);
    await Promise.all([scopedRequest, allRequest]);

    expect(client.getQueryData(scopedKey)).toEqual(confirmed);
    expect(client.getQueryData(allKey)).toEqual(confirmed);
  });

  it("retires a list request started during mutation before confirming caches", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = ["/api/thoughts", { sourceArticleId: "article" }] as const;
    let resolveStale!: (value: Array<{ id: string; content: string }>) => void;

    // First cancellation has already completed; an observer refetches while the
    // server mutation is still pending.
    await client.cancelQueries({ queryKey: key });
    const duringMutation = client.fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => new Promise<Array<{ id: string; content: string }>>(
        (resolve, reject) => {
          resolveStale = resolve;
          signal.addEventListener("abort", () => reject(new Error("cancelled")));
        },
      ),
    }).catch(() => undefined);

    // Mutation response arrived: retire requests created during the mutation,
    // then synchronously publish the authoritative response.
    await client.cancelQueries({ queryKey: key });
    const confirmed = [{ id: "thought", content: "latest" }];
    client.setQueryData(key, confirmed);
    resolveStale([{ id: "thought", content: "stale" }]);
    await duringMutation;

    expect(client.getQueryData(key)).toEqual(confirmed);
  });
});