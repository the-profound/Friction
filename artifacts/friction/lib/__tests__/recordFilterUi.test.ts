import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("record filter UI regression", () => {
  it("keeps record kind filters as independent buttons", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );
    const navigationContext = readFileSync(
      join(__dirname, "../../contexts/NavigationContext.tsx"),
      "utf8",
    );

    expect(navigationContext).toContain(
      'useState<RecordKindIntent>("thought")',
    );
    expect(navigationContext).toContain("setRecordKindIntent,");
    expect(recordsScreen).toContain('setKind("thought")');
    expect(recordsScreen).toContain('onPress={() => setKind("editing")}');
    expect(recordsScreen).toContain('onPress={() => setKind("letter")}');
  });

  it("routes letter list rows through the shared action-menu flow", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );
    const recordRow = readFileSync(
      join(__dirname, "../../components/RecordRow/RecordRow.tsx"),
      "utf8",
    );

    expect(recordRow).toContain("ArticleListItem");
    expect(recordRow).toContain('record.kind === "letter" && !isQuestion');
    expect(recordsScreen).toContain('if (item.kind === "letter") setLetterActionTarget(item)');
    expect(recordsScreen).toContain("prefillArticleId: letterActionTarget.article.id");
    expect(recordsScreen).toContain("setArchiveArticleId(letterActionTarget.article.id)");
    expect(recordsScreen).toContain('label: "삭제"');
    expect(recordRow).not.toContain("onSend");
    expect(recordRow).not.toContain("onArchive");
  });

  it("never mounts the pull-to-search bar or its trigger state", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );

    expect(recordsScreen).not.toContain("AnimatedSearchBar");
    expect(recordsScreen).not.toContain("recordMatchesQuery");
    expect(recordsScreen).not.toContain("searchActive");
    expect(recordsScreen).not.toContain("searchQuery");
    expect(recordsScreen).not.toContain("openSearch");
    expect(recordsScreen).not.toContain("closeSearch");
    expect(recordsScreen).not.toContain("tryOpenListSearch");
    expect(recordsScreen).not.toContain("onSearchBoundaryGesture");
    expect(recordsScreen).not.toContain("isListSearchBoundaryGesture");
    expect(recordsScreen).not.toContain("onPointerUp");
  });

  it("keeps the filter/view menu bar always visible", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );

    // The menu bar must never hide due to scrolling, inactivity timers, or
    // search — there is no longer any condition that hides it.
    expect(recordsScreen).not.toContain("recordControlsInactivity");
    expect(recordsScreen).not.toContain("getRecordControlsScrollVisibility");
    expect(recordsScreen).not.toContain("restartRecordControlsTimer");
    expect(recordsScreen).not.toContain("registerControlsActivity");
    expect(recordsScreen).not.toContain("showControlsForActivity");
    expect(recordsScreen).not.toContain("controlsVisible");
    expect(recordsScreen).not.toContain("controlsAnimation");
    expect(recordsScreen).toContain('pointerEvents="box-none"\n            style={styles.filterControls}');
  });

  it("keeps the filter-bar layout space stable", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );

    expect(recordsScreen).toContain("height: FILTER_BAR_HEIGHT,");
    expect(recordsScreen).toContain("marginBottom: -FILTER_GRADIENT_OVERLAP,");
    expect(recordsScreen).toContain("<View style={styles.filtersAnimated}>");
    expect(recordsScreen).not.toContain("outputRange: [0, FILTER_BAR_HEIGHT]");
    expect(recordsScreen).not.toContain("outputRange: [0, -FILTER_GRADIENT_OVERLAP]");
  });

  it("formats thought and editing card markdown while leaving question cards unchanged", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );
    const markdownPreview = readFileSync(
      join(__dirname, "../../components/RecordCardMarkdownPreview/RecordCardMarkdownPreview.tsx"),
      "utf8",
    );

    expect(recordsScreen).toContain("<RecordCardMarkdownPreview");
    expect(recordsScreen).toContain("{question ? (");
    expect(recordsScreen).toContain("maxLines={bodyLines}");
    expect(markdownPreview).toContain('textAlign: "justify"');
    expect(markdownPreview).toContain('numberOfLines={maxLines}');
    expect(markdownPreview).toContain('ellipsizeMode="tail"');
    expect(markdownPreview).toContain('block.type === "h1"');
    expect(markdownPreview).not.toContain("headingScale");
    expect(markdownPreview).toContain('block.type === "blockquote"');
    expect(markdownPreview).toContain('block.type === "ul_item"');
    expect(markdownPreview).toContain('block.type === "ol_item"');
  });
});
