#!/usr/bin/env fontforge
"""Build the shared Eulyoo-first/Noto-fallback body-font assets.

Run with:
  fontforge -lang=py -script scripts/build-webview-eulyoo-fonts.py

The checked-in source OTF files remain the source of truth for Eulyoo's artwork.
Some Hangul syllables are mapped to zero-outline placeholder glyphs in those
sources. The WebView WOFF2 build removes those mappings so CSS can fall through
to Noto. React Native does not support CSS font-family lists, so the native OTF
build fills those same missing mappings with the matching bundled Noto weight.
"""

import os
import sys
import tempfile

import fontforge


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
FONT_DIR = os.path.join(PROJECT_ROOT, "assets", "fonts")
HANGUL_START = 0xAC00
HANGUL_END = 0xD7A3
EXPECTED_EMPTY_HANGUL_COUNT = 8392
FONT_SPECS = (
    (
        "Eulyoo1945-Regular.otf",
        "Eulyoo1945-Regular.woff2",
        "Eulyoo1945-Regular-Body.otf",
        "NotoSerifKR-400Regular-korean.woff2",
    ),
    (
        "Eulyoo1945-SemiBold.otf",
        "Eulyoo1945-SemiBold.woff2",
        "Eulyoo1945-SemiBold-Body.otf",
        "NotoSerifKR-600SemiBold-korean.woff2",
    ),
)


def has_outline(glyph):
    return (
        len(glyph.foreground) > 0
        or len(glyph.references) > 0
        or glyph.boundingBox() != (0.0, 0.0, 0.0, 0.0)
    )


def empty_hangul_codepoints(font):
    empty = []
    for glyph in font.glyphs():
        codepoint = glyph.unicode
        if HANGUL_START <= codepoint <= HANGUL_END and not has_outline(glyph):
            empty.append(codepoint)
    return sorted(empty)


def generate_atomic(font, output_name):
    output_path = os.path.join(FONT_DIR, output_name)
    suffix = os.path.splitext(output_name)[1]
    file_descriptor, temporary_path = tempfile.mkstemp(
        prefix=output_name + ".", suffix=suffix, dir=FONT_DIR
    )
    os.close(file_descriptor)
    try:
        font.generate(temporary_path)
        os.replace(temporary_path, output_path)
        os.chmod(output_path, 0o644)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)


def build_font(source_name, web_output_name, native_output_name, noto_name, expected_empty):
    source_path = os.path.join(FONT_DIR, source_name)
    font = fontforge.open(source_path)
    empty = empty_hangul_codepoints(font)
    if empty != expected_empty:
        raise RuntimeError(
            "%s empty Hangul map differs from the other weight" % source_name
        )
    if len(empty) != EXPECTED_EMPTY_HANGUL_COUNT:
        raise RuntimeError(
            "%s had %d empty Hangul mappings; expected %d"
            % (source_name, len(empty), EXPECTED_EMPTY_HANGUL_COUNT)
        )
    for codepoint in empty:
        slot = font.findEncodingSlot(codepoint)
        if slot < 0:
            raise RuntimeError("Lost U+%04X while rebuilding %s" % (codepoint, source_name))
        font.removeGlyph(font[slot])

    try:
        generate_atomic(font, web_output_name)
        font.mergeFonts(os.path.join(FONT_DIR, noto_name))
        generate_atomic(font, native_output_name)
    finally:
        font.close()
    print(
        "[body-fonts] %s: removed %d empty Hangul mappings; built %s with Noto fallback"
        % (web_output_name, len(empty), native_output_name)
    )


def main():
    baseline_font = fontforge.open(os.path.join(FONT_DIR, FONT_SPECS[0][0]))
    expected_empty = empty_hangul_codepoints(baseline_font)
    baseline_font.close()
    for source_name, web_output_name, native_output_name, noto_name in FONT_SPECS:
        build_font(
            source_name,
            web_output_name,
            native_output_name,
            noto_name,
            expected_empty,
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("[body-fonts] build failed: %s" % error, file=sys.stderr)
        sys.exit(1)