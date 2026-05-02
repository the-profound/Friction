import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import SubmitButton from "@/components/SubmitButton/SubmitButton";
import {
  ApiError,
  getGetTodayGreetingStatusQueryKey,
  getListSendRecordsQueryKey,
  getListTeamArticlesQueryKey,
  useAddTeamArticle,
  useGetTodayGreetingStatus,
  useListArticles,
  useListNeighbors,
  useListTeamCollections,
  useSendArticle,
} from "@workspace/api-client-react";
import type {
  NeighborWithUser,
  TeamCollectionWithRole,
} from "@workspace/api-client-react";
import {
  canSendToNeighbor,
  formatDeliveryTime,
  getNextDeliverySlot,
} from "@/lib/deliverySync";
import type { ArticleStatus } from "@/lib/policies";

interface LetterArticle {
  id: string;
  title: string;
  status: string;
  content?: string;
}

type RecipientNeighbor = { type: "neighbor"; data: NeighborWithUser };
type RecipientCollection = { type: "collection"; data: TeamCollectionWithRole };
type Recipient = RecipientNeighbor | RecipientCollection | null;

type SegmentTab = "neighbor" | "collection";

interface SendInlineProps {
  /** Pre-selected target group id (for case A from of-02-detail). */
  targetGroup?: string;
  /** Pre-selected target group display name. */
  targetGroupName?: string;
  /** Pre-selected article id (for case B from inbox / OF). */
  prefillArticleId?: string;
  /** Pre-selected neighbor id (for case A' from neighbor card). */
  prefillNeighborId?: string;
  /** Optional team collection id whose article list should be invalidated after send. */
  returnToId?: string;
  /** Bumps when prefill params change so the component re-applies them. */
  prefillKey?: string | number;
  /** Called after a successful send so the parent can clear prefill query params. */
  onSent?: () => void;
}

export function SendInline({
  targetGroup,
  targetGroupName,
  prefillArticleId,
  prefillNeighborId,
  returnToId,
  prefillKey,
  onSent,
}: SendInlineProps) {
  const navBottom = useNavBarBottomSafeArea();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const { showToast } = useToast();

  const [selectedArticle, setSelectedArticle] = useState<LetterArticle | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient>(null);
  const [letterPickerVisible, setLetterPickerVisible] = useState(false);
  const [recipientPickerVisible, setRecipientPickerVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const [segmentTab, setSegmentTab] = useState<SegmentTab>("neighbor");
  const [pendingRecipient, setPendingRecipient] = useState<Recipient>(null);

  const articlesQuery = useListArticles({ authorId: userId, status: "LETTER" as const });
  const articles = (articlesQuery.data ?? []) as LetterArticle[];
  const neighborsQuery = useListNeighbors({ userId });
  const neighbors = (neighborsQuery.data ?? []) as NeighborWithUser[];
  const teamCollectionsQuery = useListTeamCollections({ userId });
  const teamCollections = (teamCollectionsQuery.data ?? []) as TeamCollectionWithRole[];

  const sendArticle = useSendArticle();
  const addToTeamCollection = useAddTeamArticle();

  const deliveryInfo = useMemo(() => getNextDeliverySlot(), [confirmVisible]);

  // When a team collection is selected, look up whether the current user can
  // send today's greeting (only OWNERs, and only once per KST notice day).
  const collectionId =
    selectedRecipient?.type === "collection" ? selectedRecipient.data.id : null;
  const todayGreetingQuery = useGetTodayGreetingStatus(
    collectionId ?? "",
    { userId },
    {
      query: {
        queryKey: getGetTodayGreetingStatusQueryKey(collectionId ?? "", { userId }),
        enabled: !!collectionId,
      },
    },
  );
  const greetingStatus = todayGreetingQuery.data;
  // While the greeting status is still loading for a selected collection,
  // hold the send button so eligible OWNERs can't accidentally bypass the
  // notice prompt by tapping faster than the query resolves.
  const greetingStatusLoading =
    !!collectionId && (todayGreetingQuery.isLoading || todayGreetingQuery.isFetching) && !greetingStatus;
  const canOfferTodayGreeting =
    !!collectionId && !!greetingStatus && greetingStatus.isOwner && !greetingStatus.alreadySentToday;
  const [noticePromptVisible, setNoticePromptVisible] = useState(false);

  const noticeDateLabel = useMemo(() => {
    if (!greetingStatus?.noticeDate) return "";
    const [, mm, dd] = greetingStatus.noticeDate.split("-");
    if (!mm || !dd) return "";
    return `${parseInt(mm, 10)}월 ${parseInt(dd, 10)}일`;
  }, [greetingStatus?.noticeDate]);

  // Apply collection prefill (case A: from of-02-detail "내 글 추가")
  useEffect(() => {
    if (!targetGroup) return;
    const resolvedName =
      targetGroupName ||
      teamCollections.find((c) => c.id === targetGroup)?.name ||
      "모음";
    const preselected: RecipientCollection = {
      type: "collection",
      data: {
        id: targetGroup,
        name: resolvedName,
        creatorId: "",
        role: "MEMBER",
        createdAt: "",
        updatedAt: "",
      } as TeamCollectionWithRole,
    };
    setSelectedRecipient(preselected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetGroup, targetGroupName, teamCollections, prefillKey]);

  // Apply neighbor prefill (case A': neighbor card tap)
  useEffect(() => {
    if (!prefillNeighborId) return;
    const found = neighbors.find((n) => n.neighborUserId === prefillNeighborId);
    if (found) {
      setSelectedRecipient({ type: "neighbor", data: found });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNeighborId, neighbors, prefillKey]);

  // Apply article prefill (case B: from OF / inbox)
  useEffect(() => {
    if (!prefillArticleId) return;
    const found = articles.find((a) => a.id === prefillArticleId);
    if (found) {
      setSelectedArticle(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillArticleId, articles, prefillKey]);

  const canSend = !!selectedArticle && !!selectedRecipient;

  const recipientDisplayName = useMemo(() => {
    if (!selectedRecipient) return null;
    if (selectedRecipient.type === "neighbor") {
      return selectedRecipient.data.user?.nickname ?? "이웃";
    }
    return selectedRecipient.data.name;
  }, [selectedRecipient]);

  const handleSend = useCallback(
    async (asNotice = false) => {
      if (!selectedArticle || !selectedRecipient) return;

      try {
        if (selectedRecipient.type === "neighbor") {
          const neighbor = selectedRecipient.data;
          const isNeighbor = neighbors.some((n) => n.neighborUserId === neighbor.neighborUserId);
          const guard = canSendToNeighbor(
            selectedArticle.status as ArticleStatus,
            userId,
            neighbor.neighborUserId,
            isNeighbor,
          );
          if (!guard.allowed) {
            Alert.alert("보낼 수 없음", guard.reason ?? "");
            return;
          }
          const result = await sendArticle.mutateAsync({
            data: {
              senderId: userId,
              recipientId: neighbor.neighborUserId,
              articleId: selectedArticle.id,
            },
          });
          setConfirmVisible(false);
          setNoticePromptVisible(false);
          const arrivalTime = result?.deliverySlot
            ? formatDeliveryTime(new Date(result.deliverySlot))
            : formatDeliveryTime(deliveryInfo.visibleAt);
          queryClient.invalidateQueries({ queryKey: getListSendRecordsQueryKey({ senderId: userId }) });
          showToast({
            message: `${neighbor.user?.nickname ?? "이웃"}에게 발송됐어요 · ${arrivalTime} 도착 예정`,
            type: "success",
          });
        } else {
          const collection = selectedRecipient.data;
          await addToTeamCollection.mutateAsync({
            id: collection.id,
            data: {
              articleId: selectedArticle.id,
              addedBy: userId,
              ...(asNotice ? { asNotice: true } : {}),
            },
          });
          setConfirmVisible(false);
          setNoticePromptVisible(false);
          const arrivalTime = formatDeliveryTime(deliveryInfo.visibleAt);
          if (returnToId) {
            queryClient.invalidateQueries({ queryKey: getListTeamArticlesQueryKey(returnToId) });
          }
          queryClient.invalidateQueries({ queryKey: getListSendRecordsQueryKey({ senderId: userId }) });
          queryClient.invalidateQueries({
            queryKey: getGetTodayGreetingStatusQueryKey(collection.id, { userId }),
          });
          showToast({
            message: asNotice
              ? `'${collection.name}' 모음에 오늘의 인사를 보냈어요 · ${arrivalTime} 도착 예정`
              : `'${collection.name}' 모음에 발송됐어요 · ${arrivalTime} 도착 예정`,
            type: "success",
          });
        }
        setSelectedArticle(null);
        setSelectedRecipient(null);
        onSent?.();
      } catch (e: unknown) {
        setConfirmVisible(false);
        setNoticePromptVisible(false);
        let msg = "실패했습니다.";
        if (e instanceof ApiError) {
          const errorData = e.data as { error?: string } | null;
          if (e.status === 400 && errorData?.error === "Article already in collection") {
            msg = "이미 모음에 전송된 글입니다.";
          } else if (e.status === 409 && errorData?.error === "Today's greeting was already sent") {
            msg = "이미 오늘의 인사를 보낸 모임입니다.";
          }
        }
        Alert.alert("오류", msg);
      }
    },
    [
      selectedArticle,
      selectedRecipient,
      userId,
      neighbors,
      sendArticle,
      addToTeamCollection,
      deliveryInfo,
      queryClient,
      returnToId,
      showToast,
      onSent,
    ],
  );

  const isPending = sendArticle.isPending || addToTeamCollection.isPending;

  const openRecipientPicker = useCallback(() => {
    setPendingRecipient(selectedRecipient);
    if (selectedRecipient?.type === "collection") {
      setSegmentTab("collection");
    } else {
      setSegmentTab("neighbor");
    }
    setRecipientPickerVisible(true);
  }, [selectedRecipient]);

  const handleConfirmRecipient = useCallback(() => {
    setSelectedRecipient(pendingRecipient);
    setRecipientPickerVisible(false);
  }, [pendingRecipient]);

  const confirmDescription = useMemo(() => {
    if (!selectedArticle || !selectedRecipient) return "";
    const arrivalLine = `\n\n${formatDeliveryTime(deliveryInfo.visibleAt)}에 도착 예정`;
    if (selectedRecipient.type === "neighbor") {
      return `'${selectedArticle.title ?? ""}'을(를)\n${selectedRecipient.data.user?.nickname ?? ""}에게 보내시겠어요?${arrivalLine}`;
    }
    return `'${selectedArticle.title ?? ""}'을(를)\n'${selectedRecipient.data.name}' 모음에 보내시겠어요?${arrivalLine}`;
  }, [selectedArticle, selectedRecipient, deliveryInfo]);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>편지 선택</Text>
          <Pressable style={styles.selectButton} onPress={() => setLetterPickerVisible(true)}>
            <Feather
              name="file-text"
              size={18}
              color={selectedArticle ? Colors.zinc900 : Colors.zinc500}
            />
            <Text
              style={[styles.selectButtonText, selectedArticle && styles.selectButtonTextActive]}
            >
              {selectedArticle?.title ?? "보낼 편지를 선택하세요"}
            </Text>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>받는 사람/모음</Text>
          <Pressable style={styles.selectButton} onPress={openRecipientPicker}>
            <Feather
              name={selectedRecipient?.type === "collection" ? "users" : "user"}
              size={18}
              color={selectedRecipient ? Colors.zinc900 : Colors.zinc500}
            />
            <Text
              style={[styles.selectButtonText, selectedRecipient && styles.selectButtonTextActive]}
            >
              {recipientDisplayName ?? "받는 사람/모음을 선택하세요"}
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

      <View style={[styles.footer, { paddingBottom: navBottom }]}>
        <SubmitButton
          style={styles.sendButton}
          disabledStyle={styles.sendButtonDisabled}
          textStyle={styles.sendButtonText}
          disabledTextStyle={styles.sendButtonTextDisabled}
          onPress={() => {
            if (canOfferTodayGreeting) {
              setNoticePromptVisible(true);
            } else {
              setConfirmVisible(true);
            }
          }}
          pending={isPending || greetingStatusLoading}
          disabled={!canSend || greetingStatusLoading}
          label="보내기"
          pendingLabel={greetingStatusLoading ? "확인 중..." : "처리 중..."}
          renderIcon={({ disabled }) => (
            <Feather name="send" size={16} color={disabled ? Colors.zinc400 : Colors.white} />
          )}
        />
      </View>

      <BottomSheet
        visible={letterPickerVisible}
        onClose={() => setLetterPickerVisible(false)}
        title="편지 선택"
        snapPoints={[0.85]}
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
          <ScrollView nestedScrollEnabled style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
            {articles.map((article) => (
              <Pressable
                key={article.id}
                style={[
                  styles.pickerItem,
                  selectedArticle?.id === article.id && styles.pickerItemSelected,
                ]}
                onPress={() => {
                  setSelectedArticle(article);
                  setLetterPickerVisible(false);
                }}
              >
                <Text style={styles.pickerItemTitle} numberOfLines={1}>
                  {article.title || "제목 없음"}
                </Text>
                {article.content && (
                  <Text style={styles.pickerItemSub} numberOfLines={1}>
                    {article.content.substring(0, 60)}
                  </Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </BottomSheet>

      <BottomSheet
        visible={recipientPickerVisible}
        onClose={() => setRecipientPickerVisible(false)}
        title="받는 사람/모음 선택"
        snapPoints={[0.85]}
      >
        <View style={styles.segmentRow}>
          <Pressable
            style={[styles.segmentButton, segmentTab === "neighbor" && styles.segmentButtonActive]}
            onPress={() => setSegmentTab("neighbor")}
          >
            <Text
              style={[
                styles.segmentButtonText,
                segmentTab === "neighbor" && styles.segmentButtonTextActive,
              ]}
            >
              이웃
            </Text>
          </Pressable>
          <Pressable
            style={[styles.segmentButton, segmentTab === "collection" && styles.segmentButtonActive]}
            onPress={() => setSegmentTab("collection")}
          >
            <Text
              style={[
                styles.segmentButtonText,
                segmentTab === "collection" && styles.segmentButtonTextActive,
              ]}
            >
              모음
            </Text>
          </Pressable>
        </View>

        <View style={styles.recipientListArea}>
          {segmentTab === "neighbor" ? (
            neighborsQuery.isLoading ? (
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
              <ScrollView nestedScrollEnabled style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
                {neighbors.map((neighbor) => {
                  const isSelected =
                    pendingRecipient?.type === "neighbor" &&
                    pendingRecipient.data.id === neighbor.id;
                  return (
                    <Pressable
                      key={neighbor.id}
                      style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                      onPress={() => setPendingRecipient({ type: "neighbor", data: neighbor })}
                    >
                      <View style={styles.pickerNeighborRow}>
                        <View style={styles.pickerAvatar}>
                          <Feather name="user" size={16} color={Colors.zinc500} />
                        </View>
                        <View style={styles.pickerNeighborInfo}>
                          <Text style={styles.pickerItemTitle}>
                            {neighbor.user?.nickname ?? "이름 없음"}
                          </Text>
                          <Text style={styles.pickerItemSub}>{neighbor.user?.email ?? ""}</Text>
                        </View>
                        {isSelected && <Feather name="check" size={18} color={Colors.zinc900} />}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )
          ) : teamCollectionsQuery.isLoading ? (
            <View style={styles.pickerEmpty}>
              <Text style={styles.pickerEmptySub}>불러오는 중...</Text>
            </View>
          ) : teamCollectionsQuery.isError ? (
            <View style={styles.pickerEmpty}>
              <Feather name="alert-circle" size={32} color={Colors.zinc300} />
              <Text style={styles.pickerEmptyTitle}>불러오기 실패</Text>
              <Pressable onPress={() => teamCollectionsQuery.refetch()}>
                <Text style={[styles.pickerEmptySub, { color: Colors.zinc900 }]}>다시 시도</Text>
              </Pressable>
            </View>
          ) : teamCollections.length === 0 ? (
            <View style={styles.pickerEmpty}>
              <Feather name="users" size={32} color={Colors.zinc300} />
              <Text style={styles.pickerEmptyTitle}>단체 모음이 없어요</Text>
              <Text style={styles.pickerEmptySub}>단체 모음을 먼저 만들어주세요</Text>
            </View>
          ) : (
            <ScrollView nestedScrollEnabled style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {teamCollections.map((col) => {
                const isSelected =
                  pendingRecipient?.type === "collection" &&
                  pendingRecipient.data.id === col.id;
                return (
                  <Pressable
                    key={col.id}
                    style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                    onPress={() =>
                      setPendingRecipient({
                        type: "collection",
                        data: col,
                      })
                    }
                  >
                    <View style={styles.collectionRow}>
                      <View style={styles.collectionIcon}>
                        <Feather name="users" size={16} color={Colors.zinc500} />
                      </View>
                      <View style={styles.collectionInfo}>
                        <Text style={styles.pickerItemTitle} numberOfLines={1}>
                          {col.name}
                        </Text>
                        {col.description ? (
                          <Text style={styles.pickerItemSub} numberOfLines={1}>
                            {col.description}
                          </Text>
                        ) : null}
                      </View>
                      {isSelected && <Feather name="check" size={18} color={Colors.zinc900} />}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        <Pressable
          style={[
            styles.confirmPickerButton,
            !pendingRecipient && styles.confirmPickerButtonDisabled,
          ]}
          disabled={!pendingRecipient}
          onPress={handleConfirmRecipient}
        >
          <Text
            style={[
              styles.confirmPickerButtonText,
              !pendingRecipient && styles.confirmPickerButtonTextDisabled,
            ]}
          >
            선택 완료
          </Text>
        </Pressable>
      </BottomSheet>

      <ConfirmModal
        visible={confirmVisible}
        title="보내기"
        description={confirmDescription}
        confirmLabel="보내기"
        cancelLabel="취소"
        onConfirm={() => handleSend(false)}
        onCancel={() => setConfirmVisible(false)}
      />

      <ConfirmModal
        visible={noticePromptVisible}
        title={`이 글을 ${noticeDateLabel} <오늘의 인사>로\n설정하시겠습니까?`}
        description={"(수신자의 수신함 맨 앞에 표시됩니다.)"}
        confirmLabel="예"
        cancelLabel="아니오"
        onConfirm={() => handleSend(true)}
        onCancel={() => {
          setNoticePromptVisible(false);
          handleSend(false);
        }}
        onBackdropPress={() => setNoticePromptVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
    paddingBottom: 24,
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
    paddingBottom: Spacing.navBarPaddingBottom,
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
  segmentRow: {
    flexDirection: "row",
    backgroundColor: Colors.zinc100,
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  segmentButtonActive: {
    backgroundColor: Colors.white,
  },
  segmentButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc500,
  },
  segmentButtonTextActive: {
    color: Colors.zinc900,
  },
  recipientListArea: {
    flex: 1,
  },
  collectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  collectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionInfo: {
    flex: 1,
    gap: 2,
  },
  confirmPickerButton: {
    marginTop: 12,
    marginBottom: 16,
    paddingVertical: 16,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    alignItems: "center",
  },
  confirmPickerButtonDisabled: {
    backgroundColor: Colors.zinc100,
  },
  confirmPickerButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  confirmPickerButtonTextDisabled: {
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
