import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, TextInput, StyleSheet, Text, Platform, type TextStyle, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from "react-native";
import { Colors, ReaderTokens } from "../../constants/tokens";
import * as TextSelectionMenu from "../../modules/TextSelectionMenu";

interface SelectableTextProps {
  text: string;
  onCollect: (selectedText: string) => void;
  onMemo?: (selectedText: string) => void;
  onSelectionStateChange?: (isSelecting: boolean, selectedText?: string) => void;
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

interface DocumentWithCaretAPIs extends Omit<Document, "caretPositionFromPoint" | "caretRangeFromPoint"> {
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
  const [isSelectMode, setIsSelectMode] = useState(false);
  const textBodyRef = useRef<Text>(null);
  const isSelectModeRef = useRef(false);
  const isDraggingSelectionRef = useRef(false);
  const onSelectionStateChangeRef = useRef(onSelectionStateChange);
  onSelectionStateChangeRef.current = onSelectionStateChange;
  const prevClearSignalRef = useRef(clearSignal);

  const exitSelectMode = useCallback(() => {
    if (!isSelectModeRef.current) return;
    isSelectModeRef.current = false;
    setIsSelectMode(false);
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
        return;
      }
      const range = sel.getRangeAt(0);
      if (el && el.contains(range.commonAncestorContainer)) {
        const selected = sel.toString().trim();
        if (!isSelectModeRef.current) {
          isSelectModeRef.current = true;
          setIsSelectMode(true);
        }
        onSelectionStateChangeRef.current?.(true, selected);
        return;
      }
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
        const selText = window.getSelection()?.toString().trim() ?? "";
        onSelectionStateChangeRef.current?.(true, selText);
      } else {
        el.style.userSelect = "none";
      }
    };

    el.addEventListener("dblclick", handleDblClick);
    return () => el.removeEventListener("dblclick", handleDblClick);
  }, []);

  // When in select mode, let the browser handle drag selection naturally
  // (starting a completely fresh selection from the mousedown point). We only need to:
  //   1. Flag that a drag is in progress so handleSelectionChange does not
  //      exit select mode while the range is momentarily empty between
  //      mousedown and the first mousemove.
  //   2. On mouseup, if the drag ended with no text selected (plain click),
  //      explicitly exit select mode.
  // The pan gesture in read.tsx is already blocked because isTextSelectingRef
  // is true while in select mode.
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

  const webOverrides: TextStyle = {
    wordBreak: "normal",
    overflowWrap: "break-word",
    hyphens: "auto",
    WebkitHyphens: "auto",
    userSelect: isSelectMode ? "text" : "none",
  } as unknown as TextStyle;

  const textStyle = [
    styles.textBody,
    fontSize != null && { fontSize },
    lineHeight != null && { lineHeight },
    letterSpacing != null && { letterSpacing },
    webOverrides,
  ];

  return (
    <View style={styles.container}>
      <Text
        style={textStyle}
        ref={textBodyRef}
        selectionColor={Colors.cursorAccent}
      >
        {children ?? text}
      </Text>
    </View>
  );
}

function SelectableTextNative({ text, onCollect, onMemo, onSelectionStateChange, fontSize, lineHeight, letterSpacing, children, clearSignal }: SelectableTextProps) {
  // When the native OS menu module is unavailable (Expo Go), the parent
  // (ReadScreen) renders the pill overlay via onSelectionStateChange.
  const useNativeMenu = TextSelectionMenu.isAvailable;

  const [selection, setSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  // When true, pass {start:0,end:0} as controlled selection to force iOS to clear handles
  const [forceClearSelection, setForceClearSelection] = useState(false);

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
        if (nowSelecting) {
          const selected = textRef.current.substring(start, end).trim();
          onSelectionStateChangeRef.current?.(true, selected);
          if (useNativeMenu) {
            TextSelectionMenu.activate(onMemo != null);
          }
        } else {
          onSelectionStateChangeRef.current?.(false);
          if (useNativeMenu) TextSelectionMenu.deactivate();
        }
      } else if (nowSelecting) {
        // selection range changed while still selecting — update parent with new text
        const selected = textRef.current.substring(start, end).trim();
        onSelectionStateChangeRef.current?.(true, selected);
      }
    },
    [onMemo, useNativeMenu],
  );

  const inputStyle = [
    styles.textInput,
    fontSize != null && { fontSize },
    lineHeight != null && { lineHeight },
    letterSpacing != null && { letterSpacing },
  ];

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
            selectionColor={Colors.cursorAccent}
            cursorColor={Colors.cursorAccent}
            selectTextOnFocus={false}
          />
        </View>
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
          selectionColor={Colors.cursorAccent}
          cursorColor={Colors.cursorAccent}
          selectTextOnFocus={false}
        />
      </View>
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
});
