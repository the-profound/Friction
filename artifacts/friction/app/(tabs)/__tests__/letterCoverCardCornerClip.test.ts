import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

const componentsRoot = join(appRoot, "..", "components");
const readComponent = (relativePath: string) =>
  readFileSync(join(componentsRoot, relativePath), "utf8");

/**
 * Every `.tsx` screen under `app/`, as paths relative to `appRoot`. Used so
 * regression coverage below applies to whichever screens actually use
 * `CanonicalCardSlot`/`carouselShadow` today, instead of a maintained list of
 * filenames that silently stops covering new or newly-fixed screens.
 */
function listAppScreenFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listAppScreenFiles(full));
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const appScreenFiles = listAppScreenFiles(appRoot).map((f) =>
  relative(appRoot, f),
);

/**
 * Every `<CanonicalCardSlot ...>...</CanonicalCardSlot>` block in a source
 * string, split into its opening-tag props and its body (the JSX between the
 * opening and closing tags). Self-closing slots (no children) are skipped —
 * shadow ownership only applies once a card is actually projected inside.
 *
 * This assumes (like the rest of this file's regexes) that a slot's opening
 * tag never itself contains a bare `>` inside an attribute expression (e.g.
 * an inline arrow function) — true for every usage in this codebase today.
 */
function findCanonicalCardSlotBlocks(
  source: string,
): { openProps: string; body: string }[] {
  const blocks: { openProps: string; body: string }[] = [];
  const openTagPattern = /<CanonicalCardSlot([\s\S]*?)>/g;
  let match: RegExpExecArray | null;
  while ((match = openTagPattern.exec(source))) {
    const openProps = match[1];
    if (openProps.trim().endsWith("/")) continue;
    const bodyStart = match.index + match[0].length;
    const closeIndex = source.indexOf("</CanonicalCardSlot>", bodyStart);
    const body =
      closeIndex === -1
        ? source.slice(bodyStart)
        : source.slice(bodyStart, closeIndex);
    blocks.push({ openProps, body });
  }
  return blocks;
}

// Regression coverage for a corner-leak bug: the 기록 tab drew letter covers
// directly (no outer wrapper owning the final radius+clip), and any grid that
// opts a letter cover into the restrained carousel shadow token must open its
// CardSelectOverlay with the same token — otherwise the shadow visibly pops
// to the larger standard token right at the card's rounded corners.
describe("letter cover card corner clipping", () => {
  it("wraps the 기록 tab's letter cover in a shadow-owning CanonicalCardSlot", () => {
    const onScreen = read("(tabs)/on.tsx");
    const letterBranch = onScreen.match(
      /if \(record\.kind === "letter"\) \{[\s\S]*?\n {2}\}/,
    )?.[0] ?? "";

    expect(letterBranch).toContain("<CanonicalCardSlot");
    expect(letterBranch).toContain("</CanonicalCardSlot>");
    expect(letterBranch).toContain("carouselShadow");
    expect(letterBranch).not.toContain("carouselShadow={true}");
    // The slot itself now owns the card's rendered size; ArticleCardItem must
    // not also be forced to a native cardWidth inside it.
    expect(letterBranch).not.toContain("cardWidth={width}");
  });

  it("opens the overlay with originUsesCarouselShadow wherever a letter grid uses the carousel shadow token", () => {
    // File-name-agnostic: any screen under app/ that opts a letter card into
    // the restrained carousel shadow token — whether via CanonicalCardSlot's
    // own `carouselShadow` prop (the only supported way to pair it with a
    // card projected through the slot) or, for screens that don't use the
    // slot at all, directly on ArticleCardItem — must open its
    // CardSelectOverlay with the matching option. This intentionally has no
    // hardcoded screen list, so a new screen (or another task's fix to an
    // existing screen) that adopts this pattern is covered automatically.
    for (const relativePath of appScreenFiles) {
      const source = read(relativePath);
      if (!/\bcarouselShadow\b/.test(source)) continue;

      expect(
        source,
        `${relativePath} uses the restrained carousel shadow token but never opens its overlay with originUsesCarouselShadow: true — the shadow will visibly pop to the larger standard token when the overlay opens or closes.`,
      ).toContain("originUsesCarouselShadow: true");
    }
  });

  it("keeps CanonicalCardSlot the sole shadow owner wherever a screen opts a projected card into the carousel shadow token", () => {
    // The supported pattern is: CanonicalCardSlot itself draws the shadow on
    // its unclipped outer boundary (and disables the child card's own
    // shadow). A card that also declares its own `carouselShadow` while
    // nested in such a slot is the retired pattern — the shadow is drawn a
    // second time inside the slot's clipping boundary, where it gets cut off
    // whenever the slot's static resting shadow (rather than the overlay's
    // uncropped one) is what's visible.
    for (const relativePath of appScreenFiles) {
      const source = read(relativePath);
      const slotBlocks = findCanonicalCardSlotBlocks(source);

      for (const { openProps, body } of slotBlocks) {
        if (!/\bcarouselShadow\b/.test(openProps)) continue;

        expect(
          body,
          `${relativePath}: a CanonicalCardSlot using carouselShadow must be the sole shadow owner — its nested ArticleCardItem must not also declare carouselShadow.`,
        ).not.toMatch(/<ArticleCardItem[\s\S]*?\bcarouselShadow\b/);
      }
    }
  });
});

// Regression coverage for two press-feedback corner defects fixed together:
//   A) In CanonicalCardSlot-scaled screens (e.g. the space-detail round
//      carousel), the press-in shrink used to animate only the inner
//      canonical-sized content while the outer slot box (which owns the
//      final radius + clip) stayed a fixed size — opening a gap between the
//      shrunk card and the slot's clip boundary.
//   B) ArticleCardCover relied on the cover image's own internal
//      border-radius clip instead of clipping itself, so a hairline of the
//      shadow layer's background could show through the rounded corners
//      while the press transform was live.
describe("card press-scale corner clipping", () => {
  it("lets ArticleCardCover clip its own corners instead of relying on the image's internal radius", () => {
    const source = readComponent("ArticleCardItem/ArticleCardCover.tsx");
    const rootStyleBlock =
      source.match(/style=\{\[\s*styles\.root,[\s\S]*?\]\}/)?.[0] ?? "";

    expect(rootStyleBlock).toContain('overflow: "hidden"');
  });

  it("has ScalePressable support an external shared value so an ancestor can mirror its press scale", () => {
    const source = readComponent("shared/ScalePressable.tsx");

    expect(source).toContain("externalScale");
    expect(source).toContain("applyScaleStyle");
    // The internal scale must fall back to externalScale when provided,
    // rather than always animating a private shared value that no ancestor
    // can observe.
    expect(source).toMatch(/externalScale\s*\?\?\s*localScale/);
  });

  it("forwards CanonicalCardSlot's pressScale into ArticleCardItem's ScalePressable instead of animating its own transform", () => {
    const source = readComponent("ArticleCardItem/ArticleCardItem.tsx");

    expect(source).toContain("pressScale");
    expect(source).toContain("externalScale={pressScale}");
    expect(source).toContain("applyScaleStyle={!pressScale}");
  });

  it("makes CanonicalCardSlot's shadow, clip, and content scale as one unit", () => {
    const source = readComponent("ArticleCardItem/CanonicalCardSlot.tsx");

    // The unclipped outer node must own the shared transform, with the clip
    // nested beneath it so shadow, corners, and content move together.
    expect(source).toContain("useSharedValue(1)");
    expect(source).toMatch(
      /transform:\s*\[\{\s*scale:\s*pressScale\.value\s*\}\]/,
    );
    expect(source).toContain("RAnimated.View");
    expect(source).toContain('overflow: "visible"');
    expect(source).toContain("styles.clip");
    // The same shared value must reach the ArticleCardItem child so its own
    // ScalePressable writes into it (single source of truth for the ratio).
    expect(source).toMatch(/cloneElement\([\s\S]*?\{\s*pressScale,/);
  });

  it("renders the carousel shadow once outside the rounded content clip", () => {
    const slot = readComponent("ArticleCardItem/CanonicalCardSlot.tsx");

    expect(slot).toContain("...Shadows.carouselCard");
    expect(slot).toContain("carouselShadow && styles.carouselShadow");
    expect(slot).toMatch(
      /carouselShadow\s*\?\s*\{\s*noShadow:\s*true\s*\}\s*:\s*\{\}/,
    );

    const outerStyle =
      slot.match(/outer:\s*\{([^}]*)\}/)?.[1] ?? "";
    const clipStyle =
      slot.match(/clip:\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(outerStyle).toContain('overflow: "visible"');
    expect(outerStyle).not.toContain('overflow: "hidden"');
    expect(clipStyle).toContain('overflow: "hidden"');
    expect(clipStyle).not.toContain("Shadows.");
  });
});