import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, TextInput, StyleSheet, Pressable, Text, Platform, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography } from "../../constants/tokens";

interface SelectableTextProps {
  text: string;
  onCollect: (selectedText: string) => void;
}

function SelectableTextWeb({ text, onCollect }: SelectableTextProps) {
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

  return (
    <View style={styles.container}>
      <Text selectable style={styles.textBody} ref={textBodyRef}>
        {text}
      </Text>
      {showCollectButton && (
        <View style={styles.collectBar}>
          <Text style={styles.collectHint} numberOfLines={1}>
            &ldquo;{selectedText.substring(0, 40)}
            {selectedText.length > 40 ? "..." : ""}&rdquo;
          </Text>
          <Pressable style={styles.collectButton} onPress={handleCollect}>
            <Feather name="bookmark" size={14} color={Colors.white} />
            <Text style={styles.collectButtonText}>수집</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function SelectableTextNative({ text, onCollect }: SelectableTextProps) {
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

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.textInput}
        value={text}
        multiline
        editable={false}
        scrollEnabled={false}
        onSelectionChange={handleSelectionChange}
        selection={undefined}
        selectTextOnFocus={false}
      />
      {showCollectButton && (
        <View style={styles.collectBar}>
          <Text style={styles.collectHint} numberOfLines={1}>
            &ldquo;{text.substring(selection.start, Math.min(selection.end, selection.start + 40))}
            {selection.end - selection.start > 40 ? "..." : ""}&rdquo;
          </Text>
          <Pressable style={styles.collectButton} onPress={handleCollect}>
            <Feather name="bookmark" size={14} color={Colors.white} />
            <Text style={styles.collectButtonText}>수집</Text>
          </Pressable>
        </View>
      )}
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
    ...Typography.body,
    color: Colors.zinc800,
    lineHeight: 28,
  },
  textInput: {
    ...Typography.body,
    color: Colors.zinc800,
    lineHeight: 28,
    padding: 0,
    margin: 0,
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
  collectHint: {
    ...Typography.caption,
    color: Colors.zinc300,
    flex: 1,
    fontStyle: "italic",
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
    ...Typography.caption,
    color: Colors.white,
    fontWeight: "600",
  },
});
