import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useCallback,
} from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Animated,
  Pressable,
  Platform,
  Keyboard,
  PanResponder,
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
import { Colors, Typography, Spacing, ReaderTokens } from "@/constants/tokens";
import type { FormatType } from "@/components/MemoWebEditor/MemoWebEditor";
import type { BodyTypographyMetrics } from "@/lib/bodyLayout";

export interface MemoBottomSheetRef {
  insertQuote: (text: string) => void;
  toggleMark: (mark: string) => void;
  setBlockType: (blockType: string) => void;
  insertDivider: () => void;
  insertHardBreak: () => void;
  focus: () => void;
  blur: () => void;
  undo: () => void;
  redo: () => void;
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
  onSelectionUpdate?: (payload: OnSelectionUpdatePayload) => void;
  bodyFontSize: number;
  keyboardVisible: boolean;
  keyboardHeight: number;
  bottomInset: number;
}

const AUTOSAVE_DEBOUNCE_MS = 700;
const TOP_GAP = 8;
const SWIPE_CLOSE_THRESHOLD = 80;
const SWIPE_VELOCITY_THRESHOLD = 0.5;

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
      onSelectionUpdate,
      bodyFontSize,
      keyboardVisible,
      keyboardHeight,
      bottomInset,
    },
    ref,
  ) {
    const insets = useSafeAreaInsets();
    const { height: screenHeight, width: screenWidth } = useWindowDimensions();
    const typography: BodyTypographyMetrics = {
      textColumnWidth: screenWidth - Spacing.screenPx * 2,
      fontSizePx: bodyFontSize,
      lineHeightPx: bodyFontSize * ReaderTokens.lineHeight.relaxed,
      paragraphGapPx: bodyFontSize * ReaderTokens.paragraphSpacing.bodyEm,
      letterSpacingPx: 0.3,
      titleFontSizePx: bodyFontSize * 1.6,
      textScalePercent: 100,
    };
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
          Animated.spring(translateY, {
            toValue: openY,
            damping: 30,
            stiffness: 200,
            useNativeDriver: true,
          }),
          Animated.timing(dimOpacity, {
            toValue: 1,
            duration: 200,
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
      insertDivider: () => editorRef.current?.insertDivider(),
      insertHardBreak: () => editorRef.current?.insertHardBreak(),
      focus: () => editorRef.current?.focus(),
      blur: () => editorRef.current?.blur(),
      undo: () => editorRef.current?.undo(),
      redo: () => editorRef.current?.redo(),
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
        Animated.spring(translateY, {
          toValue: screenHeight,
          damping: 30,
          stiffness: 200,
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

    // Keep a stable ref so PanResponder can always call the latest handleClose.
    const handleCloseRef = useRef(handleClose);
    handleCloseRef.current = handleClose;

    // PanResponder for the grab pill only — drag down to dismiss.
    // onStartShouldSetPanResponder is false so that taps on this zone
    // do NOT steal touches from sibling controls (TextInput / close button).
    // The responder only claims the gesture once a downward move is detected.
    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gs) =>
          gs.dy > 4 && gs.dy > Math.abs(gs.dx),
        onMoveShouldSetPanResponderCapture: () => false,
        onPanResponderMove: (_, gs) => {
          if (gs.dy > 0) {
            translateY.setValue(openY + gs.dy);
          }
        },
        onPanResponderRelease: (_, gs) => {
          if (gs.dy > SWIPE_CLOSE_THRESHOLD || gs.vy > SWIPE_VELOCITY_THRESHOLD) {
            handleCloseRef.current();
          } else {
            Animated.spring(translateY, {
              toValue: openY,
              useNativeDriver: true,
              damping: 30,
              stiffness: 200,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: openY,
            useNativeDriver: true,
            damping: 30,
            stiffness: 200,
          }).start();
        },
      }),
    ).current;

    const handleSelection = useCallback(
      (payload: OnSelectionUpdatePayload) => {
        const formats = new Set<FormatType>();
        if (payload.isBold) formats.add("bold");
        if (payload.isItalic) formats.add("italic");
        if (payload.isUnderline) formats.add("underline");
        if (payload.activeBlock === "blockquote") formats.add("quote");
        onActiveFormatsChange(formats);
        onSelectionUpdate?.(payload);
      },
      [onActiveFormatsChange, onSelectionUpdate],
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

    const editorBottomPad = keyboardVisible ? keyboardHeight : Math.max(bottomInset, 16);

    return (
      <>
        {/* Dim overlay — keyboard-first dismiss, then sheet close */}
        <Animated.View
          style={[styles.dim, { opacity: dimOpacity }]}
          pointerEvents="auto"
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (keyboardVisible) {
                Keyboard.dismiss();
              } else {
                handleClose();
              }
            }}
          />
        </Animated.View>

        {/* Sheet — full-height card sliding up from bottom */}
        <Animated.View
          style={[
            styles.sheet,
            { height: screenHeight, transform: [{ translateY }] },
          ]}
        >
          {/* Handle bar — grab pill is the drag target; title row is independent */}
          <View style={styles.handleArea}>
            {/* Grab zone: pill + padding. panHandlers here, NOT on titleRow. */}
            <View style={styles.handleGrabZone} {...panResponder.panHandlers}>
              <View style={styles.handle} />
            </View>

            {/* Title row: editable title + X close — no panHandlers */}
            <View style={styles.titleRow}>
              <TextInput
                style={[styles.titleInput, { fontSize: Math.max(18, bodyFontSize * 1.1) }]}
                value={memoTitle}
                onChangeText={onTitleChange}
                placeholder="메모 제목"
                placeholderTextColor={Colors.zinc300}
                cursorColor={Colors.cursorAccent}
                returnKeyType="done"
                blurOnSubmit
              />
              <Pressable onPress={handleClose} hitSlop={16} style={styles.closeBtn}>
                <Feather name="x" size={20} color={Colors.zinc500} />
              </Pressable>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={[styles.editorWrap, { paddingBottom: editorBottomPad }]}>
            <WebViewMarkdownEditor
              ref={editorRef}
              initialMarkdown={memoContent}
              placeholder="메모를 적어보세요..."
              editable
              hideTitle
              typography={typography}
              scrollEnabled
              swipeDownToDismissKeyboard={false}
              onReady={handleReady}
              onChange={handleChange}
              onExportMarkdown={handleExport}
              onSelectionUpdate={handleSelection}
            />
          </View>
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
    paddingBottom: 4,
  },
  handleGrabZone: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
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
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
  },
});
