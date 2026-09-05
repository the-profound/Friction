import React from "react";
import { Platform, StyleSheet, Text } from "react-native";
import { Colors, ReaderTokens } from "@/constants/tokens";
import type { InlineToken, MarkdownBlockType } from "@/utils/markdownParser";

interface Props {
  blocks: MarkdownBlockType[];
  fallback: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  maxLines: number;
}

function renderInlineTokens(tokens: InlineToken[]) {
  return tokens.map((token, index) => {
    const style =
      token.kind === "bold" ? styles.bold
      : token.kind === "italic" ? styles.italic
      : token.kind === "bold_italic" ? styles.boldItalic
      : token.kind === "underline" ? styles.underline
      : undefined;
    return <Text key={`${index}-${token.kind}`} style={style}>{token.value}</Text>;
  });
}

function blockPrefix(block: MarkdownBlockType) {
  if (block.type === "blockquote") return "┃ ";
  if (block.type === "ul_item") return "• ";
  if (block.type === "ol_item") return `${block.index}. `;
  return "";
}

export default function RecordCardMarkdownPreview({
  blocks,
  fallback,
  fontSize,
  lineHeight,
  letterSpacing,
  maxLines,
}: Props) {
  return (
    <Text
      style={[styles.paragraph, { fontSize, lineHeight, letterSpacing }]}
      numberOfLines={maxLines}
      ellipsizeMode="tail"
    >
      {blocks.length === 0 ? <Text>{fallback}</Text> : blocks.map((block, index) => {
        const heading = block.type === "h1" || block.type === "h2" || block.type === "h3";
        const separator = index === 0 ? "" : block.type === "paragraph" && block.tokens.length === 0 ? "\n" : "\n\n";
        return (
          <Text
            key={index}
            style={[
              block.type === "blockquote" && styles.blockquote,
              heading && styles.heading,
            ]}
          >
            {separator}
            <Text style={block.type === "blockquote" ? styles.blockquoteMarker : undefined}>
              {blockPrefix(block)}
            </Text>
            {renderInlineTokens(block.tokens)}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  paragraph: {
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc800,
    textAlign: "justify",
    ...Platform.select({ web: { whiteSpace: "pre-wrap" }, default: {} }),
  },
  heading: { fontFamily: ReaderTokens.fontFamily.serifBold, fontWeight: "700", textAlign: "left" },
  blockquote: { color: Colors.zinc600, fontStyle: "italic", textAlign: "justify" },
  blockquoteMarker: { color: Colors.zinc300, fontStyle: "normal" },
  bold: { fontFamily: ReaderTokens.fontFamily.serifBold, fontWeight: "700" },
  italic: { fontStyle: "italic" },
  boldItalic: { fontFamily: ReaderTokens.fontFamily.serifBold, fontWeight: "700", fontStyle: "italic" },
  underline: { textDecorationLine: "underline" },
});