import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useCallback,
} from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Animated,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import WebViewMarkdownEditor from "@/components/WebViewMarkdownEditor/WebViewMarkdownEditorCompat";
import type {
  WebViewMarkdownEditorRef,
  OnExportMarkdownPayload,
  OnSelectionUpdatePayload,
} from "@/components/WebViewMarkdownEditor/types";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import type { FormatType } from "@/components/MemoWebEditor/MemoWebEditor";

export interface MemoBottomSheetRef {
  insertQuote: (text: string) => void;
  toggleMark: (mark: string) => void;
  setBlockType: (blockType: string) => void;
  blur: () => void;
}

interface MemoBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  memoTitle: string;
  memoContent: string;
  pendingQuote?: string;
  onTitleChange: (title: string) => void;
  onExportMarkdown: (markdown: string, requestId: string) => void;
  onActiveFormatsChange: (formats: Set<FormatType>) => void;
  bodyFontSize: number;
  keyboardVisible: boolean;
  bottomInset: number;
}

const AUTOSAVE_DEBOUNCE_MS = 700;
const TOP_GAP = 8;

const MemoBottomSheet = forwardRef<MemoBottomSheetRef, MemoBottomSheetProps>(
  function MemoBottomSheet(
    {
      visible,
      onClose,
      memoTitle,
      memoContent,
      pendingQuote,
      onTitleChange,
      onExportMarkdown,
      onActiveFormatsChange,
      bodyFontSize,
      keyboardVisible,
      bottomInset,
    },
    ref,
  ) {
    const insets = useSafeAreaInsets();
    const { height: screenHeight } = useWindowDimensions();
    const editorRef = useRef<WebViewMarkdownEditorRef>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoReqRef = useRef(0);
    const pendingInsertRef = useRef<string | null>(null);
    const editorReadyRef = useRef(false);
    const closeFlushRef = useRef(false);

    // Sheet slides from bottom up; target Y leaves a small gap below status bar
    const openY = insets.top + TOP_GAP;
    const translateY = useRef(new Animated.Value(screenHeight)).current;
    const dimOpacity = useRef(new Animated.Value(0)).current;
    const animRef = useRef<Animated.CompositeAnimation | null>(null);

    useEffect(() => {
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
      if (visible) {
        translateY.setValue(screenHeight);
        dimOpacity.setValue(0);
        const anim = Animated.parallel([
          Animated.timing(translateY, {
            toValue: openY,
            duration: 280,
            easing: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
            useNativeDriver: true,
          }),
          Animated.timing(dimOpacity, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }),
        ]);
        animRef.current = anim;
        anim.start(({ finished }) => {
          if (finished) animRef.current = null;
        });
      }
    }, [visible]);

    useImperativeHandle(ref, () => ({
      insertQuote: (text: string) => {
        if (editorReadyRef.current) {
          editorRef.current?.insertQuote(text);
        } else {
          pendingInsertRef.current = text;
        }
      },
      toggleMark: (mark: string) => editorRef.current?.toggleMark(mark),
      setBlockType: (blockType: string) => editorRef.current?.setBlockType(blockType),
      blur: () => editorRef.current?.blur(),
    }), []);

    // Sync pendingQuote into the queue whenever the sheet opens.
    useEffect(() => {
      if (visible) {
        pendingInsertRef.current = pendingQuote ?? null;
        if (editorReadyRef.current && pendingInsertRef.current) {
          const text = pendingInsertRef.current;
          pendingInsertRef.current = null;
          editorRef.current?.insertQuote(text);
        }
      }
    }, [visible, pendingQuote]);

    const handleReady = useCallback(() => {
      editorReadyRef.current = true;
      if (pendingInsertRef.current) {
        const text = pendingInsertRef.current;
        pendingInsertRef.current = null;
        editorRef.current?.insertQuote(text);
      }
    }, []);

    const handleChange = useCallback(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        autoReqRef.current += 1;
        editorRef.current?.requestExportMarkdown(`auto:${autoReqRef.current}`);
      }, AUTOSAVE_DEBOUNCE_MS);
    }, []);

    const handleExport = useCallback(
      (payload: OnExportMarkdownPayload) => {
        onExportMarkdown(payload.markdown, payload.requestId);
        if (payload.requestId === "close-flush") {
          closeFlushRef.current = false;
          onClose();
        }
      },
      [onExportMarkdown, onClose],
    );

    // Slide the sheet back down, then flush content and close.
    const handleClose = useCallback(() => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (animRef.current) {
        animRef.current.stop();
        animRef.current = null;
      }
      const anim = Animated.parallel([
        Animated.timing(translateY, {
          toValue: screenHeight,
          duration: 260,
          easing: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
          useNativeDriver: true,
        }),
        Animated.timing(dimOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]);
      animRef.current = anim;
      anim.start(({ finished }) => {
        animRef.current = null;
        if (finished) {
          closeFlushRef.current = true;
          editorRef.current?.requestExportMarkdown("close-flush");
          const fallbackId = setTimeout(() => {
            if (closeFlushRef.current) {
              closeFlushRef.current = false;
              onClose();
            }
          }, 600);
          void fallbackId;
        }
      });
    }, [onClose, screenHeight, translateY, dimOpacity]);

    const handleSelection = useCallback(
      (payload: OnSelectionUpdatePayload) => {
        const formats = new Set<FormatType>();
        if (payload.isBold) formats.add("bold");
        if (payload.isItalic) formats.add("italic");
        if (payload.isUnderline) formats.add("underline");
        if (payload.activeBlock === "blockquote") formats.add("quote");
        onActiveFormatsChange(formats);
      },
      [onActiveFormatsChange],
    );

    useEffect(() => {
      if (!visible) {
        editorReadyRef.current = false;
        pendingInsertRef.current = null;
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
      }
    }, [visible]);

    if (!visible) return null;

    return (
      <>
        {/* Dim overlay — blocks touches on underlying reader */}
        <Animated.View
          style={[styles.dim, { opacity: dimOpacity }]}
          pointerEvents="auto"
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        </Animated.View>

        {/* Sheet — full-height card sliding up from bottom */}
        <Animated.View
          style={[
            styles.sheet,
            { height: screenHeight, transform: [{ translateY }] },
          ]}
        >
          {/* Handle bar (same as BottomSheet) */}
          <View style={styles.handleArea}>
            <View style={styles.handle} />

            {/* Title row: editable title + X close */}
            <View style={styles.titleRow}>
              <TextInput
                style={[styles.titleInput, { fontSize: Math.max(15, bodyFontSize * 0.9) }]}
                value={memoTitle}
                onChangeText={onTitleChange}
                placeholder="메모 제목"
                placeholderTextColor={Colors.zinc300}
                returnKeyType="done"
                blurOnSubmit
              />
              <Pressable onPress={handleClose} hitSlop={16} style={styles.closeBtn}>
                <Feather name="x" size={20} color={Colors.zinc500} />
              </Pressable>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.editorWrap}>
            <WebViewMarkdownEditor
              ref={editorRef}
              initialMarkdown={memoContent}
              placeholder="메모를 적어보세요..."
              editable
              hideTitle
              bodyFontSize={bodyFontSize}
              bodyLetterSpacing={0.3}
              scrollEnabled
              swipeDownToDismissKeyboard={false}
              onReady={handleReady}
              onChange={handleChange}
              onExportMarkdown={handleExport}
              onSelectionUpdate={handleSelection}
            />
          </View>

          {/* Bottom safe-area padding */}
          {!keyboardVisible && (
            <View style={{ height: Math.max(bottomInset, 16) }} />
          )}
        </Animated.View>
      </>
    );
  },
);

export default MemoBottomSheet;

const styles = StyleSheet.create({
  dim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    zIndex: 50,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: Colors.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
    zIndex: 51,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.10,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
      default: {},
    }),
  },
  handleArea: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
    minHeight: 28,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.zinc300,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    paddingHorizontal: Spacing.screenPx,
    alignSelf: "stretch",
  },
  titleInput: {
    flex: 1,
    fontFamily: Platform.select({ ios: "Pretendard-SemiBold", default: "Pretendard-SemiBold" }),
    fontWeight: "600",
    color: Colors.zinc900,
    padding: 0,
    margin: 0,
  },
  closeBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: 1,
    backgroundColor: Colors.zinc100,
    marginHorizontal: Spacing.screenPx,
    marginTop: 8,
  },
  editorWrap: {
    flex: 1,
  },
});
