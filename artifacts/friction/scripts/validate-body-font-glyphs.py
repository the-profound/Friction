#!/usr/bin/env fontforge
"""Validate the actual glyph/fallback contract of bundled WebView fonts."""

import json
import os
import sys

import fontforge


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
FONT_DIR = os.path.join(PROJECT_ROOT, "assets", "fonts")
HANGUL_START = 0xAC00
HANGUL_END = 0xD7A3
PRIMARY_PROBE = ord("가")
FALLBACK_PROBE = ord("잓")
EXPECTED_EULYOO_HANGUL_COUNT = 2780
EXPECTED_NOTO_HANGUL_COUNT = HANGUL_END - HANGUL_START + 1


def has_outline(glyph):
    return (
        len(glyph.foreground) > 0
        or len(glyph.references) > 0
        or glyph.boundingBox() != (0.0, 0.0, 0.0, 0.0)
    )


def inspect_font(filename):
    font = fontforge.open(os.path.join(FONT_DIR, filename))
    mapped = {}
    for glyph in font.glyphs():
        codepoint = glyph.unicode
        if HANGUL_START <= codepoint <= HANGUL_END:
            mapped[codepoint] = has_outline(glyph)
    font.close()
    empty = sorted(codepoint for codepoint, outlined in mapped.items() if not outlined)
    return {
        "filename": filename,
        "mapped": mapped,
        "empty": empty,
        "primaryOutlined": mapped.get(PRIMARY_PROBE) is True,
        "fallbackOutlined": mapped.get(FALLBACK_PROBE) is True,
    }


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    eulyoo = [
        inspect_font("Eulyoo1945-Regular.woff2"),
        inspect_font("Eulyoo1945-SemiBold.woff2"),
    ]
    noto = [
        inspect_font("NotoSerifKR-400Regular-korean.woff2"),
        inspect_font("NotoSerifKR-600SemiBold-korean.woff2"),
    ]

    for result in eulyoo:
        require(not result["empty"], "%s still maps empty Hangul glyphs" % result["filename"])
        require(
            len(result["mapped"]) == EXPECTED_EULYOO_HANGUL_COUNT,
            "%s maps %d outlined Hangul glyphs; expected %d"
            % (
                result["filename"],
                len(result["mapped"]),
                EXPECTED_EULYOO_HANGUL_COUNT,
            ),
        )
        require(result["primaryOutlined"], "%s lacks the Eulyoo probe 가" % result["filename"])
        require(
            FALLBACK_PROBE not in result["mapped"],
            "%s still advertises fallback-only probe 잓" % result["filename"],
        )

    require(
        set(eulyoo[0]["mapped"]) == set(eulyoo[1]["mapped"]),
        "Eulyoo Regular and SemiBold expose different Hangul coverage",
    )

    for result in noto:
        require(not result["empty"], "%s contains empty Hangul glyphs" % result["filename"])
        require(
            len(result["mapped"]) == EXPECTED_NOTO_HANGUL_COUNT,
            "%s does not cover all modern Hangul syllables" % result["filename"],
        )
        require(
            result["primaryOutlined"] and result["fallbackOutlined"],
            "%s lacks an outlined fallback probe" % result["filename"],
        )

    print(
        json.dumps(
            {
                "ok": True,
                "eulyooHangulGlyphs": len(eulyoo[0]["mapped"]),
                "notoHangulGlyphs": len(noto[0]["mapped"]),
                "fallbackProbe": "잓",
                "fallbackProbeMappedByEulyoo": False,
                "fallbackProbeOutlinedByNoto": True,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("[body-font-glyphs] %s" % error, file=sys.stderr)
        sys.exit(1)