import React, { useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { useUser } from "@/contexts/UserContext";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import {
  useListArticles,
  useListNeighbors,
  useSendArticle,
} from "@workspace/api-client-react";
import type { NeighborWithUser } from "@workspace/api-client-react";
import { getNextDeliverySlot, formatDeliveryTime, canSendToNeighbor } from "@/lib/deliverySync";
import type { ArticleStatus } from "@/lib/policies";

interface LetterArticle {
  id: string;
  title: string;
  status: string;
  content?: string;
}

export default function SendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useUser();

  const [selectedArticle, setSelectedArticle] = useState<LetterArticle | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<NeighborWithUser | null>(null);
  const [letterPickerVisible, setLetterPickerVisible] = useState(false);
  const [recipientPickerVisible, setRecipientPickerVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const articlesQuery = useListArticles({ authorId: userId, status: "LETTER" as const });
  const articles = (articlesQuery.data ?? []) as LetterArticle[];
  const neighborsQuery = useListNeighbors({ userId });
  const neighbors = (neighborsQuery.data ?? []) as NeighborWithUser[];
  const sendArticle = useSendArticle();

  const deliveryInfo = useMemo(() => getNextDeliverySlot(), [confirmVisible]);

  const canSend = selectedArticle && selectedRecipient;

  const handleSend = useCallback(async () => {
    if (!selectedArticle || !selectedRecipient) return;

    const isNeighbor = neighbors.some((n) => n.neighborUserId === selectedRecipient.neighborUserId);
    const guard = canSendToNeighbor(
      selectedArticle.status as ArticleStatus,
      userId,
      selectedRecipient.neighborUserId,
      isNeighbor,
    );
    if (!guard.allowed) {
      Alert.alert("보낼 수 없음", guard.reason ?? "");
      return;
    }

    try {
      const result = await sendArticle.mutateAsync({
        data: {
          senderId: userId,
          recipientId: selectedRecipient.neighborUserId,
          articleId: selectedArticle.id,
        },
      });
      setConfirmVisible(false);
      const arrivalTime = result?.deliverySlot
        ? formatDeliveryTime(new Date(result.deliverySlot))
        : formatDeliveryTime(deliveryInfo.visibleAt);
      Alert.alert(
        "발송 완료",
        `'${selectedArticle.title}'이(가) ${selectedRecipient.user?.nickname ?? "이웃"}에게 발송되었어요.\n${arrivalTime}에 도착 예정`,
        [{ text: "확인", onPress: () => router.back() }],
      );
    } catch (e: unknown) {
      setConfirmVisible(false);
      const msg = e instanceof Error ? e.message : "발송에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [selectedArticle, selectedRecipient, userId, sendArticle, deliveryInfo, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>보내기</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>편지 선택</Text>
          <Pressable style={styles.selectButton} onPress={() => setLetterPickerVisible(true)}>
            <Feather name="file-text" size={18} color={selectedArticle ? Colors.zinc900 : Colors.zinc500} />
            <Text style={[styles.selectButtonText, selectedArticle && styles.selectButtonTextActive]}>
              {selectedArticle?.title ?? "보낼 편지를 선택하세요"}
            </Text>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>받는 사람</Text>
          <Pressable style={styles.selectButton} onPress={() => setRecipientPickerVisible(true)}>
            <Feather name="user" size={18} color={selectedRecipient ? Colors.zinc900 : Colors.zinc500} />
            <Text style={[styles.selectButtonText, selectedRecipient && styles.selectButtonTextActive]}>
              {selectedRecipient?.user?.nickname ?? "받는 사람을 선택하세요"}
            </Text>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </Pressable>
        </View>

        <View style={styles.deliveryInfo}>
          <Feather name="clock" size={16} color={Colors.zinc500} />
          <Text style={styles.deliveryInfoText}>
            다음 배달: {formatDeliveryTime(deliveryInfo.visibleAt)}
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[styles.sendButton, (!canSend || sendArticle.isPending) && styles.sendButtonDisabled]}
          disabled={!canSend || sendArticle.isPending}
          onPress={() => setConfirmVisible(true)}
        >
          <Feather name="send" size={16} color={canSend && !sendArticle.isPending ? Colors.white : Colors.zinc400} />
          <Text style={[styles.sendButtonText, (!canSend || sendArticle.isPending) && styles.sendButtonTextDisabled]}>
            {sendArticle.isPending ? "보내는 중..." : "보내기"}
          </Text>
        </Pressable>
      </View>

      <BottomSheet
        visible={letterPickerVisible}
        onClose={() => setLetterPickerVisible(false)}
        title="편지 선택"
        snapPoints={[0.5]}
      >
        {articlesQuery.isLoading ? (
          <View style={styles.pickerEmpty}>
            <Text style={styles.pickerEmptySub}>불러오는 중...</Text>
          </View>
        ) : articlesQuery.isError ? (
          <View style={styles.pickerEmpty}>
            <Feather name="alert-circle" size={32} color={Colors.zinc300} />
            <Text style={styles.pickerEmptyTitle}>불러오기 실패</Text>
            <Pressable onPress={() => articlesQuery.refetch()}>
              <Text style={[styles.pickerEmptySub, { color: Colors.zinc900 }]}>다시 시도</Text>
            </Pressable>
          </View>
        ) : articles.length === 0 ? (
          <View style={styles.pickerEmpty}>
            <Feather name="file-text" size={32} color={Colors.zinc300} />
            <Text style={styles.pickerEmptyTitle}>완성된 편지가 없어요</Text>
            <Text style={styles.pickerEmptySub}>LETTER 상태의 글만 보낼 수 있어요</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {articles.map((article) => (
              <Pressable
                key={article.id}
                style={[styles.pickerItem, selectedArticle?.id === article.id && styles.pickerItemSelected]}
                onPress={() => {
                  setSelectedArticle(article);
                  setLetterPickerVisible(false);
                }}
              >
                <Text style={styles.pickerItemTitle} numberOfLines={1}>{article.title || "제목 없음"}</Text>
                {article.content && (
                  <Text style={styles.pickerItemSub} numberOfLines={1}>{article.content.substring(0, 60)}</Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </BottomSheet>

      <BottomSheet
        visible={recipientPickerVisible}
        onClose={() => setRecipientPickerVisible(false)}
        title="받는 사람 선택"
        snapPoints={[0.5]}
      >
        {neighborsQuery.isLoading ? (
          <View style={styles.pickerEmpty}>
            <Text style={styles.pickerEmptySub}>불러오는 중...</Text>
          </View>
        ) : neighborsQuery.isError ? (
          <View style={styles.pickerEmpty}>
            <Feather name="alert-circle" size={32} color={Colors.zinc300} />
            <Text style={styles.pickerEmptyTitle}>불러오기 실패</Text>
            <Pressable onPress={() => neighborsQuery.refetch()}>
              <Text style={[styles.pickerEmptySub, { color: Colors.zinc900 }]}>다시 시도</Text>
            </Pressable>
          </View>
        ) : neighbors.length === 0 ? (
          <View style={styles.pickerEmpty}>
            <Feather name="users" size={32} color={Colors.zinc300} />
            <Text style={styles.pickerEmptyTitle}>이웃이 없어요</Text>
            <Text style={styles.pickerEmptySub}>먼저 이웃을 추가해주세요</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {neighbors.map((neighbor) => (
              <Pressable
                key={neighbor.id}
                style={[styles.pickerItem, selectedRecipient?.id === neighbor.id && styles.pickerItemSelected]}
                onPress={() => {
                  setSelectedRecipient(neighbor);
                  setRecipientPickerVisible(false);
                }}
              >
                <View style={styles.pickerNeighborRow}>
                  <View style={styles.pickerAvatar}>
                    <Text style={styles.pickerAvatarText}>{(neighbor.user?.nickname ?? "?")[0]}</Text>
                  </View>
                  <View style={styles.pickerNeighborInfo}>
                    <Text style={styles.pickerItemTitle}>{neighbor.user?.nickname ?? "이름 없음"}</Text>
                    <Text style={styles.pickerItemSub}>{neighbor.user?.email ?? ""}</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </BottomSheet>

      <ConfirmModal
        visible={confirmVisible}
        title="편지 보내기"
        description={`'${selectedArticle?.title ?? ""}'을(를)\n${selectedRecipient?.user?.nickname ?? ""}에게 보내시겠어요?\n\n${formatDeliveryTime(deliveryInfo.visibleAt)}에 도착 예정`}
        confirmLabel="보내기"
        cancelLabel="취소"
        onConfirm={handleSend}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
    gap: 24,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  selectButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.zinc50,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  selectButtonText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    flex: 1,
  },
  selectButtonTextActive: {
    color: Colors.zinc900,
    fontWeight: "600",
  },
  deliveryInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: Colors.zinc50,
    borderRadius: 12,
  },
  deliveryInfoText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
  },
  footer: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.zinc900,
    paddingVertical: 16,
    borderRadius: 12,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.zinc100,
  },
  sendButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  sendButtonTextDisabled: {
    color: Colors.zinc400,
  },
  pickerEmpty: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 40,
  },
  pickerEmptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 8,
  },
  pickerEmptySub: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
  },
  pickerItem: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  pickerItemSelected: {
    backgroundColor: Colors.zinc50,
  },
  pickerItemTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  pickerItemSub: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    marginTop: 2,
  },
  pickerNeighborRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pickerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerAvatarText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc600,
  },
  pickerNeighborInfo: {
    flex: 1,
    gap: 2,
  },
});
