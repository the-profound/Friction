import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const onScreen = readFileSync(join(__dirname, "../on.tsx"), "utf8");

describe("record question queue recovery lifecycle", () => {
  it("keeps focus recovery independent of query state transitions", () => {
    expect(onScreen).toContain("const queryState = questionQueryStateRef.current;");
    expect(onScreen).toContain("}, [userId]),");
    expect(onScreen).not.toMatch(
      /useFocusEffect\([\s\S]*?\}, \[[^\]]*questionQuery\.isFetching[^\]]*\]\),/,
    );
    expect(onScreen).not.toMatch(
      /useFocusEffect\([\s\S]*?\}, \[[^\]]*questionQuery\.isLoading[^\]]*\]\),/,
    );
  });

  it("guards both tab reselection and focus recovery from auth and queue races", () => {
    expect(onScreen.match(/shouldRefetchQuestionQueue\(\{/g)).toHaveLength(2);
    expect(onScreen.match(/mutationPending: questionQueueMutationPendingRef\.current/g))
      .toHaveLength(2);
  });

  it("uses one normalized queue for card and list views", () => {
    expect(onScreen).toContain("const queuedThoughts = useMemo(");
    expect(onScreen).toContain("? queuedThoughts.map((thought, index) => ({");
    expect(onScreen).toContain("view !== \"card\" && queuedThoughts[0]");
  });
});