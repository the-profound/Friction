import React, { useRef, useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import WebViewMarkdownEditor from "@/components/WebViewMarkdownEditor/WebViewMarkdownEditorCompat";
import type {
  WebViewMarkdownEditorRef,
  OnChangePayload,
  OnExportMarkdownPayload,
} from "@/components/WebViewMarkdownEditor/types";
import { Colors, Typography } from "@/constants/tokens";

interface MemoBottomSheetProps {
  visible: boolean;
  onClose: () => void | Promise<void>;
  initialContent?: string;
  appendContent?: string;
  initialTitle?: string;
  defaultTitlePlaceholder?: string;
  onTitleChange?: (title: string) => void;
  saveState?: "idle" | "saving" | "saved" | "error";
  onSaveStateChange?: (state: "saved" | "saving" | "error") => void;
  onContentChange?: (markdown: string) => void;
}

const CLOSE_EXPORT_TIMEOUT_MS = 2000;

export default function MemoBottomSheet({
  visible,
  onClose,
  initialContent = "",
  appendContent,
  initialTitle = "",
  defaultTitlePlaceholder = "읽기 메모",
  onTitleChange,
  saveState: externalSaveState,
  onSaveStateChange,
  onContentChange,
}: MemoBottomSheetProps) {
  const editorRef = useRef<WebViewMarkdownEditorRef>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [localSaveState, setLocalSaveState] = useState<"saved" | "saving" | "error" | "idle">("idle");
  const [isClosing, setIsClosing] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportRequestIdRef = useRef(0);
  const appendInjectedRef = useRef(false);
  const closeExportResolverRef = useRef<(() => void) | null>(null);
  const saveState = externalSaveState ?? localSaveState;

  const effectiveInitialTitle = initialTitle.trim()
    ? initialTitle
    : defaultTitlePlaceholder;

  useEffect(() => {
    if (!visible) {
      setEditorReady(false);
      setLocalSaveState("idle");
      setIsClosing(false);
      appendInjectedRef.current = false;
      if (closeExportResolverRef.current) {
        closeExportResolverRef.current();
        closeExportResolverRef.current = null;
      }
    }
  }, [visible]);

  useEffect(() => {
    if (editorReady && appendContent && !appendInjectedRef.current) {
      appendInjectedRef.current = true;
      editorRef.current?.setMarkdown(appendContent);
    }
  }, [editorReady, appendContent]);

  const handleSaveStateUpdate = useCallback(
    (state: "saved" | "saving" | "error") => {
      setLocalSaveState(state);
      onSaveStateChange?.(state);
    },
    [onSaveStateChange],
  );

  const handleChange = useCallback(
    (_payload: OnChangePayload) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      handleSaveStateUpdate("saving");
      exportRequestIdRef.current += 1;
      const reqId = String(exportRequestIdRef.current);
      editorRef.current?.requestExportMarkdown(reqId);
      debounceTimerRef.current = setTimeout(() => {
        handleSaveStateUpdate("saved");
      }, 1500);
    },
    [handleSaveStateUpdate],
  );

  const handleExportMarkdown = useCallback(
    (payload: OnExportMarkdownPayload) => {
      onContentChange?.(payload.markdown);
      if (payload.requestId === "close" && closeExportResolverRef.current) {
        closeExportResolverRef.current();
        closeExportResolverRef.current = null;
      }
    },
    [onContentChange],
  );

  const handleClose = useCallback(async () => {
    if (isClosing) return;
    setIsClosing(true);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (editorRef.current && editorReady) {
      const exportDone = new Promise<void>((resolve) => {
        closeExportResolverRef.current = resolve;
      });
      editorRef.current.requestExportMarkdown("close");
      await Promise.race([
        exportDone,
        new Promise<void>((resolve) => setTimeout(resolve, CLOSE_EXPORT_TIMEOUT_MS)),
      ]);
      closeExportResolverRef.current = null;
    }
    try {
      await onClose();
    } finally {
      setIsClosing(false);
    }
  }, [isClosing, editorReady, onClose]);

  const saveIndicatorText = isClosing
    ? "저장 중..."
    : saveState === "saving"
      ? "저장 중..."
      : saveState === "saved"
        ? "저장됨"
        : saveState === "error"
          ? "저장 실패"
          : "";

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      snapPoints={[0.92]}
      enableDragDown={false}
      dismissable={false}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft} />
          <View style={styles.headerRight}>
            {saveIndicatorText ? (
              <Text style={styles.saveState}>{saveIndicatorText}</Text>
            ) : null}
            <Pressable
              onPress={handleClose}
              style={styles.closeButton}
              hitSlop={12}
              disabled={isClosing}
            >
              <Text style={[styles.closeButtonText, isClosing && styles.closeButtonTextDisabled]}>
                닫기
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.editorContainer}>
          {!editorReady && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="small" color={Colors.zinc400} />
            </View>
          )}
          <WebViewMarkdownEditor
            ref={editorRef}
            initialMarkdown={initialContent}
            titleValue={effectiveInitialTitle}
            placeholder="읽으면서 떠오른 생각을 적어보세요..."
            editable
            onReady={() => setEditorReady(true)}
            onChange={handleChange}
            onExportMarkdown={handleExportMarkdown}
            onTitleChange={onTitleChange}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
    marginBottom: 8,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  saveState: {
    fontSize: 12,
    color: Colors.zinc400,
  },
  closeButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  closeButtonText: {
    ...Typography.bodySemiBold,
    color: Colors.zinc600,
  },
  closeButtonTextDisabled: {
    color: Colors.zinc400,
  },
  editorContainer: {
    flex: 1,
    position: "relative",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
});
