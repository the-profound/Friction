import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const archiveScreen = readFileSync(join(appRoot, "app/(tabs)/archive.tsx"), "utf8");

const sentenceCard = readFileSync(join(appRoot, "components/StoredSentenceCard.tsx"), "utf8");
  const sentenceFilterAction = archiveScreen.slice(
    archiveScreen.indexOf('{activeSubTab === "personal" ? ('),
    archiveScreen.indexOf("</View>", archiveScreen.indexOf('{activeSubTab === "personal" ? (')),
  );
  const regularRenderer = archiveScreen.slice(
    archiveScreen.indexOf("const renderSentenceItem"),
    archiveScreen.indexOf("const renderSentenceSelectionItem"),
  );
  const selectionRenderer = archiveScreen.slice(
    archiveScreen.indexOf("const renderSentenceSelectionItem"),
    archiveScreen.indexOf("const renderEmptyPersonal"),
  );

  it("uses the shared content-sized card surface and metadata layout", () => {
    expect(regularRenderer).toContain("<StoredSentenceCard");
    expect(selectionRenderer).toContain("<StoredSentenceCard");
    expect(archiveScreen).toContain("marginHorizontal: Spacing.screenPx");
    expect(archiveScreen).toContain("marginBottom: Spacing.cardGap");
    expect(sentenceCard).toContain("borderRadius: 16");
    expect(sentenceCard).toContain("...Shadows.card");
    expect(sentenceCard).toContain("fontFamily: ReaderTokens.fontFamily.serif");
    expect(sentenceCard).toContain('textAlign: "justify"');
    expect(sentenceCard).not.toContain("minHeight");
    expect(sentenceCard).not.toContain('justifyContent: "space-between"');
    expect(archiveScreen).toContain('item.sourceText || item.articleTitle || "출처 없음"');
  });

  it("shows complete sentence and source text without line limits or ellipses", () => {
    expect(regularRenderer).not.toContain("numberOfLines");
    expect(regularRenderer).not.toContain("ellipsizeMode");
    expect(selectionRenderer).not.toContain("numberOfLines");
    expect(selectionRenderer).not.toContain("ellipsizeMode");
    expect(sentenceCard).not.toContain("numberOfLines");
    expect(sentenceCard).not.toContain("ellipsizeMode");
  });

  it("lets long sources wrap beside a stable bottom-right date", () => {
    expect(sentenceCard).toContain('alignItems: "flex-end"');
    expect(sentenceCard).toContain("flex: 1");
    expect(sentenceCard).toContain("minWidth: 0");
    expect(sentenceCard).toContain("flexShrink: 0");
    expect(sentenceCard).toContain('textAlign: "right"');
  });

  it("renders non-interactive favorite badges without adding favorite actions", () => {
    expect(regularRenderer).toContain("isFavorite={item.isFavorite}");
    expect(regularRenderer).not.toContain("handleSentenceToggleFavorite");
    expect(selectionRenderer).toContain("isFavorite={item.isFavorite}");
    expect(sentenceCard).toContain('pointerEvents="none"');
    expect(archiveScreen).toContain("즐겨찾기됨");
    expect(sentenceCard).toContain('<AntDesign name="heart" size={16} color={Colors.noticeAccent} />');
    expect(sentenceCard).not.toContain('name="star"');
  });

  it("opens manual sentence creation from the shared outlined add action", () => {
    expect(sentenceFilterAction).toContain("<HeaderButton");
    expect(sentenceFilterAction).toContain('variant="add"');
    expect(sentenceFilterAction).not.toContain("styles.addButton");
    expect(sentenceFilterAction).not.toContain("styles.addButtonContent");
    expect(sentenceFilterAction).toContain("onPress={handleAdd}");
    expect(sentenceFilterAction).toContain("onLongPress={enterSelectionMode}");
    expect(sentenceFilterAction).toContain('accessibilityLabel="문장 추가"');
    expect(sentenceFilterAction).toContain('accessibilityHint="새 문장 추가 화면으로 이동합니다. 길게 누르면 문장 선택 모드가 열립니다"');
    expect(sentenceFilterAction).toContain('{ name: "activate", label: "문장 추가" }');
    expect(sentenceFilterAction).toContain('{ name: "longpress", label: "문장 선택 모드 열기" }');
    expect(sentenceFilterAction).toContain('nativeEvent.actionName === "longpress"');
    expect(sentenceFilterAction).toContain('nativeEvent.actionName === "activate"');
    expect(archiveScreen).toContain('router.push("/stored-sentence-create")');
  });

  it("reserves matching list and swipe overflow space for raised hearts", () => {
    expect(archiveScreen).toContain("const SENTENCE_BADGE_OVERFLOW = 12");
    expect(regularRenderer).toContain("overflowTop={SENTENCE_BADGE_OVERFLOW}");
    expect(archiveScreen).toContain("styles.sentenceListContent");
    expect(archiveScreen).toContain("paddingTop: SENTENCE_BADGE_OVERFLOW");
  });

  it("renders stored text without decorative quotation marks", () => {
    expect(regularRenderer).toContain("text={item.text}");
    expect(selectionRenderer).toContain("text={item.text}");
    expect(regularRenderer).not.toContain("&ldquo;");
    expect(selectionRenderer).not.toContain("&rdquo;");
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

describe("manual stored sentence creation", () => {
  const createScreen = readFileSync(join(appRoot, "app/stored-sentence-create.tsx"), "utf8");

  it("uses the standard back and menu header around the editable detail card", () => {
    expect(createScreen).toContain('<HeaderButton variant="back"');
    expect(createScreen).toContain('<HeaderButton variant="menu"');
    expect(createScreen).toContain("<TextInput");
    expect(createScreen).toContain('accessibilityLabel="문장 본문"');
    expect(createScreen).toContain('accessibilityLabel="문장 출처"');
    expect(createScreen).toContain('placeholder="저자, <제목>, 면 수"');
    expect(createScreen).toContain("multiline");
    expect(createScreen).toContain("minHeight: 280");
  });

  it("saves the body and optional custom source, then refreshes the archive", () => {
    expect(createScreen).toContain("useCreateStoredSentence()");
    expect(createScreen).toContain("text: bodyText.trim()");
    expect(createScreen).toContain("sourceText: sourceText.trim() || null");
    expect(createScreen).not.toContain('articleId: "custom"');
    expect(createScreen).toContain("getListStoredSentencesQueryKey({ userId })");
    expect(createScreen).toContain("router.back()");
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
    expect(detailScreen).toContain("<StoredSentenceCard");
    expect(sentenceCard).toContain('fontFamily: ReaderTokens.fontFamily.serifBold');
    expect(detailScreen).toContain('"제목 없는 원문"');
    expect(detailScreen).toContain('"저장 위치 없음"');
    expect(detailScreen).toContain('"저자 미상"');
    expect(detailScreen).toContain("sentence.sourceText?.trim()");
    expect(detailScreen).toContain("sentence.articleAuthorName");
    expect(detailScreen).toContain("}, <${sentence.articleTitle");
    expect(detailScreen).toContain("new Date(sentence.createdAt).toLocaleDateString");
    expect(detailScreen).toContain("<ScrollView");
    expect(detailScreen).toContain("invalidateQueries({ queryKey: getListStoredSentencesQueryKey");
    expect(detailScreen).toContain("router.back()");
  });

  it("shows a passive favorite badge and optimistically updates every sentence cache", () => {
    expect(detailScreen).toContain("isFavorite={sentence.isFavorite}");
    expect(sentenceCard).toContain('pointerEvents="none"');
    expect(sentenceCard).toContain('name="heart"');
    expect(detailScreen).toContain("optimisticallySetStoredSentenceFavorite");
    expect(detailScreen).toContain("applyStoredSentenceFavoriteResponse");
    expect(detailScreen).toContain("rollbackStoredSentenceFavorite");
  });

  it("renders sentence text without decorative quotation marks", () => {
    expect(detailScreen).toContain("text={sentence.text}");
    expect(detailScreen).not.toContain("&ldquo;");
    expect(detailScreen).not.toContain("&rdquo;");
  });
});
