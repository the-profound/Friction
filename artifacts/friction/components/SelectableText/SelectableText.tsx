import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, TextInput, StyleSheet, Pressable, Text, Platform, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, ReaderTokens } from "../../constants/tokens";

interface SelectableTextProps {
  text: string;
  onCollect: (selectedText: string) => void;
  onMemo?: (selectedText: string) => void;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  children?: React.ReactNode;
}

function SelectableTextWeb({ text, onCollect, onMemo, fontSize, lineHeight, letterSpacing, children }: SelectableTextProps) {
  const [selectedText, setSelectedText] = useState("");
  const [showCollectButton, setShowCollectButton] = useState(false);
  const textBodyRef = useRef<Text>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.toString().trim().length === 0) {
        setShowCollectButton(false);
        setSelectedText("");
        return;
      }
      const range = sel.getRangeAt(0);
      const textNode = (textBodyRef.current as unknown as HTMLElement);
      if (textNode && textNode.contains(range.commonAncestorContainer)) {
        const selected = sel.toString().trim();
        setSelectedText(selected);
        setShowCollectButton(true);
        return;
      }
      setShowCollectButton(false);
      setSelectedText("");
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  const handleCollect = useCallback(() => {
    if (selectedText.length > 0) {
      onCollect(selectedText);
      setShowCollectButton(false);
      setSelectedText("");
      window.getSelection()?.removeAllRanges();
    }
  }, [selectedText, onCollect]);

  const handleMemo = useCallback(() => {
    if (selectedText.length > 0) {
      onMemo?.(selectedText);
      setShowCollectButton(false);
      setSelectedText("");
      window.getSelection()?.removeAllRanges();
    }
  }, [selectedText, onMemo]);

  const textStyle = [
    styles.textBody,
    fontSize != null && { fontSize },
    lineHeight != null && { lineHeight },
    letterSpacing != null && { letterSpacing },
    { wordBreak: "break-word" as any, overflowWrap: "anywhere" as any },
  ];

  return (
    <View style={styles.container}>
      <Text selectable style={textStyle} ref={textBodyRef}>
        {children ?? text}
      </Text>
      {showCollectButton && (
        <View style={styles.collectBar}>
          <Pressable style={styles.collectButton} onPress={handleCollect}>
            <Feather name="bookmark" size={14} color={Colors.white} />
            <Text style={styles.collectButtonText}>수집</Text>
          </Pressable>
          {onMemo && (
            <Pressable style={styles.collectButton} onPress={handleMemo}>
              <Feather name="edit-3" size={14} color={Colors.white} />
              <Text style={styles.collectButtonText}>메모</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function SelectableTextNative({ text, onCollect, onMemo, fontSize, lineHeight, letterSpacing, children }: SelectableTextProps) {
  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [showCollectButton, setShowCollectButton] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const { start, end } = e.nativeEvent.selection;
      setSelection({ start, end });
      setShowCollectButton(start !== end);
    },
    [],
  );

  const handleCollect = useCallback(() => {
    const selected = textRef.current.substring(selection.start, selection.end);
    if (selected.trim().length > 0) {
      onCollect(selected.trim());
      setShowCollectButton(false);
    }
  }, [selection, onCollect]);

  const handleMemo = useCallback(() => {
    const selected = textRef.current.substring(selection.start, selection.end);
    if (selected.trim().length > 0) {
      onMemo?.(selected.trim());
      setShowCollectButton(false);
    }
  }, [selection, onMemo]);

  const inputStyle = [
    styles.textInput,
    fontSize != null && { fontSize },
    lineHeight != null && { lineHeight },
    letterSpacing != null && { letterSpacing },
  ];

  const collectBar = (
    <View style={styles.collectBar}>
      <Pressable style={styles.collectButton} onPress={handleCollect}>
        <Feather name="bookmark" size={14} color={Colors.white} />
        <Text style={styles.collectButtonText}>수집</Text>
      </Pressable>
      {onMemo && (
        <Pressable style={styles.collectButton} onPress={handleMemo}>
          <Feather name="edit-3" size={14} color={Colors.white} />
          <Text style={styles.collectButtonText}>메모</Text>
        </Pressable>
      )}
    </View>
  );

  if (children) {
    return (
      <View style={styles.container}>
        <View>
          {children}
          <TextInput
            style={[inputStyle, styles.overlayInput]}
            value={text}
            multiline
            editable={false}
            scrollEnabled={false}
            onSelectionChange={handleSelectionChange}
            selection={undefined}
            selectTextOnFocus={false}
          />
        </View>
        {showCollectButton && collectBar}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={inputStyle}
        value={text}
        multiline
        editable={false}
        scrollEnabled={false}
        onSelectionChange={handleSelectionChange}
        selection={undefined}
        selectTextOnFocus={false}
      />
      {showCollectButton && collectBar}
    </View>
  );
}

export default function SelectableText(props: SelectableTextProps) {
  if (Platform.OS === "web") {
    return <SelectableTextWeb {...props} />;
  }
  return <SelectableTextNative {...props} />;
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
  },
  textBody: {
    fontSize: 16,
    fontFamily: ReaderTokens.fontFamily.serif,
    color: ReaderTokens.bodyText,
    lineHeight: 28,
    letterSpacing: 0.8,
    textAlign: "justify" as const,
  },
  textInput: {
    fontSize: 16,
    fontFamily: ReaderTokens.fontFamily.serif,
    color: ReaderTokens.bodyText,
    lineHeight: 28,
    letterSpacing: 0.8,
    textAlign: "justify" as const,
    padding: 0,
    margin: 0,
  },
  overlayInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    color: "transparent",
    backgroundColor: "transparent",
  },
  collectBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc900,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    gap: 8,
  },
  collectButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.zinc700,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  collectButtonText: {
    fontSize: 12,
    fontFamily: ReaderTokens.fontFamily.sansSemiBold,
    color: Colors.white,
    fontWeight: "600",
  },
});
