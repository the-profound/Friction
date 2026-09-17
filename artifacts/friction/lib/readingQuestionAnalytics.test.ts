import { describe, expect, it } from "vitest";
import {
  createReadingQuestionSessionId,
  createReadingQuestionSaveState,
  createReadingQuestionClientId,
  readingQuestionAnswerLength,
  saveReadingQuestionAnswers,
} from "./readingQuestionAnalytics";

describe("reading question analytics values", () => {
  it("counts only the trimmed user answer, including Korean and internal newlines", () => {
    expect(readingQuestionAnswerLength("  한글\n답변  ")).toBe(5);
    expect(readingQuestionAnswerLength("\n\t")).toBe(0);
  });

  it("creates distinct visit IDs while preserving the article scope", () => {
    expect(createReadingQuestionSessionId("article", 100, 0.1)).not.toBe(
      createReadingQuestionSessionId("article", 100, 0.2),
    );
    expect(createReadingQuestionSessionId("article", 100, 0.1)).toMatch(/^article:100:/);
  });

  it("derives a stable UUID from the persisted session and question index", () => {
    const first = createReadingQuestionClientId("persisted-session", 2);
    expect(first).toBe(createReadingQuestionClientId("persisted-session", 2));
    expect(first).not.toBe(createReadingQuestionClientId("persisted-session", 3));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("deduplicates overlaps, retries only failures, and reuses their client IDs", async () => {
    const state = createReadingQuestionSaveState();
    const cards = [
      { questionIndex: 0, question: "private q0", answer: "first" },
      { questionIndex: 1, question: "private q1", answer: "second" },
    ];
    const calls: Array<{ index: number; clientId: string }> = [];
    const succeeded: number[] = [];
    const failed: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let failSecond = true;
    const create = async (card: typeof cards[number], clientId: string) => {
      calls.push({ index: card.questionIndex, clientId });
      if (card.questionIndex === 0) await firstGate;
      if (card.questionIndex === 1 && failSecond) throw new Error("offline");
      return { id: clientId };
    };
    const run = () => saveReadingQuestionAnswers({
      cards,
      state,
      sessionId: "persisted-session",
      create,
      onSucceeded: (card) => succeeded.push(card.questionIndex),
      onFailed: (card) => failed.push(card.questionIndex),
    });

    const first = run();
    const overlap = run();
    releaseFirst();
    await Promise.all([first, overlap]);
    expect(calls.map(({ index }) => index)).toEqual([0, 1]);
    expect(succeeded).toEqual([0]);
    expect(failed).toEqual([1]);

    const failedClientId = calls.find(({ index }) => index === 1)?.clientId;
    failSecond = false;
    await run();
    expect(calls.map(({ index }) => index)).toEqual([0, 1, 1]);
    expect(calls[2]?.clientId).toBe(failedClientId);
    expect(succeeded).toEqual([0, 1]);

    await run();
    expect(calls).toHaveLength(3);
    expect(succeeded).toEqual([0, 1]);
  });

  it("reuses the same client ID after remounting with a persisted session", async () => {
    const card = { questionIndex: 0, question: "private question", answer: "answer" };
    const clientIds: string[] = [];

    await saveReadingQuestionAnswers({
      cards: [card],
      state: createReadingQuestionSaveState(),
      sessionId: "restored-session",
      create: async (_card, clientId) => {
        clientIds.push(clientId);
        throw new Error("response lost");
      },
      onSucceeded: () => {},
      onFailed: () => {},
    });

    await saveReadingQuestionAnswers({
      cards: [card],
      state: createReadingQuestionSaveState(),
      sessionId: "restored-session",
      create: async (_card, clientId) => {
        clientIds.push(clientId);
        return { id: "existing-thought" };
      },
      onSucceeded: () => {},
      onFailed: () => {},
    });

    expect(clientIds).toHaveLength(2);
    expect(clientIds[1]).toBe(clientIds[0]);
  });
});