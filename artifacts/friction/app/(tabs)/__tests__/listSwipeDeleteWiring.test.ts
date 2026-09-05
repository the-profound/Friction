import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

describe("list swipe delete wiring", () => {
  it("keeps archive sentence rows coordinated and preserves the favorite badge overflow", () => {
    const archive = read("(tabs)/archive.tsx");

    expect(archive).toContain("const sentenceOpenRowRef = useRef<SwipeableRowHandle | null>(null)");
    expect(archive).toContain("sentenceRowRefs.current.get(id) ?? null");
    expect(archive).toContain("currentOpen.close()");
    expect(archive).toContain("onSwipeOpen={() => handleSentenceSwipeOpen(item.id)}");
    expect(archive).toContain("onScrollLock={(locked) => setSentenceScrollEnabled(!locked)}");
    expect(archive).toContain("overflowTop={SENTENCE_BADGE_OVERFLOW}");
    expect(archive).toContain("actionRightInset={Spacing.screenPx}");
    expect(archive).toContain("actionBottomInset={Spacing.cardGap}");
    expect(archive).toContain("onScrollBeginDrag={closeSentenceOpenRow}");
    expect(archive).toMatch(
      /onDeletePress=\{\(\) => \{\s*closeSentenceOpenRow\(\);\s*setSentenceDeleteTarget\(item\.id\);/,
    );
  });

  it("wraps only ordinary record list rows and reuses the existing confirmation flow", () => {
    const on = read("(tabs)/on.tsx");

    expect(on).toContain("if (isCurrentQuestion) return row;");
    expect(on).toContain("<SwipeableRow");
    expect(on).toContain("onPress: () => requestRecordDeletion(item)");
    expect(on).toContain("onSwipeOpen={() => handleRecordSwipeOpen(recordKey)}");
    expect(on).toContain("onScrollLock={(locked) => setRecordListScrollEnabled(!locked)}");
    expect(on).toContain("scrollEnabled={recordListScrollEnabled}");
    expect(on).toContain("visible={Boolean(deleteTarget)}");
    expect(on).toContain("onConfirm={confirmDelete}");
    expect(on).toContain("if (deletePendingIdsRef.current.has(target.id))");
  });

  it("closes an open record row when list conditions or vertical scrolling change", () => {
    const on = read("(tabs)/on.tsx");

    expect(on).toContain("openRecordRowRef.current?.close()");
    expect(on).toMatch(
      /useEffect\(\(\) => \{\s*closeOpenRecordRow\(\);\s*closeOverlay\(\);[\s\S]*\}, \[kind, view,/,
    );
    expect(on).toMatch(
      /useEffect\(\(\) => \{\s*closeOpenRecordRow\(\);\s*\}, \[searchQuery,/,
    );
    expect(on).toMatch(
      /onScrollBeginDrag=\{\(event\) => \{\s*closeOpenRecordRow\(\);/,
    );
  });
});