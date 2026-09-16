import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const overlayPath = join(__dirname, "../CardSelectOverlay.tsx");
const cardItemPath = join(__dirname, "../../ArticleCardItem/ArticleCardItem.tsx");
const readOverlay = () => readFileSync(overlayPath, "utf8");
const readCardItem = () => readFileSync(cardItemPath, "utf8");

describe("hero card shadow stays visible while the transform scale is small", () => {
  it("CardSelectOverlay derives heroScale from the same progress/originScale/finalScale interpolation", () => {
    const overlay = readOverlay();
    expect(overlay).toContain(
      "const heroScale = useDerivedValue(() =>\n    interpolate(progress.value, [0, 1], [originScale, finalScale]),\n  );",
    );
  });

  it("both hero ArticleCardItem render sites pass shadowScale alongside shadowProgress", () => {
    const overlay = readOverlay();
    const shadowScaleOccurrences = overlay.match(/shadowScale=\{/g) ?? [];
    // One for the chained-pager hero slot, one for the single-card path.
    expect(shadowScaleOccurrences.length).toBe(2);
  });

  it("the animated shadow style divides size-based terms by shadowScale, leaving opacity untouched", () => {
    const cardItem = readCardItem();
    const start = cardItem.indexOf("function useAnimatedCardSurfaceShadowStyle(");
    expect(start).toBeGreaterThan(-1);
    const fn = cardItem.slice(start, cardItem.indexOf("\n}\n", start));

    // Radius/offset/elevation/blur are pixel sizes that a parent
    // `transform: scale` shrinks along with everything else it renders --
    // divide them by the current scale so the on-screen result matches the
    // resting (unscaled) slot's shadow throughout the transition, not just
    // once the transform is gone.
    expect(fn).toContain("counterScale = shadowScale ? shadowScale.value : 1");
    expect(fn).toMatch(/height: interpolate\([^)]*\) \/ counterScale/);
    expect(fn).toMatch(/shadowRadius: interpolate\([^)]*\) \/ counterScale/);
    expect(fn).toMatch(/elevation: interpolate\([^)]*\) \/ counterScale/);
    expect(fn).toMatch(/const offsetY = interpolate\([^)]*\) \/ counterScale/);
    expect(fn).toMatch(/const blur = interpolate\([^)]*\) \/ counterScale/);

    // Opacity/alpha is scale-invariant (a semi-transparent color's alpha
    // does not change when the layer it paints is scaled) -- it must NOT be
    // divided by counterScale.
    expect(fn).toMatch(/shadowOpacity: interpolate\([^)]*\[0\.1, 0\.12\]\),\n/);
    expect(fn).not.toMatch(/shadowOpacity: interpolate\([^)]*\) \/ counterScale/);
    expect(fn).toMatch(/const alpha = interpolate\([^)]*\[0\.1, 0\.12\]\);\n/);
    expect(fn).not.toMatch(/const alpha = interpolate\([^)]*\) \/ counterScale/);
  });
});
