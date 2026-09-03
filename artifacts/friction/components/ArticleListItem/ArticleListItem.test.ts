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

  it("uses a non-blocking cached cover image with a synchronous fallback", () => {
    expect(coverSource).toContain('contentFit="cover"');
    expect(coverSource).toContain('cachePolicy="memory-disk"');
    expect(coverSource).toContain("displayedImageUrl === imageUrl");
    expect(coverSource).toContain("onError={handleImageError}");
  });
});
