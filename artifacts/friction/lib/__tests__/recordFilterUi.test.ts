import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("record filter UI regression", () => {
  it("keeps record kind filters as independent buttons", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );

    expect(recordsScreen).not.toContain("DropdownFilter");
    expect(recordsScreen).toContain("function RecordKindButton");
    expect(recordsScreen).toContain('label="단상" active={kind === "thought"}');
    expect(recordsScreen).toContain('label="편집" active={kind === "editing"}');
    expect(recordsScreen).toContain('label="편지" active={kind === "letter"}');
  });

  it("opens on thoughts and mixes queued questions into the thought feed", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );

    expect(recordsScreen).toContain(
      'const [kind, setKind] = useState<RecordKind>("thought")',
    );
    expect(recordsScreen).toContain('setKind("thought")');
    expect(recordsScreen).toContain('() => kind === "thought"');
    expect(recordsScreen).toContain("buildMixedRecordGroups(");
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

  it("opens search from the date boundary without a header search button", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );
    const searchBar = readFileSync(
      join(__dirname, "../../components/AnimatedSearchBar/AnimatedSearchBar.tsx"),
      "utf8",
    );

    expect(recordsScreen).not.toContain("showSearch");
    expect(recordsScreen).toContain("onSearchBoundaryGesture: openSearch");
    expect(recordsScreen).toContain("onPointerUp:");
    expect(recordsScreen).toContain("event.nativeEvent.velocity?.y");
    expect(recordsScreen).toContain("restartRecordControlsTimer");
    expect(recordsScreen).toContain('pointerEvents={controlsVisible && !searchActive ? "box-none" : "none"}');
    expect(recordsScreen).toContain("getRecordControlsScrollVisibility");
    expect(recordsScreen).toContain("registerControlsActivity");
    expect(recordsScreen).toContain("removeFocusOutline");
    expect(searchBar).toContain('outlineStyle: "none"');
  });

  it("keeps the filter-bar layout space stable while only fading its controls", () => {
    const recordsScreen = readFileSync(
      join(__dirname, "../../app/(tabs)/on.tsx"),
      "utf8",
    );

    expect(recordsScreen).toContain("height: FILTER_BAR_HEIGHT,");
    expect(recordsScreen).toContain("marginBottom: -FILTER_GRADIENT_OVERLAP,");
    expect(recordsScreen).toContain("style={[styles.filterControls, { opacity: controlsAnimation }]}");
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