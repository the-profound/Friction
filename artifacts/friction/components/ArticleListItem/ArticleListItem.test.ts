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
const sendInlineSource = readFileSync(
  new URL("../ToInline/SendInline.tsx", import.meta.url),
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
    expect(listItemSource).toContain("accessibilityState={{ disabled, selected }}");
    expect(listItemSource).toContain("styles.selectedIndicator");
    expect(listItemSource).toContain('name="check"');
  });

  it("uses a non-blocking cached cover image with a synchronous fallback", () => {
    expect(coverSource).toContain('contentFit="cover"');
    expect(coverSource).toContain('cachePolicy="memory-disk"');
    expect(coverSource).toContain("displayedImageUrl === imageUrl");
    expect(coverSource).toContain("onError={handleImageError}");
  });

  it("uses the same cover row in the send preview and picker without body previews or detail queries", () => {
    expect(sendInlineSource).toContain("<ArticleListItem");
    expect(pickerSource).toContain("<ArticleListItem");
    expect(sendInlineSource).toContain("getSendArticleAuthorName(selectedArticle)");
    expect(pickerSource).toContain("getSendArticleAuthorName(article)");
    expect(pickerSource).not.toContain("content.substring");
    expect(pickerSource).not.toContain("ArticleCardCover");
    expect(sendInlineSource).not.toContain("useGetArticle");
    expect(pickerSource).not.toContain("useGetArticle");
  });
});
