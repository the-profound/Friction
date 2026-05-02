import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, TextInput, StyleSheet, Pressable, Text, Platform, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, ReaderTokens } from "../../constants/tokens";
import * as TextSelectionMenu from "../../modules/TextSelectionMenu";

interface SelectableTextProps {
  text: string;
  onCollect: (selectedText: string) => void;
  onMemo?: (selectedText: string) => void;
  onSelectionStateChange?: (isSelecting: boolean) => void;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  children?: React.ReactNode;
  clearSignal?: number;
}

interface CaretPositionResult {
  offsetNode: Node;
  offset: number;
}

interface DocumentWithCaretAPIs extends Document {
  caretPositionFromPoint?: (x: number, y: number) => CaretPositionResult | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}

function selectWordAtPoint(x: number, y: number): boolean {
  let range: Range | null = null;
  const doc = document as DocumentWithCaretAPIs;
  if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  } else if (typeof doc.caretRangeFromPoint === "function") {
    range = doc.caretRangeFromPoint(x, y);
  }
  if (!range) return false;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  const txt = node.textContent ?? "";
  let s = range.startOffset;
  let e = s;
  while (s > 0 && /\S/.test(txt[s - 1])) s--;
  while (e < txt.length && /\S/.test(txt[e])) e++;
  if (s === e) return false;
  range.setStart(node, s);
  range.setEnd(node, e);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  return true;
}

function SelectableTextWeb({ text, onCollect, onMemo, onSelectionStateChange, fontSize, lineHeight, letterSpacing, children, clearSignal }: SelectableTextProps) {
  const [selectedText, setSelectedText] = useState("");
  const [showCollectButton, setShowCollectButton] = useState(false);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const textBodyRef = useRef<Text>(null);
  const pendingTextRef = useRef("");
  const isSelectModeRef = useRef(false);
  const isDraggingSelectionRef = useRef(false);
  const onSelectionStateChangeRef = useRef(onSelectionStateChange);
  onSelectionStateChangeRef.current = onSelectionStateChange;
  const prevClearSignalRef = useRef(clearSignal);

  const exitSelectMode = useCallback(() => {
    if (!isSelectModeRef.current) return;
    isSelectModeRef.current = false;
    setIsSelectMode(false);
    setShowCollectButton(false);
    setSelectedText("");
    window.getSelection()?.removeAllRanges();
    onSelectionStateChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    if (clearSignal === prevClearSignalRef.current) return;
    prevClearSignalRef.current = clearSignal;
    exitSelectMode();
  }, [clearSignal, exitSelectMode]);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const handleSelectionChange = () => {
      const sel = window.getSelection();
      const el = textBodyRef.current as unknown as HTMLElement | null;
      if (!sel || sel.rangeCount === 0 || sel.toString().trim().length === 0) {
        // While the user is dragging a new selection the range is momentarily
        // empty between mousedown and the first mousemove — do not exit.
        if (isDraggingSelectionRef.current) return;
        if (isSelectModeRef.current) {
          isSelectModeRef.current = false;
          setIsSelectMode(false);
          onSelectionStateChangeRef.current?.(false);
        }
        setShowCollectButton(false);
        setSelectedText("");
        return;
      }
      const range = sel.getRangeAt(0);
      if (el && el.contains(range.commonAncestorContainer)) {
        const selected = sel.toString().trim();
        setSelectedText(selected);
        setShowCollectButton(true);
        if (!isSelectModeRef.current) {
          isSelectModeRef.current = true;
          setIsSelectMode(true);
          onSelectionStateChangeRef.current?.(true);
        }
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

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = textBodyRef.current as unknown as HTMLElement | null;
    if (!el) return;

    const handleDblClick = (e: MouseEvent) => {
      e.stopPropagation();
      // Apply user-select:text directly on the DOM element before creating the
      // programmatic selection so mobile browsers show native teardrop handles.
      el.style.userSelect = "text";
      const selected = selectWordAtPoint(e.clientX, e.clientY);
      if (selected) {
        isSelectModeRef.current = true;
        setIsSelectMode(true);
        onSelectionStateChangeRef.current?.(true);
      } else {
        el.style.userSelect = "none";
      }
    };

    el.addEventListener("dblclick", handleDblClick);
    return () => el.removeEventListener("dblclick", handleDblClick);
  }, []);

  // When the collect bar is showing (select mode), let the browser handle
  // drag selection naturally (starting a completely fresh selection from the
  // mousedown point). We only need to:
  //   1. Flag that a drag is in progress so handleSelectionChange does not
  //      exit select mode while the range is momentarily empty between
  //      mousedown and the first mousemove.
  //   2. On mouseup, if the drag ended with no text selected (plain click),
  //      explicitly exit select mode.
  // The PanResponder in read.tsx is already blocked because isTextSelectingRef
  // is true while the collect bar is visible.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = textBodyRef.current as unknown as HTMLElement | null;
    if (!el) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (!isSelectModeRef.current) return;
      // e.detail === 2: part of a double-click — let the dblclick handler win.
      if (e.detail === 2) return;
      // Mark drag active; handleSelectionChange will skip the exit check.
      isDraggingSelectionRef.current = true;
      // Do NOT preventDefault: the browser starts a fresh selection from here.
    };

    const handleMouseUp = () => {
      if (!isDraggingSelectionRef.current) return;
      isDraggingSelectionRef.current = false;
      // If the mouse was released with nothing selected (plain click outside
      // the text, or click without drag), exit select mode now because
      // handleSelectionChange already suppressed the earlier empty-range event.
      const sel = window.getSelection();
      if (!sel || sel.toString().trim().length === 0) {
        isSelectModeRef.current = false;
        setIsSelectMode(false);
        setShowCollectButton(false);
        setSelectedText("");
        window.getSelection()?.removeAllRanges();
        onSelectionStateChangeRef.current?.(false);
      }
    };

    el.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      el.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleCollectPressIn = useCallback(() => {
    pendingTextRef.current = selectedText;
  }, [selectedText]);

  const handleMemoPressIn = useCallback(() => {
    pendingTextRef.current = selectedText;
  }, [selectedText]);

  const handleCollect = useCallback(() => {
    const t = pendingTextRef.current;
    pendingTextRef.current = "";
    if (t.length > 0) {
      onCollect(t);
      exitSelectMode();
    }
  }, [onCollect, exitSelectMode]);

  const handleMemo = useCallback(() => {
    const t = pendingTextRef.current;
    pendingTextRef.current = "";
    if (t.length > 0) {
      onMemo?.(t);
      exitSelectMode();
    }
  }, [onMemo, exitSelectMode]);

  const textStyle = [
    styles.textBody,
    fontSize != null && { fontSize },
    lineHeight != null && { lineHeight },
    letterSpacing != null && { letterSpacing },
    {
      wordBreak: "break-all" as any,
      overflowWrap: "anywhere" as any,
      userSelect: isSelectMode ? ("text" as const) : ("none" as const),
    },
  ];

  return (
    <View style={styles.container}>
      <Text style={textStyle} ref={textBodyRef}>
        {children ?? text}
      </Text>
      {showCollectButton && (
        <View style={styles.collectBarAbsoluteWrap}>
          <View style={styles.collectBarPill}>
            <Pressable style={styles.collectButton} onPressIn={handleCollectPressIn} onPress={handleCollect}>
              <Feather name="bookmark" size={14} color={Colors.zinc900} />
              <Text style={styles.collectButtonText}>수집</Text>
            </Pressable>
            {onMemo && (
              <Pressable style={styles.collectButton} onPressIn={handleMemoPressIn} onPress={handleMemo}>
                <Feather name="edit-3" size={14} color={Colors.zinc900} />
                <Text style={styles.collectButtonText}>메모</Text>
              </Pressable>
            )}
            <Pressable style={styles.cancelButton} onPress={exitSelectMode} hitSlop={8}>
              <Feather name="x" size={16} color={Colors.zinc400} />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function SelectableTextNative({ text, onCollect, onMemo, onSelectionStateChange, fontSize, lineHeight, letterSpacing, children, clearSignal }: SelectableTextProps) {
  // When the native OS menu module is unavailable (Expo Go), fall back to the
  // same floating pill bar used by SelectableTextWeb.
  const useNativeMenu = TextSelectionMenu.isAvailable;

  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  // When true, pass {start:0,end:0} as controlled selection to force iOS to clear handles
  const [forceClearSelection, setForceClearSelection] = useState(false);
  // Fallback pill bar state (Expo Go / no native module)
  const [showFallbackBar, setShowFallbackBar] = useState(false);
  const pendingFallbackTextRef = useRef("");

  const textRef = useRef(text);
  textRef.current = text;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const isSelectingRef = useRef(false);
  const onSelectionStateChangeRef = useRef(onSelectionStateChange);
  onSelectionStateChangeRef.current = onSelectionStateChange;
  const onCollectRef = useRef(onCollect);
  onCollectRef.current = onCollect;
  const onMemoRef = useRef(onMemo);
  onMemoRef.current = onMemo;
  const textInputRef = useRef<TextInput>(null);
  const prevClearSignalRef = useRef(clearSignal);
  // Track pending dismiss timer so we can cancel it if a menu action fires first
  const blurDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearNativeSelection = useCallback(() => {
    setForceClearSelection(true);
    textInputRef.current?.blur();
    // Reset controlled prop after one frame so normal selection works again
    setTimeout(() => setForceClearSelection(false), 100);
  }, []);

  const dismissSelection = useCallback(() => {
    if (blurDismissTimerRef.current) {
      clearTimeout(blurDismissTimerRef.current);
      blurDismissTimerRef.current = null;
    }
    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      setSelection({ start: 0, end: 0 });
      onSelectionStateChangeRef.current?.(false);
    }
    TextSelectionMenu.deactivate();
    setShowFallbackBar(false);
    pendingFallbackTextRef.current = "";
    clearNativeSelection();
  }, [clearNativeSelection]);

  // Listen for native OS menu item taps
  useEffect(() => {
    const collectSub = TextSelectionMenu.addCollectListener(() => {
      const { start, end } = selectionRef.current;
      const selected = textRef.current.substring(start, end).trim();
      if (selected.length > 0) {
        onCollectRef.current(selected);
      }
      dismissSelection();
    });

    const memoSub = TextSelectionMenu.addMemoListener(() => {
      const { start, end } = selectionRef.current;
      const selected = textRef.current.substring(start, end).trim();
      if (selected.length > 0) {
        onMemoRef.current?.(selected);
      }
      dismissSelection();
    });

    return () => {
      collectSub?.remove();
      memoSub?.remove();
    };
  }, [dismissSelection]);

  // Auto-dismiss when the TextInput loses focus (e.g. user taps outside on iOS).
  // A short delay ensures any pending native menu action events fire before we clear state.
  const handleBlur = useCallback(() => {
    if (blurDismissTimerRef.current) clearTimeout(blurDismissTimerRef.current);
    blurDismissTimerRef.current = setTimeout(() => {
      blurDismissTimerRef.current = null;
      if (isSelectingRef.current) {
        isSelectingRef.current = false;
        setSelection({ start: 0, end: 0 });
        onSelectionStateChangeRef.current?.(false);
        TextSelectionMenu.deactivate();
        setShowFallbackBar(false);
        pendingFallbackTextRef.current = "";
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (blurDismissTimerRef.current) clearTimeout(blurDismissTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (clearSignal === prevClearSignalRef.current) return;
    prevClearSignalRef.current = clearSignal;
    setSelection({ start: 0, end: 0 });
    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      onSelectionStateChangeRef.current?.(false);
      TextSelectionMenu.deactivate();
      setShowFallbackBar(false);
      pendingFallbackTextRef.current = "";
    }
    clearNativeSelection();
  }, [clearSignal, clearNativeSelection]);

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const { start, end } = e.nativeEvent.selection;
      setSelection({ start, end });
      const nowSelecting = start !== end;
      if (nowSelecting !== isSelectingRef.current) {
        isSelectingRef.current = nowSelecting;
        onSelectionStateChangeRef.current?.(nowSelecting);
        if (nowSelecting) {
          if (useNativeMenu) {
            TextSelectionMenu.activate(onMemo != null);
          }
        } else {
          if (useNativeMenu) TextSelectionMenu.deactivate();
          setShowFallbackBar(false);
          pendingFallbackTextRef.current = "";
        }
      }
      // Update fallback bar whenever selection is non-empty and native menu is unavailable
      if (!useNativeMenu) {
        if (start !== end) {
          const selected = textRef.current.substring(start, end).trim();
          setShowFallbackBar(selected.length > 0);
        } else {
          setShowFallbackBar(false);
        }
      }
    },
    [onMemo, useNativeMenu],
  );

  // Fallback bar handlers (used when native module is unavailable)
  const handleFallbackCollectPressIn = useCallback(() => {
    const { start, end } = selectionRef.current;
    pendingFallbackTextRef.current = textRef.current.substring(start, end).trim();
  }, []);

  const handleFallbackMemoPressIn = useCallback(() => {
    const { start, end } = selectionRef.current;
    pendingFallbackTextRef.current = textRef.current.substring(start, end).trim();
  }, []);

  const handleFallbackCollect = useCallback(() => {
    const t = pendingFallbackTextRef.current;
    pendingFallbackTextRef.current = "";
    if (t.length > 0) onCollectRef.current(t);
    dismissSelection();
  }, [dismissSelection]);

  const handleFallbackMemo = useCallback(() => {
    const t = pendingFallbackTextRef.current;
    pendingFallbackTextRef.current = "";
    if (t.length > 0) onMemoRef.current?.(t);
    dismissSelection();
  }, [dismissSelection]);

  const inputStyle = [
    styles.textInput,
    fontSize != null && { fontSize },
    lineHeight != null && { lineHeight },
    letterSpacing != null && { letterSpacing },
  ];

  const fallbackBar = !useNativeMenu && showFallbackBar ? (
    <View style={styles.collectBarAbsoluteWrap}>
      <View style={styles.collectBarPill}>
        <Pressable style={styles.collectButton} onPressIn={handleFallbackCollectPressIn} onPress={handleFallbackCollect}>
          <Feather name="bookmark" size={14} color={Colors.zinc900} />
          <Text style={styles.collectButtonText}>수집</Text>
        </Pressable>
        {onMemo && (
          <Pressable style={styles.collectButton} onPressIn={handleFallbackMemoPressIn} onPress={handleFallbackMemo}>
            <Feather name="edit-3" size={14} color={Colors.zinc900} />
            <Text style={styles.collectButtonText}>메모</Text>
          </Pressable>
        )}
        <Pressable style={styles.cancelButton} onPress={dismissSelection} hitSlop={8}>
          <Feather name="x" size={16} color={Colors.zinc400} />
        </Pressable>
      </View>
    </View>
  ) : null;

  if (children) {
    return (
      <View style={styles.container}>
        <View>
          {children}
          <TextInput
            ref={textInputRef}
            style={[inputStyle, styles.overlayInput]}
            value={text}
            multiline
            editable={false}
            scrollEnabled={false}
            onSelectionChange={handleSelectionChange}
            onBlur={handleBlur}
            selection={forceClearSelection ? { start: 0, end: 0 } : undefined}
            selectTextOnFocus={false}
          />
        </View>
        {fallbackBar}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View>
        <TextInput
          ref={textInputRef}
          style={inputStyle}
          value={text}
          multiline
          editable={false}
          scrollEnabled={false}
          onSelectionChange={handleSelectionChange}
          onBlur={handleBlur}
          selection={forceClearSelection ? { start: 0, end: 0 } : undefined}
          selectTextOnFocus={false}
        />
      </View>
      {fallbackBar}
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
  // Used by SelectableTextWeb: absolutely positioned just below the text block.
  // top:'100%' is a web CSS percentage; cast to satisfy RN number types.
  collectBarAbsoluteWrap: {
    position: "absolute",
    top: "100%" as unknown as number,
    left: 0,
    right: 0,
    marginTop: 6,
    zIndex: 9999,
    flexDirection: "row",
    justifyContent: "center",
  },
  collectBarPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.white,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
      },
      android: {
        elevation: 3,
      },
      default: {},
    }),
  },
  collectButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.zinc100,
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  collectButtonText: {
    fontSize: 12,
    fontFamily: ReaderTokens.fontFamily.sansSemiBold,
    color: Colors.zinc900,
    fontWeight: "600",
  },
  cancelButton: {
    padding: 4,
  },
});
