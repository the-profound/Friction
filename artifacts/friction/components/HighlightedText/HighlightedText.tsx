import React from "react";
import { Text, type TextStyle } from "react-native";

interface HighlightedTextProps {
  text: string;
  keywords: string[] | null | undefined;
  style?: TextStyle;
  highlightStyle?: TextStyle;
  allowFontScaling?: boolean;
}

const DEFAULT_HIGHLIGHT: TextStyle = {
  backgroundColor: "#FFE066",
};

export default function HighlightedText({
  text,
  keywords,
  style,
  highlightStyle,
  allowFontScaling,
}: HighlightedTextProps) {
  const activeKeywords = keywords?.filter((k) => k.trim().length > 0) ?? [];

  if (activeKeywords.length === 0) {
    return (
      <Text style={style} allowFontScaling={allowFontScaling}>
        {text}
      </Text>
    );
  }

  const escapedKeywords = activeKeywords.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const pattern = new RegExp(`(${escapedKeywords.join("|")})`, "gi");
  const parts = text.split(pattern);

  const mergedHighlight: TextStyle = { ...DEFAULT_HIGHLIGHT, ...highlightStyle };

  return (
    <Text style={style} allowFontScaling={allowFontScaling}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={mergedHighlight}>
            {part}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}
