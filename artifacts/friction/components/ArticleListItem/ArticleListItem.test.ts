import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const listItemSource = readFileSync(
  new URL("./ArticleListItem.tsx", import.meta.url),
  "utf8",
);
const coverSource = readFileSync(
  new URL("../ArticleCardItem/ArticleCardCover.tsx", import.meta.url),
  "utf8",
);
const pickerSource = readFileSync(
  new URL("../shared/LetterPickerSheet.tsx", import.meta.url),
  "utf8",
);
const replyPickerSource = readFileSync(
  new URL("../shared/ReplyLetterPickerModal.tsx", import.meta.url),
  "utf8",
);
const sharedPickerListSource = readFileSync(
  new URL("../shared/LetterPickerList.tsx", import.meta.url),
  "utf8",
);
const sendInlineSource = readFileSync(
  new URL("../ToInline/SendInline.tsx", import.meta.url),
  "utf8",
);
const scheduleSheetSource = readFileSync(
  new URL("../ArticleScheduleSheet/ArticleScheduleSheet.tsx", import.meta.url),
  "utf8",
);
const gridPickerSheetSource = readFileSync(
  new URL("../ArticleScheduleSheet/LetterGridPickerSheet.tsx", import.meta.url),
  "utf8",
);
const sharedPickerGridSource = readFileSync(
  new URL("../shared/LetterPickerGrid.tsx", import.meta.url),
  "utf8",
);
const collectionDetailSource = readFileSync(
  new URL("../../app/of-01-detail.tsx", import.meta.url),
  "utf8",
);

describe("ArticleListItem contract", () => {
  it("renders the shared cover surface with only title and author metadata", () => {
    expect(listItemSource).toContain('layout="list"');
    expect(listItemSource).toContain("title={displayTitle}");
    expect(listItemSource).toContain(
      "authorName={authorName?.trim() || undefined}",
    );

    for (const unsupportedProp of [
      "preview",
      "timestamp",
      "statusBadge",
      "deliveryBadge",
      "rightMeta",
      "collectionName",
    ]) {
      expect(listItemSource).not.toContain(unsupportedProp);
    }
  });

  it("keeps row interaction and accessibility owned by the caller", () => {
    expect(listItemSource).toContain("articleId: string");
    expect(listItemSource).toContain("onPress={onPress}");
    expect(listItemSource).toContain("onLongPress={onLongPress}");
    expect(listItemSource).toContain('accessibilityRole="button"');
    expect(listItemSource).toContain("accessibilityLabel={");
  });

  it("announces and visibly marks the selected letter", () => {
    expect(listItemSource).toContain("selected?: boolean");
    expect(listItemSource).toContain(
      "accessibilityState={{ disabled, selected }}",
    );
    expect(listItemSource).toContain("styles.selectedIndicator");
    expect(listItemSource).toContain('name="check"');
  });

  it("uses the raised card surface contract for record and send lists", () => {
    expect(listItemSource).toContain("marginHorizontal: Spacing.screenPx");
    expect(listItemSource).toContain("marginBottom: Spacing.cardGap");
    expect(listItemSource).toContain("borderRadius: 16");
    expect(listItemSource).toContain("borderRadius={16}");
    expect(listItemSource).toContain("backgroundColor: Colors.white");
    expect(listItemSource).toContain("...Shadows.listCard");
    expect(listItemSource).not.toContain("borderBottomWidth");
    expect(listItemSource).toContain("height: ARTICLE_LIST_ITEM_HEIGHT");
    expect(listItemSource).toContain("flexGrow: 0");
    expect(listItemSource).toContain("flexShrink: 0");
    expect(sharedPickerListSource).toContain("<ArticleListItem");
  });

  it("uses one searchable, newest-first list for send and reply selection", () => {
    expect(pickerSource).toContain("<LetterPickerList");
    expect(replyPickerSource).toContain("<LetterPickerSelectionSheet");
    expect(sharedPickerListSource).toContain("<ArticleListItem");
    expect(sharedPickerListSource).toContain('placeholder="제목으로 검색"');
    expect(sharedPickerListSource).toContain("sortAndFilterLetterPickerItems");
    expect(sharedPickerListSource).toContain("scrollToIndex");
    expect(sharedPickerListSource).toContain("selectedId");
    expect(replyPickerSource).toContain("onSelect={onSelect}");
  });

  it("preserves dates and passes cover/author metadata to the space schedule flow's grid picker", () => {
    expect(scheduleSheetSource).toContain("<LetterGridPickerSheet");
    expect(scheduleSheetSource).not.toContain("<LetterPickerSheet");
    expect(scheduleSheetSource).toContain("createdAt: a.createdAt");
    expect(scheduleSheetSource).toContain("updatedAt: a.updatedAt");
    expect(scheduleSheetSource).toContain("cover: a.cover");
    expect(scheduleSheetSource).toContain("authorNickname: a.authorNickname");
  });

  it("renders the space schedule flow's letter picker as a 3-column cover-card grid, not a list", () => {
    expect(gridPickerSheetSource).toContain("<LetterPickerSelectionSheet");
    expect(gridPickerSheetSource).toContain('bodyVariant="grid"');
    expect(gridPickerSheetSource).toContain("getSendArticleAuthorName(article)");
    expect(gridPickerSheetSource).not.toMatch(/import\s+\{\s*LetterPickerList\s*[,}]/);
    expect(gridPickerSheetSource).not.toContain("ArticleListItem");

    expect(sharedPickerGridSource).toContain("<ArticleCardItem");
    expect(sharedPickerGridSource).toContain("<CanonicalCardSlot");
    expect(sharedPickerGridSource).toContain("<LetterPickerSearchBar");
    expect(sharedPickerGridSource).toContain("GRID_COLS = 3");
    expect(sharedPickerGridSource).not.toContain("<ArticleListItem");
  });

  it("keeps the other letter pickers (space wizard, personal send, reply) on the default list body", () => {
    expect(pickerSource).toContain("<LetterPickerList");
    expect(pickerSource).toContain('bodyVariant = "list"');
    // The space-wizard/personal-send LetterPickerSheet must not opt into the grid.
    const letterPickerSheetFn = pickerSource.slice(
      pickerSource.indexOf("export function LetterPickerSheet("),
    );
    expect(letterPickerSheetFn).not.toContain("bodyVariant");
  });

  it("uses a non-blocking cached cover image with a synchronous fallback", () => {
    expect(coverSource).toContain('contentFit="cover"');
    expect(coverSource).toContain('cachePolicy="memory-disk"');
    expect(coverSource).toContain("displayedImageUrl === imageUrl");
    expect(coverSource).toContain("onError={handleImageError}");
  });

  it("uses the same cover row in the send preview and picker without body previews or detail queries", () => {
    expect(sendInlineSource).toContain("<ArticleListItem");
    expect(sharedPickerListSource).toContain("<ArticleListItem");
    expect(sendInlineSource).toContain(
      "getSendArticleAuthorName(displayedArticle)",
    );
    expect(pickerSource).toContain("getSendArticleAuthorName(article)");
    expect(pickerSource).not.toContain("content.substring");
    expect(pickerSource).not.toContain("ArticleCardCover");
    expect(sendInlineSource).not.toContain("useGetArticle");
    expect(pickerSource).not.toContain("useGetArticle");
  });

  it("uses the shared cover row for collection list and selection modes", () => {
    expect(collectionDetailSource.match(/<ArticleListItem/g)).toHaveLength(2);
    expect(collectionDetailSource).toContain(
      "authorName={item.article?.authorNickname}",
    );
    expect(collectionDetailSource).toContain("cover={item.article?.cover}");
    expect(collectionDetailSource).toContain(
      'title={item.article?.title ?? ""}',
    );
    expect(collectionDetailSource).toContain("selected={isSelected}");
  });

  it("keeps collection swipe actions aligned with the raised card geometry", () => {
    expect(collectionDetailSource).toContain(
      "actionRightInset={Spacing.screenPx}",
    );
    expect(collectionDetailSource).toContain(
      "actionBottomInset={Spacing.cardGap}",
    );
    expect(collectionDetailSource).toContain("onSwipeOpen={() => handleSwipeOpen(item.articleId)}");
    expect(collectionDetailSource).toContain(
      "onScrollLock={(locked) => setScrollEnabled(!locked)}",
    );
    expect(collectionDetailSource).toContain("color: Colors.primaryAction");
  });
});
