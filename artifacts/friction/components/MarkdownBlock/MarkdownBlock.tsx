import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors, ReaderTokens } from "../../constants/tokens";
import SelectableText from "../SelectableText/SelectableText";
import type { MarkdownBlockType, InlineToken } from "../../utils/markdownParser";

interface MarkdownBlockProps {
  block: MarkdownBlockType;
  onCollect: (text: string) => void;
  onMemo?: (text: string) => void;
  onSelectionStateChange?: (isSelecting: boolean) => void;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  clearSignal?: number;
}

function renderInlineTokens(tokens: InlineToken[]) {
  return tokens.map((token, i) => {
    if (token.kind === "bold") {
      return (
        <Text key={i} style={styles.bold}>
          {token.value}
        </Text>
      );
    }
    if (token.kind === "italic") {
      return (
        <Text key={i} style={styles.italic}>
          {token.value}
        </Text>
      );
    }
    if (token.kind === "bold_italic") {
      return (
        <Text key={i} style={styles.boldItalic}>
          {token.value}
        </Text>
      );
    }
    return <Text key={i}>{token.value}</Text>;
  });
}

function hasFormatting(tokens: InlineToken[]): boolean {
  return tokens.some((t) => t.kind !== "text");
}

export default function MarkdownBlock({
  block,
  onCollect,
  onMemo,
  onSelectionStateChange,
  fontSize,
  lineHeight,
  letterSpacing,
  clearSignal,
}: MarkdownBlockProps) {
  const plainText = block.rawText;
  const formatted = hasFormatting(block.tokens);

  if (block.type === "paragraph") {
    if (!formatted) {
      return (
        <SelectableText
          text={plainText}
          onCollect={onCollect}
          onMemo={onMemo}
          onSelectionStateChange={onSelectionStateChange}
          fontSize={fontSize}
          lineHeight={lineHeight}
          letterSpacing={letterSpacing}
          clearSignal={clearSignal}
        />
      );
    }
    return (
      <SelectableText
        text={plainText}
        onCollect={onCollect}
        onMemo={onMemo}
        onSelectionStateChange={onSelectionStateChange}
        fontSize={fontSize}
        lineHeight={lineHeight}
        letterSpacing={letterSpacing}
        clearSignal={clearSignal}
      >
        <Text style={[styles.paragraph, { fontSize, lineHeight, letterSpacing }]}>
          {renderInlineTokens(block.tokens)}
        </Text>
      </SelectableText>
    );
  }

  if (block.type === "h1") {
    const sz = fontSize * 1.6;
    return (
      <SelectableText
        text={plainText}
        onCollect={onCollect}
        onMemo={onMemo}
        onSelectionStateChange={onSelectionStateChange}
        fontSize={sz}
        lineHeight={sz * 1.25}
        letterSpacing={letterSpacing * 0.5}
        clearSignal={clearSignal}
      >
        <Text style={[styles.heading, { fontSize: sz, lineHeight: sz * 1.25, letterSpacing: letterSpacing * 0.5 }]}>
          {renderInlineTokens(block.tokens)}
        </Text>
      </SelectableText>
    );
  }

  if (block.type === "h2") {
    const sz = fontSize * 1.3;
    return (
      <SelectableText
        text={plainText}
        onCollect={onCollect}
        onMemo={onMemo}
        onSelectionStateChange={onSelectionStateChange}
        fontSize={sz}
        lineHeight={sz * 1.3}
        letterSpacing={letterSpacing * 0.5}
        clearSignal={clearSignal}
      >
        <Text style={[styles.heading, { fontSize: sz, lineHeight: sz * 1.3, letterSpacing: letterSpacing * 0.5 }]}>
          {renderInlineTokens(block.tokens)}
        </Text>
      </SelectableText>
    );
  }

  if (block.type === "h3") {
    const sz = fontSize * 1.1;
    return (
      <SelectableText
        text={plainText}
        onCollect={onCollect}
        onMemo={onMemo}
        onSelectionStateChange={onSelectionStateChange}
        fontSize={sz}
        lineHeight={sz * 1.35}
        letterSpacing={letterSpacing * 0.5}
        clearSignal={clearSignal}
      >
        <Text style={[styles.heading, { fontSize: sz, lineHeight: sz * 1.35, letterSpacing: letterSpacing * 0.5 }]}>
          {renderInlineTokens(block.tokens)}
        </Text>
      </SelectableText>
    );
  }

  if (block.type === "blockquote") {
    return (
      <View style={styles.blockquoteContainer}>
        <View style={styles.blockquoteLine} />
        <View style={styles.blockquoteBody}>
          <SelectableText
            text={plainText}
            onCollect={onCollect}
            onMemo={onMemo}
            onSelectionStateChange={onSelectionStateChange}
            fontSize={fontSize}
            lineHeight={lineHeight}
            letterSpacing={letterSpacing}
            clearSignal={clearSignal}
          >
            <Text style={[styles.blockquoteText, { fontSize, lineHeight, letterSpacing }]}>
              {renderInlineTokens(block.tokens)}
            </Text>
          </SelectableText>
        </View>
      </View>
    );
  }

  if (block.type === "ul_item") {
    return (
      <View style={styles.listItemRow}>
        <Text style={[styles.listBullet, { fontSize, lineHeight }]}>{"•"}</Text>
        <View style={styles.listItemBody}>
          <SelectableText
            text={plainText}
            onCollect={onCollect}
            onMemo={onMemo}
            onSelectionStateChange={onSelectionStateChange}
            fontSize={fontSize}
            lineHeight={lineHeight}
            letterSpacing={letterSpacing}
            clearSignal={clearSignal}
          >
            <Text style={[styles.listItemText, { fontSize, lineHeight, letterSpacing }]}>
              {renderInlineTokens(block.tokens)}
            </Text>
          </SelectableText>
        </View>
      </View>
    );
  }

  if (block.type === "ol_item") {
    return (
      <View style={styles.listItemRow}>
        <Text style={[styles.listBullet, { fontSize, lineHeight }]}>
          {block.index}.
        </Text>
        <View style={styles.listItemBody}>
          <SelectableText
            text={plainText}
            onCollect={onCollect}
            onMemo={onMemo}
            onSelectionStateChange={onSelectionStateChange}
            fontSize={fontSize}
            lineHeight={lineHeight}
            letterSpacing={letterSpacing}
            clearSignal={clearSignal}
          >
            <Text style={[styles.listItemText, { fontSize, lineHeight, letterSpacing }]}>
              {renderInlineTokens(block.tokens)}
            </Text>
          </SelectableText>
        </View>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  paragraph: {
    fontFamily: ReaderTokens.fontFamily.serif,
    color: ReaderTokens.bodyText,
    textAlign: "justify",
  },
  heading: {
    fontFamily: ReaderTokens.fontFamily.serifBold,
    color: ReaderTokens.bodyText,
    textAlign: "left",
  },
  bold: {
    fontFamily: ReaderTokens.fontFamily.serifBold,
    fontWeight: "700",
  },
  italic: {
    fontStyle: "italic",
  },
  boldItalic: {
    fontFamily: ReaderTokens.fontFamily.serifBold,
    fontWeight: "700",
    fontStyle: "italic",
  },
  blockquoteContainer: {
    flexDirection: "row",
    gap: 10,
    alignItems: "stretch",
  },
  blockquoteLine: {
    width: 3,
    backgroundColor: Colors.zinc300,
    borderRadius: 2,
  },
  blockquoteBody: {
    flex: 1,
  },
  blockquoteText: {
    fontFamily: ReaderTokens.fontFamily.serif,
    color: Colors.zinc600,
    fontStyle: "italic",
    textAlign: "left",
  },
  listItemRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  listBullet: {
    fontFamily: ReaderTokens.fontFamily.serif,
    color: ReaderTokens.bodyText,
    minWidth: 20,
  },
  listItemBody: {
    flex: 1,
  },
  listItemText: {
    fontFamily: ReaderTokens.fontFamily.serif,
    color: ReaderTokens.bodyText,
    textAlign: "left",
  },
});
