import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, capture } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  capture: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    getAllKeys: vi.fn(async () => [...storage.keys()]),
  },
}));
vi.mock("../posthog", () => ({ posthog: { capture } }));

import { getQuestionAnswerLength } from "../questionQueueAnalytics";
import { trackQuestionQueueEventOnce } from "../questionQueueAnalytics";
import { flushPendingQuestionQueueEvents } from "../questionQueueAnalytics";

describe("question queue answer length", () => {
  const question = "# Q. 오늘은 어땠나요?\n\n천천히 떠올려보세요.";

  it("does not count the quoted question", () => {
    expect(getQuestionAnswerLength(question, `${question}\n\n좋았어요`)).toBe(4);
  });

  it("trims surrounding whitespace and line breaks", () => {
    expect(getQuestionAnswerLength(question, `${question}\n\n  한 줄\n둘  \n`)).toBe(5);
  });

  it("returns zero for an unchanged or whitespace-only answer", () => {
    expect(getQuestionAnswerLength(question, question)).toBe(0);
    expect(getQuestionAnswerLength(question, `${question}\n\n   \n`)).toBe(0);
  });

  it("counts Korean Unicode characters as characters", () => {
    expect(getQuestionAnswerLength(question, `${question}\n\n한글 답변`)).toBe(5);
  });

  it("never counts the full prompt after the prompt is reformatted", () => {
    const reformatted = `${question.replace("Q. ", "Q.  ")}\n\n새 답`;
    expect(getQuestionAnswerLength(question, reformatted)).toBe(3);
  });

  it("preserves answer spaces and newlines after prompt reformatting", () => {
    const reformatted = `${question.replace("Q. ", "Q.  ")}\n\n한 줄\n둘`;
    expect(getQuestionAnswerLength(question, reformatted)).toBe(5);
  });
});

describe("question queue event privacy and deduplication", () => {
  beforeEach(() => {
    storage.clear();
    capture.mockClear();
  });

  it("captures simultaneous duplicate requests only once", async () => {
    const results = await Promise.all([
      trackQuestionQueueEventOnce({
        event: "question_queue_card_viewed",
        questionId: "question-race",
      }),
      trackQuestionQueueEventOnce({
        event: "question_queue_card_viewed",
        questionId: "question-race",
      }),
    ]);

    expect(results).toEqual([true, true]);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("does not recapture an event already reserved in persistent storage", async () => {
    storage.set(
      "question_queue_analytics:v1:question_queue_answer_save_succeeded:question-existing",
      "delivered",
    );

    expect(await trackQuestionQueueEventOnce({
      event: "question_queue_answer_save_succeeded",
      questionId: "question-existing",
      answerLength: 7,
    })).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it("sends only identifiers and integer answer length, never source text", async () => {
    await trackQuestionQueueEventOnce({
      event: "question_queue_answer_save_succeeded",
      questionId: "question-private",
      answerLength: 5.9,
    });

    expect(capture).toHaveBeenCalledWith(
      "question_queue_answer_save_succeeded",
      {
        $insert_id: "question-queue:question_queue_answer_save_succeeded:question-private",
        question_id: "question-private",
        question_session_key: "question-private",
        answer_length: 5,
      },
    );
  });

  it("resends a privacy-safe pending event from a previous launch", async () => {
    storage.set(
      "question_queue_analytics:v1:question_queue_activated:question-pending",
      JSON.stringify({
        event: "question_queue_activated",
        questionId: "question-pending",
      }),
    );

    await flushPendingQuestionQueueEvents();

    expect(capture).toHaveBeenCalledWith(
      "question_queue_activated",
      expect.objectContaining({
        $insert_id: "question-queue:question_queue_activated:question-pending",
        question_id: "question-pending",
      }),
    );
    expect(storage.get(
      "question_queue_analytics:v1:question_queue_activated:question-pending",
    )).toBe("delivered");
  });
});