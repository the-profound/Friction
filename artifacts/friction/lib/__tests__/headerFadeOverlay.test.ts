import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const pageHeader = readFileSync(
  join(appRoot, "components/NavBar/PageHeader.tsx"),
  "utf8",
);
const spacesScreen = readFileSync(join(appRoot, "app/(tabs)/of.tsx"), "utf8");
const recordsScreen = readFileSync(join(appRoot, "app/(tabs)/on.tsx"), "utf8");
const archiveScreen = readFileSync(
  join(appRoot, "app/(tabs)/archive.tsx"),
  "utf8",
);

describe("shared header fade overlay", () => {
  it("keeps decorative layers non-interactive inside an absolute overlay", () => {
    const component = pageHeader.slice(
      pageHeader.indexOf("export function HeaderFadeOverlay"),
      pageHeader.indexOf("interface PageHeaderProps"),
    );
    const styles = pageHeader.slice(pageHeader.indexOf("fadeOverlay:"));

    expect(component).toContain('pointerEvents="box-none"');
    expect(component.match(/pointerEvents="none"/g)).toHaveLength(2);
    expect(styles).toContain('position: "absolute"');
    expect(component).toContain("controlHeight + fadeHeight");
  });

  it("uses the shared overlay as the last content-area sibling on all three lists", () => {
    expect(spacesScreen).toMatch(
      /<HeaderFadeOverlay controlHeight={HEADER_ROW_CONTENT_HEIGHT}>[\s\S]*?<\/HeaderFadeOverlay>\s*<\/View>/,
    );
    expect(recordsScreen).toMatch(
      /<HeaderFadeOverlay controlHeight={FILTER_BAR_HEIGHT}>[\s\S]*?<\/HeaderFadeOverlay>\s*<\/View>/,
    );
    expect(archiveScreen).toMatch(
      /{renderContent\(\)}[\s\S]*?<HeaderFadeOverlay controlHeight={FILTER_ROW_HEIGHT}>[\s\S]*?<\/HeaderFadeOverlay>\s*<\/View>/,
    );
    expect(archiveScreen).not.toContain("<HeaderFadeTail");
  });

  it("reserves the archive control height in every content branch", () => {
    const reservations =
      archiveScreen.match(/paddingTop:\s*FILTER_ROW_HEIGHT/g) ?? [];
    expect(reservations.length).toBeGreaterThanOrEqual(5);
  });
});