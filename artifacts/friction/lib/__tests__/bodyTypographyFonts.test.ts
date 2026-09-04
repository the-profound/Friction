import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BODY_FONT_ASSET_PATHS,
  BODY_FONT_CONFIG_VERSION,
  BODY_FONT_FALLBACK_ONLY_PROBE_TEXT,
  BODY_FONT_FALLBACK_PROBE_TEXT,
  BODY_NATIVE_FONT_ASSET_PATHS,
  BODY_REGULAR_FONT_FAMILY,
  BODY_SEMIBOLD_FONT_FAMILY,
  buildBodyFontReadyScript,
} from "../../components/shared/bodyTypographyFonts";

const appRoot = join(__dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

describe("global Eulyoo body-font fallback contract", () => {
  it("uses the same Eulyoo-first and Noto-fallback families in WebViews", () => {
    expect(BODY_REGULAR_FONT_FAMILY).toBe(
      "'Eulyoo1945-Regular','NotoSerifKR_400Regular',serif",
    );
    expect(BODY_SEMIBOLD_FONT_FAMILY).toBe(
      "'Eulyoo1945-SemiBold','NotoSerifKR_600SemiBold',serif",
    );
    expect(BODY_FONT_FALLBACK_ONLY_PROBE_TEXT).toBe("핟");
    expect(BODY_FONT_FALLBACK_PROBE_TEXT).toBe("가핟");

    const readyScript = buildBodyFontReadyScript(true);
    expect(readyScript).toContain(JSON.stringify("핟"));
    expect(readyScript).toContain("notoRegularFallback");
    expect(readyScript).toContain("notoSemiBoldFallback");
    expect(BODY_FONT_CONFIG_VERSION).toContain("global-fallback");
  });

  it("loads composite native body fonts under the shared family aliases", () => {
    const layout = read("app/_layout.tsx");
    const tokens = read("constants/tokens.ts");

    expect(BODY_NATIVE_FONT_ASSET_PATHS).toEqual([
      "assets/fonts/Eulyoo1945-Regular-Body.otf",
      "assets/fonts/Eulyoo1945-SemiBold-Body.otf",
    ]);
    for (const assetPath of BODY_NATIVE_FONT_ASSET_PATHS) {
      expect(readFileSync(join(appRoot, assetPath)).subarray(0, 4).toString("ascii"))
        .toBe("OTTO");
      expect(layout).toContain(assetPath.replace("assets/fonts/", "../assets/fonts/"));
    }
    expect(layout).toContain('"Eulyoo1945-Regular": require(');
    expect(layout).toContain('"Eulyoo1945-SemiBold": require(');
    expect(tokens).toContain("web: BODY_REGULAR_FONT_FAMILY");
    expect(tokens).toContain("web: BODY_SEMIBOLD_FONT_FAMILY");
  });

  it("keeps all WebView font assets in the versioned shared contract", () => {
    expect(BODY_FONT_ASSET_PATHS).toHaveLength(4);
    const validator = read("scripts/validate-body-font-glyphs.py");
    const diagnostics = read("lib/bodyTypographyDiagnostics.ts");
    const editorSource = read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts");
    expect(validator).toContain('FALLBACK_PROBE = ord("핟")');
    expect(validator).toContain("EXPECTED_NOTO_HANGUL_COUNT");
    expect(validator).toContain("Native Regular and SemiBold expose different Hangul coverage");
    expect(validator).toContain("validate_eulyoo_artwork_preserved");
    expect(validator).toContain("changed Eulyoo artwork or metrics");
    expect(diagnostics).toContain("BODY_FONT_FALLBACK_PROBE_TEXT");
    expect(diagnostics).not.toContain('"가잓"');
    expect(editorSource).toContain("BODY_FONT_FALLBACK_PROBE_TEXT");
    expect(editorSource).not.toContain('"가잓"');
  });
});