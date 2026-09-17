import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const listScreen = readFileSync(
  new URL("../../app/(tabs)/on.tsx", import.meta.url),
  "utf8",
);
const writingScreen = readFileSync(
  new URL("../../app/on-01a.tsx", import.meta.url),
  "utf8",
);

describe("question queue analytics wiring", () => {
  it("tracks exposure only from list viewability boundaries", () => {
    const querySection = listScreen.slice(
      listScreen.indexOf("const questionQuery ="),
      listScreen.indexOf("const collectionsQuery ="),
    );
    expect(querySection).not.toContain("question_queue_card_viewed");
    expect(listScreen).toContain("onCardViewableItemsChangedRef");
    expect(listScreen).toContain("onContentViewableItemsChangedRef");
    expect(listScreen).toContain('event: "question_queue_card_viewed"');
  });

  it("distinguishes activation, answer start, save success, and save failure", () => {
    expect(listScreen).toContain('event: "question_queue_activated"');
    expect(listScreen).toContain('event: "question_queue_activation_failed"');
    expect(writingScreen).toContain('event: "question_queue_answer_started"');
    expect(writingScreen).toContain('event: "question_queue_answer_save_succeeded"');
    expect(writingScreen).toContain('event: "question_queue_answer_save_failed"');
  });

  it("computes answer length from the activation baseline after server success", () => {
    const saveSection = writingScreen.slice(
      writingScreen.indexOf("let savedThought: Thought;"),
      writingScreen.indexOf("queryClient.setQueryData", writingScreen.indexOf("let savedThought: Thought;")),
    );
    expect(saveSection).toContain("await updateThought.mutateAsync");
    expect(saveSection).toContain("getQuestionAnswerLength(");
    expect(saveSection.indexOf("await updateThought.mutateAsync")).toBeLessThan(
      saveSection.indexOf("getQuestionAnswerLength("),
    );
  });
});