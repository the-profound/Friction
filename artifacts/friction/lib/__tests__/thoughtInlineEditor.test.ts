import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  createKeyedSingleFlight,
  formatReadingThoughtQuote,
  getThoughtInlineCommitAction,
  isCurrentEditorCommit,
  isCurrentOptimisticRequest,
  mergeReadingThoughtsById,
  reconcileConfirmedThoughts,
  reconcileDeletedThoughtIds,
  type OptimisticReadingThought,
} from "../thoughtInlineEditor";

describe("inline reading thought lifecycle", () => {
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