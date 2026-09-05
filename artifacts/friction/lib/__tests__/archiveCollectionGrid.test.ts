import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const archiveScreen = readFileSync(join(appRoot, "app/(tabs)/archive.tsx"), "utf8");

describe("archive personal collection grid", () => {
  it("renders every personal collection through the same full-width list renderer", () => {
    expect(archiveScreen).toContain("data={regularCollections}");
    expect(archiveScreen).not.toContain("numColumns={2}");
    expect(archiveScreen).toContain("renderItem={renderPersonalItem}");
  });

  it("keeps each card at the shared full-width size", () => {
    expect(archiveScreen).toContain(
      "const cardWidth = Math.floor(windowWidth - Spacing.screenPx * 2);",
    );
    expect(archiveScreen).toContain(
      "style={[styles.cardWrapper, { width: cardWidth }]}",
    );
  });

  it("keeps long names and article counts on one line", () => {
    expect(archiveScreen).toContain(
      '<Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>',
    );
    expect(archiveScreen).toContain(
      '<Text style={styles.cardMetaText} numberOfLines={1}>{item.articleCount ?? 0}편</Text>',
    );
  });
});

describe("archive collected sentence list", () => {
  const regularRenderer = archiveScreen.slice(
    archiveScreen.indexOf("const renderSentenceItem"),
    archiveScreen.indexOf("const renderSentenceSelectionItem"),
  );
  const selectionRenderer = archiveScreen.slice(
    archiveScreen.indexOf("const renderSentenceSelectionItem"),
    archiveScreen.indexOf("const renderEmptyPersonal"),
  );

  it("uses the record-list card surface and metadata layout", () => {
    expect(archiveScreen).toContain("marginHorizontal: Spacing.screenPx");
    expect(archiveScreen).toContain("marginBottom: Spacing.cardGap");
    expect(archiveScreen).toContain("borderRadius: 16");
    expect(archiveScreen).toContain("...Shadows.card");
    expect(archiveScreen).toContain("fontFamily: ReaderTokens.fontFamily.serif");
    expect(archiveScreen).toContain('justifyContent: "space-between"');
  });

  it("keeps source and sentence previews safely truncated", () => {
    expect(regularRenderer).toContain('style={styles.sentenceSource} numberOfLines={1}');
    expect(regularRenderer).toContain("numberOfLines={3}");
    expect(regularRenderer).toContain('ellipsizeMode="tail"');
    expect(selectionRenderer).toContain('style={styles.sentenceSource} numberOfLines={1}');
    expect(selectionRenderer).toContain("numberOfLines={3}");
  });

  it("does not render favorite indicators or actions in either list renderer", () => {
    expect(regularRenderer).not.toContain('name="star"');
    expect(regularRenderer).not.toContain("handleSentenceToggleFavorite");
    expect(selectionRenderer).not.toContain('name="star"');
    expect(selectionRenderer).not.toContain("isFavorite");
  });

  it("preserves detail, swipe delete, and accessible multi-selection interactions", () => {
    expect(regularRenderer).toContain('pathname: "/stored-sentence-detail"');
    expect(regularRenderer).toContain("onDeletePress");
    expect(regularRenderer).toContain("onSwipeOpen");
    expect(selectionRenderer).toContain('accessibilityRole="checkbox"');
    expect(selectionRenderer).toContain("accessibilityState={{ checked: isSelected }}");
    expect(selectionRenderer).toContain("toggleSelect(item.id)");
    expect(archiveScreen).not.toContain("selectedSentence");
  });
});

describe("stored sentence detail route", () => {
  const detailScreen = readFileSync(join(appRoot, "app/stored-sentence-detail.tsx"), "utf8");

  it("uses the single-item query and exposes every supported menu action", () => {
    expect(detailScreen).toContain("useGetStoredSentence(sentenceId");
    expect(detailScreen).toContain('"복사하기"');
    expect(detailScreen).toContain('"즐겨찾기 해제"');
    expect(detailScreen).toContain('"인용하여 메모 작성"');
    expect(detailScreen).toContain('"원본으로 이동"');
    expect(detailScreen).toContain('"삭제"');
    expect(detailScreen).toContain("...(sentence.articleId ?");
  });

  it("keeps typography, source fallbacks, scrolling, and deletion cache refresh explicit", () => {
    expect(detailScreen).toContain("ReaderTokens.typeScale.bodyCqi");
    expect(detailScreen).toContain('fontFamily: ReaderTokens.fontFamily.serifBold');
    expect(detailScreen).toContain('"제목 없는 원문"');
    expect(detailScreen).toContain('"저장 위치 없음"');
    expect(detailScreen).toContain("<ScrollView");
    expect(detailScreen).toContain("invalidateQueries({ queryKey: getListStoredSentencesQueryKey");
    expect(detailScreen).toContain("router.back()");
  });
});
