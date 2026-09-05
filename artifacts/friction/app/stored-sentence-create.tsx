import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListStoredSentencesQueryKey,
  useCreateStoredSentence,
} from "@workspace/api-client-react";
import HeaderButton from "@/components/shared/HeaderButton";
import ActionSheetModal, { type ActionSheetAction } from "@/components/ActionSheetModal/ActionSheetModal";
import { Colors, ReaderTokens, Shadows, Spacing, Typography, readerFontSize } from "@/constants/tokens";
import { useToast } from "@/contexts/ToastContext";
import { useUser } from "@/contexts/UserContext";

export default function StoredSentenceCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { userId } = useUser();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const createSentence = useCreateStoredSentence();
  
  const [menuVisible, setMenuVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bodyText, setBodyText] = useState("");
  const [sourceText, setSourceText] = useState("");
  
  const actionLock = useRef(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;
  const cardWidth = Math.max(1, Math.min(width - Spacing.screenPx * 2, 680));
  const bodySize = readerFontSize(ReaderTokens.typeScale.bodyCqi, cardWidth);
  const sourceSize = readerFontSize(ReaderTokens.typeScale.captionCqi, cardWidth);

  const busy = actionLock.current || createSentence.isPending;

  const runAction = useCallback(async (work: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setActionError(null);
    try {
      await work();
    } finally {
      actionLock.current = false;
    }
  }, []);

  const handleSave = useCallback(() => {
    if (actionLock.current || !bodyText.trim() || createSentence.isPending) return;
    
    void runAction(async () => {
      try {
        await createSentence.mutateAsync({
          data: {
            userId,
            text: bodyText.trim(),
            sourceText: sourceText.trim() || null,
          },
        });
        
        await queryClient.invalidateQueries({ queryKey: getListStoredSentencesQueryKey({ userId }) });
        showToast({ message: "문장을 수집했어요.", type: "success" });
        setMenuVisible(false);
        router.back();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "문장 수집에 실패했어요. 다시 시도해주세요.");
        showToast({ message: "문장 수집에 실패했어요.", type: "error" });
        setMenuVisible(false);
      }
    });
  }, [bodyText, createSentence, queryClient, router, runAction, showToast, sourceText, userId]);

  const actions = useMemo<ActionSheetAction[]>(() => [
    { label: "저장하기", onPress: handleSave, disabled: busy || !bodyText.trim() },
    { label: "취소", style: "cancel" as const, onPress: () => undefined },
  ], [busy, bodyText, handleSave]);

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <HeaderButton variant="back" onPress={() => router.back()} disabled={busy} />
        <Text style={styles.headerTitle}>문장 추가</Text>
        <HeaderButton variant="menu" onPress={() => setMenuVisible(true)} disabled={busy} busy={busy} />
      </View>
      
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, { width: cardWidth }]}>
          <TextInput
            style={[
              styles.bodyInput,
              { fontSize: bodySize, lineHeight: bodySize * ReaderTokens.lineHeight.relaxed }
            ]}
            value={bodyText}
            onChangeText={setBodyText}
            placeholder="수집할 문장을 입력하세요..."
            placeholderTextColor={Colors.zinc300}
            multiline
            autoFocus
            accessibilityLabel="문장 본문"
            cursorColor={Colors.noticeAccent}
            selectionColor={Colors.noticeAccent + "40"}
            textAlignVertical="top"
          />
          <TextInput
            style={[
              styles.sourceInput,
              { fontSize: sourceSize, lineHeight: sourceSize * 1.5 }
            ]}
            value={sourceText}
            onChangeText={setSourceText}
            placeholder="저자, <제목>, 면 수"
            placeholderTextColor={Colors.noticeAccent + "60"}
            cursorColor={Colors.noticeAccent}
            selectionColor={Colors.noticeAccent + "40"}
            multiline
            textAlignVertical="top"
            accessibilityLabel="문장 출처"
          />
        </View>
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
      </ScrollView>

      <ActionSheetModal 
        visible={menuVisible} 
        title="새 수집 문장" 
        actions={actions} 
        onClose={() => setMenuVisible(false)} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  header: {
    height: 68,
    paddingHorizontal: Spacing.screenPx,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: { ...Typography.bodySemiBold, fontSize: 17, color: Colors.zinc900 },
  scrollContent: { alignItems: "center", paddingTop: 16, paddingHorizontal: Spacing.screenPx },
  card: {
    position: "relative",
    minHeight: 280,
    borderRadius: 16,
    backgroundColor: Colors.white,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    justifyContent: "space-between",
    ...Shadows.card,
  },
  bodyInput: { 
    fontFamily: ReaderTokens.fontFamily.serif, 
    color: Colors.zinc900,
    minHeight: 120,
  },
  sourceInput: {
    marginTop: 40,
    fontFamily: ReaderTokens.fontFamily.serifBold,
    fontWeight: "600",
    color: Colors.noticeAccent,
    minHeight: 30,
  },
  actionError: { 
    ...Typography.caption, 
    color: Colors.noticeAccent, 
    marginTop: 18, 
    textAlign: "center" 
  },
});
