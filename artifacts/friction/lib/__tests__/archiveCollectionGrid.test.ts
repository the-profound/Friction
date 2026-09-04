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
