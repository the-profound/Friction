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
 * `CanonicalCardSlot`/`ArticleCardItem` today, instead of a maintained list
 * of filenames that silently stops covering new or newly-fixed screens.
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

describe("letter cover card corner clipping", () => {
  it("wraps the 기록 tab's letter cover in a CanonicalCardSlot", () => {
    const onScreen = read("(tabs)/on.tsx");
    const letterBranch = onScreen.match(
      /if \(record\.kind === "letter"\) \{[\s\S]*?\n {2}\}/,
    )?.[0] ?? "";

    expect(letterBranch).toContain("<CanonicalCardSlot");
    expect(letterBranch).toContain("</CanonicalCardSlot>");
    // The slot itself now owns the card's rendered size; ArticleCardItem must
    // not also be forced to a native cardWidth inside it.
    expect(letterBranch).not.toContain("cardWidth={width}");
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

  it("makes CanonicalCardSlot's clip and content scale as one unit", () => {
    const source = readComponent("ArticleCardItem/CanonicalCardSlot.tsx");

    // The unclipped outer node must own the shared transform, with the clip
    // nested beneath it so corners and content move together.
    expect(source).toContain("useSharedValue(1)");
    expect(source).toMatch(
      /transform:\s*\[\{\s*scale:\s*pressScale\.value\s*\}\]/,
    );
    expect(source).toContain("RAnimated.View");
    expect(source).toContain('overflow: "visible"');
    expect(source).toContain("styles.clip");
    // The same shared value must reach the ArticleCardItem child so its own
    // ScalePressable writes into it (single source of truth for the ratio).
    expect(source).toMatch(/cloneElement\([\s\S]*?\{\s*pressScale/);
  });
});

// Regression coverage: the letter card module (CanonicalCardSlot +
// ArticleCardItem + CardSelectOverlay) must render a flat, shadow-free
// surface in every state — resting slot and selection overlay alike. This
// intentionally has no hardcoded screen list: any screen under app/ that
// uses the module is covered automatically, so a new screen (or a
// regression reintroducing the old shadow pattern on an existing one) fails
// this test instead of silently reintroducing the shadow-pop bug this
// module was built to eliminate.
describe("letter card module never renders a shadow", () => {
  // Retired props/shared-values that used to turn the shadow on somewhere in
  // the module. None of them should exist anywhere in the module's own
  // component source or any screen using it.
  const RETIRED_SHADOW_TOKENS = [
    "carouselShadow",
    "noShadow",
    "shadowProgress",
    "shadowScale",
    "originUsesCarouselShadow",
    "heroScale",
  ];

  it("never applies the shared Shadows.card/Shadows.carouselCard tokens inside ArticleCardItem or CanonicalCardSlot", () => {
    const articleCardItem = readComponent(
      "ArticleCardItem/ArticleCardItem.tsx",
    );
    const canonicalCardSlot = readComponent(
      "ArticleCardItem/CanonicalCardSlot.tsx",
    );

    expect(articleCardItem).not.toContain("Shadows.");
    expect(canonicalCardSlot).not.toContain("Shadows.");
  });

  it("never interpolates a shadow style inside CardSelectOverlay", () => {
    const overlay = readComponent(
      "CardSelectOverlay/CardSelectOverlay.tsx",
    );

    expect(overlay).not.toMatch(/shadowOpacity|shadowRadius|shadowOffset/);
    expect(overlay).not.toContain("boxShadow");
  });

  it("has removed every retired shadow prop/shared-value from the module's own components", () => {
    const articleCardItem = readComponent(
      "ArticleCardItem/ArticleCardItem.tsx",
    );
    const canonicalCardSlot = readComponent(
      "ArticleCardItem/CanonicalCardSlot.tsx",
    );
    const overlay = readComponent(
      "CardSelectOverlay/CardSelectOverlay.tsx",
    );

    for (const token of RETIRED_SHADOW_TOKENS) {
      const pattern = new RegExp(`\\b${token}\\b`);
      expect(
        articleCardItem,
        `ArticleCardItem.tsx still references retired shadow token "${token}"`,
      ).not.toMatch(pattern);
      expect(
        canonicalCardSlot,
        `CanonicalCardSlot.tsx still references retired shadow token "${token}"`,
      ).not.toMatch(pattern);
      expect(
        overlay,
        `CardSelectOverlay.tsx still references retired shadow token "${token}"`,
      ).not.toMatch(pattern);
    }
  });

  it("has no screen re-enabling a shadow via a retired prop on CanonicalCardSlot or ArticleCardItem", () => {
    // File-name-agnostic: every .tsx screen under app/ is scanned, so a new
    // screen adopting the module is covered automatically. Matches a JSX
    // opening tag for either component and checks its prop list (up to the
    // matching `>`) for any retired shadow token/prop name.
    const openTagPattern = /<(CanonicalCardSlot|ArticleCardItem)\b([\s\S]*?)>/g;

    for (const relativePath of appScreenFiles) {
      const source = read(relativePath);
      let match: RegExpExecArray | null;
      openTagPattern.lastIndex = 0;
      while ((match = openTagPattern.exec(source))) {
        const [, componentName, propsText] = match;
        for (const token of RETIRED_SHADOW_TOKENS) {
          const pattern = new RegExp(`\\b${token}\\b`);
          expect(
            propsText,
            `${relativePath}: <${componentName}> passes retired shadow prop "${token}" — this module renders no shadow in any state; remove it instead of trying to re-enable one.`,
          ).not.toMatch(pattern);
        }
      }
    }
  });

  it("has no screen opening its overlay with a retired shadow option", () => {
    for (const relativePath of appScreenFiles) {
      const source = read(relativePath);
      for (const token of ["originUsesCarouselShadow"]) {
        expect(
          source,
          `${relativePath} still passes the retired "${token}" overlay option — CardSelectOverlay no longer interpolates a shadow, so this option no longer exists.`,
        ).not.toContain(token);
      }
    }
  });
});
