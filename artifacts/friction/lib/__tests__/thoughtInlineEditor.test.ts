import { describe, expect, it } from "vitest";
import {
  formatReadingThoughtQuote,
  getThoughtInlineCommitAction,
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
});