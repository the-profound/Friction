import { describe, expect, it } from "vitest";
import {
  createThoughtDocumentSnapshot,
  serializeThoughtDocument,
  thoughtTitleMarkdownToText,
} from "@workspace/api-zod";

describe("canonical thought document snapshot", () => {
  it("moves a formatted multiline H1 into title text without duplicating it", () => {
    const snapshot = createThoughtDocumentSnapshot(
      "# **첫 제목**  \n둘째 <u>제목</u>  \n셋째 [링크](https://example.com)\n\n본문",
      { docVersion: 3, editorSessionId: "native-session" },
    );

    expect(snapshot?.title).toBe("첫 제목\n둘째 제목\n셋째 링크");
    expect(snapshot?.bodyMarkdown).toBe("본문");
    expect(snapshot?.docVersion).toBe(3);
    expect(snapshot?.editorSessionId).toBe("native-session");
  });

  it("keeps escaped syntax literal and round-trips title/body fields", () => {
    expect(thoughtTitleMarkdownToText(String.raw`\*별표\* **굵게** \[라벨\]`))
      .toBe("*별표* 굵게 [라벨]");
    const markdown = serializeThoughtDocument("첫 제목\n둘째 제목", "본문\n\n다음");
    const roundTrip = createThoughtDocumentSnapshot(markdown);
    expect(roundTrip?.title).toBe("첫 제목\n둘째 제목");
    expect(roundTrip?.bodyMarkdown).toBe("본문\n\n다음");
  });
});