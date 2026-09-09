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
    expect(recordsScreen).toContain("setKind(advanceRecordKind(kind, reselectCount))");
    expect(recordsScreen).toContain('onPress={() => setKind("editing")}');
    expect(recordsScreen).toContain('onPress={() => setKind("letter")}');
  });

  it("cycles record filters only when the active records tab is reselected", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );
    const navigationContext = readFileSync(
      join(__dirname, "../../contexts/NavigationContext.tsx"),
      "utf8",
    );

    expect(navigationContext).toContain("if (lastSyncRef.current.tab === tab)");
    expect(navigationContext).toContain("[tab]: previous[tab] + 1");
    expect(recordsScreen).toContain('import { advanceRecordKind } from "@/lib/tabReselect"');
    expect(recordsScreen).toContain(
      "if (handledRecordReselectVersionRef.current === tabReselectVersion.ON) return",
    );
    expect(recordsScreen).toContain("setKind(advanceRecordKind(kind, reselectCount))");
    expect(recordsScreen).toContain("setView(\"card\")");
    expect(recordsScreen).toContain("setRecordResetVersion(tabReselectVersion.ON)");
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
    expect(recordsScreen).toMatch(/pointerEvents="box-none"\s*style={styles\.filterControls}/);
  });

  it("keeps the filter-bar layout space stable", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );

    // The filter/view row is a fixed-height overlay floated above the list via
    // absolute positioning (not a negative-margin sibling overlap), so every
    // scrollable branch below it must reserve FILTER_BAR_HEIGHT of top padding.
    expect(recordsScreen).toContain("height: FILTER_BAR_HEIGHT,");
    expect(recordsScreen).toMatch(
      /<HeaderFadeOverlay controlHeight={FILTER_BAR_HEIGHT}(?:\s+fadeFromTop)?>/,
    );
    expect(recordsScreen).not.toContain("filtersAnimated");
    expect(recordsScreen).not.toContain("marginBottom: -FILTER_GRADIENT_OVERLAP");
    expect(recordsScreen).not.toContain("outputRange: [0, FILTER_BAR_HEIGHT]");
    expect(recordsScreen).not.toContain("outputRange: [0, -FILTER_GRADIENT_OVERLAP]");

    const paddingTopReservations = (
      recordsScreen.match(/paddingTop:\s*FILTER_BAR_HEIGHT/g) ?? []
    ).length;
    // isLoading / offline-empty / card-view / content-view / empty-state all
    // sit below the overlay and must each reserve the same top offset.
    expect(paddingTopReservations).toBeGreaterThanOrEqual(4);
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
