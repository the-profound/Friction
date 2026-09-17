import { beforeEach, describe, expect, it, vi } from "vitest";

const { capture } = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock("./posthog", () => ({ posthog: { capture } }));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "test" } },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
}));
vi.mock("@workspace/api-client-react", () => ({
  setRequestTelemetryObserver: vi.fn(),
}));

import {
  trackReadingQuestionAnswerStarted,
  trackReadingQuestionItemExposed,
  trackReadingQuestionSaveFailed,
  trackReadingQuestionSaveSucceeded,
  trackReadingQuestionSessionExposed,
} from "./analytics";

const base = {
  articleId: "article-id",
  sessionId: "persisted-session",
  questionIndex: 1,
  questionCount: 2,
};

describe("reading question event identities", () => {
  beforeEach(() => {
    capture.mockClear();
  });

  it("reuses deterministic insert IDs after restoring the same session", () => {
    trackReadingQuestionSessionExposed({
      articleId: base.articleId,
      sessionId: base.sessionId,
      questionCount: base.questionCount,
    });
    trackReadingQuestionSessionExposed({
      articleId: base.articleId,
      sessionId: base.sessionId,
      questionCount: base.questionCount,
    });
    trackReadingQuestionItemExposed(base);
    trackReadingQuestionItemExposed(base);
    trackReadingQuestionAnswerStarted(base);
    trackReadingQuestionAnswerStarted(base);
    trackReadingQuestionSaveFailed(base);
    trackReadingQuestionSaveFailed(base);

    const insertIds = capture.mock.calls.map(([, properties]) => properties.$insert_id);
    expect(insertIds[0]).toBe(insertIds[1]);
    expect(insertIds[2]).toBe(insertIds[3]);
    expect(insertIds[4]).toBe(insertIds[5]);
    expect(insertIds[6]).toBe(insertIds[7]);
  });

  it("uses new exposure IDs for a deliberate reread session", () => {
    trackReadingQuestionItemExposed(base);
    trackReadingQuestionItemExposed({ ...base, sessionId: "reread-session" });

    expect(capture.mock.calls[0]?.[1].$insert_id).not.toBe(
      capture.mock.calls[1]?.[1].$insert_id,
    );
  });

  it("deduplicates successful retry analytics by the returned thought identity", () => {
    const params = {
      ...base,
      answerLength: 7,
      thoughtId: "thought-id",
    };
    trackReadingQuestionSaveSucceeded(params);
    trackReadingQuestionSaveSucceeded(params);

    expect(capture.mock.calls[0]?.[1].$insert_id).toBe(
      "reading-question-save-succeeded:thought-id",
    );
    expect(capture.mock.calls[1]?.[1].$insert_id).toBe(
      capture.mock.calls[0]?.[1].$insert_id,
    );
    expect(capture.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ answer_length: 7 }),
    );
    expect(capture.mock.calls[0]?.[1]).not.toHaveProperty("question");
    expect(capture.mock.calls[0]?.[1]).not.toHaveProperty("answer");
  });
});