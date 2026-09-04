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
FALLBACK_PROBE = ord("핟")
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


def point_signature(point):
    return (
        round(point.x, 6),
        round(point.y, 6),
        bool(point.on_curve),
    )


def glyph_artwork_signature(glyph):
    contours = tuple(
        (
            bool(contour.closed),
            tuple(point_signature(point) for point in contour),
        )
        for contour in glyph.foreground
    )
    references = tuple(
        (
            reference[0],
            tuple(round(value, 9) for value in reference[1]),
        )
        for reference in glyph.references
    )
    return (glyph.width, glyph.vwidth, contours, references)


def validate_eulyoo_artwork_preserved(source_name, native_name):
    source = fontforge.open(os.path.join(FONT_DIR, source_name))
    native = fontforge.open(os.path.join(FONT_DIR, native_name))
    try:
        compared = 0
        for codepoint in range(HANGUL_START, HANGUL_END + 1):
            source_slot = source.findEncodingSlot(codepoint)
            if source_slot < 0 or not has_outline(source[source_slot]):
                continue
            native_slot = native.findEncodingSlot(codepoint)
            require(
                native_slot >= 0,
                "%s lost Eulyoo artwork at U+%04X" % (native_name, codepoint),
            )
            require(
                glyph_artwork_signature(source[source_slot])
                == glyph_artwork_signature(native[native_slot]),
                "%s changed Eulyoo artwork or metrics at U+%04X"
                % (native_name, codepoint),
            )
            compared += 1
        require(
            compared == EXPECTED_EULYOO_HANGUL_COUNT,
            "%s compared %d Eulyoo glyphs; expected %d"
            % (native_name, compared, EXPECTED_EULYOO_HANGUL_COUNT),
        )
        return compared
    finally:
        source.close()
        native.close()


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
    native = [
        inspect_font("Eulyoo1945-Regular-Body.otf"),
        inspect_font("Eulyoo1945-SemiBold-Body.otf"),
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
            "%s still advertises fallback-only probe 핟" % result["filename"],
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

    for result in native:
        require(not result["empty"], "%s contains empty Hangul glyphs" % result["filename"])
        require(
            len(result["mapped"]) == EXPECTED_NOTO_HANGUL_COUNT,
            "%s does not cover all modern Hangul syllables" % result["filename"],
        )
        require(
            result["primaryOutlined"] and result["fallbackOutlined"],
            "%s lacks an outlined primary/fallback probe" % result["filename"],
        )
    require(
        set(native[0]["mapped"]) == set(native[1]["mapped"]),
        "Native Regular and SemiBold expose different Hangul coverage",
    )
    preserved = [
        validate_eulyoo_artwork_preserved(
            "Eulyoo1945-Regular.otf",
            "Eulyoo1945-Regular-Body.otf",
        ),
        validate_eulyoo_artwork_preserved(
            "Eulyoo1945-SemiBold.otf",
            "Eulyoo1945-SemiBold-Body.otf",
        ),
    ]

    print(
        json.dumps(
            {
                "ok": True,
                "eulyooHangulGlyphs": len(eulyoo[0]["mapped"]),
                "notoHangulGlyphs": len(noto[0]["mapped"]),
                "nativeHangulGlyphs": len(native[0]["mapped"]),
                "preservedEulyooGlyphsPerWeight": preserved,
                "fallbackProbe": "핟",
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