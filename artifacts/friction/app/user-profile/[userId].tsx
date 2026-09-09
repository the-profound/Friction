import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import ConfirmModal from "@/components/ConfirmModal/ConfirmModal";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CanonicalCardSlot from "@/components/ArticleCardItem/CanonicalCardSlot";
import { useLetterSelectionOverlay } from "@/hooks/useLetterSelectionOverlay";
import { profileArticleToViewModel } from "@/hooks/useProfileLetterCards";
import { Colors, Spacing, Typography, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useToast } from "@/contexts/ToastContext";
import { useUser } from "@/contexts/UserContext";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  useGetUser,
  useListArticles,
  useListSpaces,
  useListSendRecords,
  useListNeighbors,
  useListNeighborRequests,
  useCreateNeighborRequest,
  useDeleteNeighborRequest,
  useRemoveNeighbor,
  useListUserSpaceLetters,
  getListUserSpaceLettersQueryKey,
  SpaceLetterVisibility,
} from "@workspace/api-client-react";
import type {
  Article,
  SpaceListItem,
  SendRecordWithDetails,
  NeighborWithUser,
  NeighborRequestWithUser,
  SpaceLetter,
} from "@workspace/api-client-react";
import { spaceStatusLabel, spaceStatusStyle } from "@/lib/spaceStatusStyle";
import { useSelectionScrollRestoration } from "@/hooks/useSelectionScrollRestoration";
import {
  buildSentLetterSourceMetadataByArticleId,
  isSpaceSendRecord,
  shouldDisplaySentLetter,
} from "@/lib/sentLetterVisibility";

type ProfileTab = "letters" | "publications" | "spaces";

// Row types for the unified FlatList (avoids numColumns changes and header remount)
type LetterRowData = { _type: "lr"; items: Article[] };
type SpaceRowData = { _type: "sp"; item: SpaceListItem };
type ProfileListRow = LetterRowData | SpaceRowData;

const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
  { key: "letters", label: "편지" },
  { key: "publications", label: "간행물" },
  { key: "spaces", label: "공간" },
];

const GRID_PAD = 12;
const GRID_GAP = 4;
const GRID_COLS = 3;

// hint: Logic changed on both sides. Requires understanding intent of each change.
export default function UserProfileScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId: currentUserId } = useUser();
  const { showToast } = useToast();
  const { userId: profileUserId } = useLocalSearchParams<{ userId: string }>();
  const queryClient = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();

  const [profileTab, setProfileTab] = useState<ProfileTab>("letters");
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  const isOwnProfile =
    currentUserId != null && currentUserId === profileUserId;

  const cancelScrollRestorationRef = useRef<() => void>(() => {});
  const {
    isOverlayActive,
    isSourceHidden,
    openLetterOverlay,
    renderLetterOverlay,
  } = useLetterSelectionOverlay(currentUserId, {
    onBeforeRead: () => cancelScrollRestorationRef.current(),
  });

  const userQuery = useGetUser(profileUserId ?? "");
  const articlesQuery = useListArticles({ authorId: profileUserId });
  const spacesQuery = useListSpaces({ userId: profileUserId });
  const sendRecordsQuery = useListSendRecords({ senderId: profileUserId });
  const neighborsQuery = useListNeighbors({ userId: currentUserId });
  const sentRequestsQuery = useListNeighborRequests({ requesterId: currentUserId });
  // Fetch PUBLIC space letters for this profile user to filter out RECIPIENT_ONLY
  // letters from the letter grid. Task 1 made the server filter them, but we also
  // cross-reference here so cache invalidation after a visibility change in on.tsx
  // immediately refreshes this tab too.
  const profileSpaceLettersQuery = useListUserSpaceLetters(profileUserId ?? "", {
    query: {
      queryKey: getListUserSpaceLettersQueryKey(profileUserId ?? ""),
      enabled: Boolean(profileUserId),
    },
  });

  const createNeighborRequest = useCreateNeighborRequest();
  const deleteNeighborRequest = useDeleteNeighborRequest();
  const removeNeighbor = useRemoveNeighbor();
  const [optimisticPending, setOptimisticPending] = useState(false);
  const [cancelConfirmVisible, setCancelConfirmVisible] = useState(false);

  const refetchArticles = articlesQuery.refetch;
  const refetchSpaces = spacesQuery.refetch;
  const refetchSendRecords = sendRecordsQuery.refetch;
  const refetchNeighbors = neighborsQuery.refetch;
  const refetchSentRequests = sentRequestsQuery.refetch;
  const refetchProfileSpaceLetters = profileSpaceLettersQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      refetchArticles();
      refetchSpaces();
      refetchSendRecords();
      refetchNeighbors();
      refetchSentRequests();
      refetchProfileSpaceLetters();
    }, [refetchArticles, refetchSpaces, refetchSendRecords, refetchNeighbors, refetchSentRequests, refetchProfileSpaceLetters]),
  );

  const sendRecordByArticleId = useMemo(
    () =>
      buildSentLetterSourceMetadataByArticleId(
        (sendRecordsQuery.data ?? []) as SendRecordWithDetails[],
      ),
    [sendRecordsQuery.data],
  );

  const user = userQuery.data;
  const displayName = user?.nickname?.trim() || "이름 없음";
  const handle = user?.nickname?.trim() ? `@${user.nickname.trim()}` : "";

  // Map from sourceArticleId → visibility for all space letters returned for
  // this profile user. The server returns ALL visibility levels when the
  // authenticated user is the profile owner, so we must check visibility here
  // rather than trusting that the set is already filtered to PUBLIC only.
  const spaceLetterVisibilityById = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const sl of (profileSpaceLettersQuery.data ?? []) as SpaceLetter[]) {
      if (!sl.sourceArticleId) continue;
      // PUBLIC wins: a letter sent to multiple spaces is shown in the profile
      // as long as at least one of its space_letters is PUBLIC.
      if (!map.has(sl.sourceArticleId) || sl.visibility === SpaceLetterVisibility.PUBLIC) {
        map.set(sl.sourceArticleId, sl.visibility);
      }
    }
    return map;
  }, [profileSpaceLettersQuery.data]);

  const nonSpaceSentArticleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of (sendRecordsQuery.data ?? []) as SendRecordWithDetails[]) {
      if (!isSpaceSendRecord(record)) ids.add(record.articleId);
    }
    return ids;
  }, [sendRecordsQuery.data]);

  const letters = useMemo<Article[]>(() => {
    const list = ((articlesQuery.data ?? []) as Article[]).filter((a) => {
      if (a.status !== "LETTER") return false;
      if (sendRecordByArticleId[a.id] === undefined) return false;
      const visibility = spaceLetterVisibilityById.get(a.id);
      return shouldDisplaySentLetter(
        nonSpaceSentArticleIds.has(a.id),
        visibility,
      );
    });
    return [...list].sort((a, b) => {
      const slotA = sendRecordByArticleId[a.id]?.deliverySlot ?? "";
      const slotB = sendRecordByArticleId[b.id]?.deliverySlot ?? "";
      return slotB.localeCompare(slotA);
    });
  }, [articlesQuery.data, nonSpaceSentArticleIds, sendRecordByArticleId, spaceLetterVisibilityById]);

  const spaces = useMemo<SpaceListItem[]>(() => {
    return ((spacesQuery.data ?? []) as SpaceListItem[]).filter(
      (s) => s.status !== "ARCHIVED",
    );
  }, [spacesQuery.data]);

  // ── Neighbor relationship state ───────────────────────────────────────────
  const existingNeighbor = useMemo<NeighborWithUser | null>(() => {
    const list = (neighborsQuery.data ?? []) as NeighborWithUser[];
    return list.find((n) => n.neighborUserId === profileUserId) ?? null;
  }, [neighborsQuery.data, profileUserId]);

  const isNeighbor = !!existingNeighbor;

  const isPending = useMemo(() => {
    if (optimisticPending) return true;
    const list = (sentRequestsQuery.data ?? []) as NeighborRequestWithUser[];
    return list.some((r) => r.recipientId === profileUserId);
  }, [sentRequestsQuery.data, profileUserId, optimisticPending]);

  const pendingRequestId = useMemo<string | null>(() => {
    const list = (sentRequestsQuery.data ?? []) as NeighborRequestWithUser[];
    return list.find((r) => r.recipientId === profileUserId)?.id ?? null;
  }, [sentRequestsQuery.data, profileUserId]);

  useEffect(() => {
    // Clear the optimistic flag once the server-side request is confirmed
    // (so we don't keep showing pending after the relationship resolves).
    if (!optimisticPending) return;
    const list = (sentRequestsQuery.data ?? []) as NeighborRequestWithUser[];
    if (list.some((r) => r.recipientId === profileUserId) || existingNeighbor) {
      setOptimisticPending(false);
    }
  }, [sentRequestsQuery.data, profileUserId, existingNeighbor, optimisticPending]);

  const handleSendNeighborRequest = useCallback(async () => {
    if (!profileUserId || createNeighborRequest.isPending) return;
    setOptimisticPending(true);
    try {
      await createNeighborRequest.mutateAsync({
        data: { requesterId: currentUserId, recipientId: profileUserId },
      });
      sentRequestsQuery.refetch();
      showToast({ message: "이웃 요청을 보냈어요!", type: "success" });
    } catch (e: unknown) {
      const isDuplicate =
        e instanceof ApiError &&
        typeof e.data === "object" &&
        e.data !== null &&
        "error" in e.data &&
        ((e.data as { error?: string }).error === "Already neighbors" ||
          (e.data as { error?: string }).error === "Request already exists");
      if (isDuplicate) {
        sentRequestsQuery.refetch();
        neighborsQuery.refetch();
      } else {
        setOptimisticPending(false);
        const msg = e instanceof Error ? e.message : "요청에 실패했습니다.";
        showToast({ message: msg, type: "error" });
      }
    }
  }, [profileUserId, currentUserId, createNeighborRequest, sentRequestsQuery, neighborsQuery, showToast]);

  const handleCancelNeighborRequest = useCallback(async () => {
    if (!pendingRequestId || deleteNeighborRequest.isPending) return;
    setCancelConfirmVisible(false);
    try {
      await deleteNeighborRequest.mutateAsync({ id: pendingRequestId });
      setOptimisticPending(false);
      sentRequestsQuery.refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "취소에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    }
  }, [pendingRequestId, deleteNeighborRequest, sentRequestsQuery, showToast]);

  const handleRemoveNeighborConfirm = useCallback(async () => {
    if (!existingNeighbor || removeNeighbor.isPending) return;
    setRemoveConfirmVisible(false);
    try {
      await removeNeighbor.mutateAsync({ id: existingNeighbor.id });
      neighborsQuery.refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "삭제에 실패했습니다.";
      showToast({ message: msg, type: "error" });
    }
  }, [existingNeighbor, removeNeighbor, neighborsQuery, showToast]);

  const handleSendLetter = useCallback(() => {
    if (!profileUserId) return;
    router.push({ pathname: "/to-send", params: { neighborId: profileUserId } });
  }, [router, profileUserId]);

  const cellWidth = Math.floor(
    (windowWidth - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS,
  );

  const cellHeight = cellWidth * Sizing.cardRatio;

  const cardSlotRefs = useRef<Map<string, View | null>>(new Map());
  const profileListRef = useRef<FlatList<ProfileListRow>>(null);
  const restoreProfileScrollOffset = useCallback((offset: number) => {
    profileListRef.current?.scrollToOffset({ offset, animated: false });
  }, []);
  const {
    handleScroll: handleSelectionScroll,
    captureScrollOffset,
    cancelScrollRestoration,
  } = useSelectionScrollRestoration(
    isOverlayActive,
    restoreProfileScrollOffset,
  );
  // Keep the ref current so the hook's onBeforeRead fires with the latest function.
  cancelScrollRestorationRef.current = cancelScrollRestoration;

  const handleLetterPress = useCallback(
    (article: Article) => {
      captureScrollOffset();
      const rec = sendRecordByArticleId[article.id];
      const slotRef = cardSlotRefs.current.get(article.id);
      openLetterOverlay(article, {
        meta: {
          collectionName: rec?.name ?? null,
          collectionId: rec?.collectionId ?? null,
          spaceId: rec?.spaceId ?? null,
          date: rec?.deliverySlot ?? null,
        },
        measureRef: slotRef ?? null,
        fallbackOrigin: { x: 0, y: 0, width: cellWidth, height: cellHeight },
        currentAuthorId: profileUserId,
      });
    },
    [cellWidth, cellHeight, sendRecordByArticleId, captureScrollOffset, openLetterOverlay, profileUserId],
  );

  const handleSpacePress = useCallback(
    (space: SpaceListItem) => {
      router.push({ pathname: "/of-space-detail" as never, params: { id: space.id } });
    },
    [router],
  );


  const renderEmpty = useCallback(
    (message: string, subtitle?: string) => {
      const loading =
        (profileTab === "letters" && articlesQuery.isLoading) ||
        (profileTab === "spaces" && spacesQuery.isLoading);
      if (loading) {
        return (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>불러오는 중...</Text>
          </View>
        );
      }
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{message}</Text>
          {subtitle ? <Text style={styles.emptyText}>{subtitle}</Text> : null}
        </View>
      );
    },
    [profileTab, articlesQuery.isLoading, spacesQuery.isLoading],
  );

  const contentPadding = useMemo(
    () => ({ paddingTop: 8, paddingBottom: navBottom + 24 }),
    [navBottom],
  );

  // Build a flat data array for the single unified FlatList.
  // Letters are chunked into rows of GRID_COLS so we never need to change
  // numColumns (which would force a FlatList remount and header flicker).
  const listData = useMemo<ProfileListRow[]>(() => {
    if (profileTab === "letters") {
      const rows: LetterRowData[] = [];
      for (let i = 0; i < letters.length; i += GRID_COLS) {
        rows.push({ _type: "lr", items: letters.slice(i, i + GRID_COLS) });
      }
      return rows;
    }
    if (profileTab === "spaces") {
      return spaces.map((item) => ({ _type: "sp" as const, item }));
    }
    return [];
  }, [profileTab, letters, spaces]);

  const renderRow = useCallback(
    ({ item }: { item: ProfileListRow }) => {
      if (item._type === "lr") {
        return (
          <View style={styles.gridRow}>
            {item.items.map((article) => {
              const isHidden = isSourceHidden(article.id);
              // ViewModel separates spaceName from collectionName; send-record
              // name takes priority as the user-visible folder label.
              const vm = profileArticleToViewModel(article);
              const collectionName = sendRecordByArticleId[article.id]?.name ?? vm.collectionName;
              return (
                <View
                  key={article.id}
                  ref={(ref) => {
                    cardSlotRefs.current.set(article.id, ref);
                  }}
                  style={[
                    styles.gridCell,
                    { width: cellWidth, opacity: isHidden ? 0 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={article.title || "제목 없음"}
                >
                  <CanonicalCardSlot width={cellWidth} height={cellHeight}>
                    <ArticleCardItem
                      title={vm.article?.title ?? "제목 없음"}
                      authorName={vm.authorName ?? undefined}
                      collectionName={collectionName}
                      spaceName={vm.spaceName}
                      cover={vm.cover ?? undefined}
                      visibility="PUBLIC"
                      isActive
                      onPress={() => handleLetterPress(article)}
                    />
                  </CanonicalCardSlot>
                </View>
              );
            })}
            {/* Filler views keep the last incomplete row left-aligned */}
            {Array.from({ length: GRID_COLS - item.items.length }).map(
              (_, i) => (
                <View key={`filler-${i}`} style={{ width: cellWidth }} />
              ),
            )}
          </View>
        );
      }
      // Space row
      const space = item.item;
      const statusStyle = spaceStatusStyle(space.status);
      const statusText = spaceStatusLabel(space.status);
      return (
        <ScalePressable
          style={styles.groupRow}
          contentStyle={styles.groupRowContent}
          onPress={() => handleSpacePress(space)}
          accessibilityRole="button"
          accessibilityLabel={space.name}
        >
          <View style={styles.groupIcon}>
            <Feather name="layers" size={20} color={Colors.zinc500} />
          </View>
          <View style={styles.groupTextWrap}>
            <Text style={styles.groupTitle} numberOfLines={1}>
              {space.name}
            </Text>
            <Text style={styles.groupMeta} numberOfLines={1}>
              참여자 {space.participantCount}명
            </Text>
          </View>
          <View
            style={[
              styles.groupTag,
              {
                backgroundColor: statusStyle.backgroundColor,
                borderColor: statusStyle.borderColor,
                borderWidth: statusStyle.borderWidth,
              },
            ]}
          >
            <Text
              style={[styles.groupTagText, { color: statusStyle.textColor }]}
            >
              {statusText}
            </Text>
          </View>
        </ScalePressable>
      );
    },
    [
      isSourceHidden,
      sendRecordByArticleId,
      cellWidth,
      cellHeight,
      user?.nickname,
      handleLetterPress,
      handleSpacePress,
    ],
  );

  const listEmpty =
    profileTab === "letters"
      ? renderEmpty("아직 보낸 편지가 없어요")
      : profileTab === "spaces"
        ? renderEmpty("참여 중인 공간이 없어요")
        : renderEmpty("아직 비어있어요", "간행물 기능은 곧 만나볼 수 있어요");

  // Shared back-button header JSX used in both the error state and the FlatList
  const navHeaderJsx = (
    <View style={styles.header}>
      <HeaderButton
        variant="back"
        onPress={() => router.back()}
        accessibilityLabel="사용자 프로필에서 돌아가기"
      />
      {isOwnProfile ? (
        <HeaderButton
          variant="menu"
          onPress={() => setMenuVisible(true)}
          accessibilityLabel="프로필 메뉴 열기"
        />
      ) : (
        <View style={{ width: Sizing.headerButtonTouchSize, height: Sizing.headerButtonTouchSize }} />
      )}
    </View>
  );

  if (!profileUserId) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {navHeaderJsx}
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>사용자를 찾을 수 없어요</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={profileListRef}
        data={listData as ProfileListRow[]}
        keyExtractor={(item, index) => {
          if (item._type === "lr") return `lr-${item.items[0]?.id ?? index}`;
          return `sp-${item.item.id}`;
        }}
        renderItem={renderRow}
        ListHeaderComponent={
          <View>
            {/* Top safe-area padding lives here so the background colour
                shows behind the notch while content still scrolls under it */}
            <View style={{ paddingTop: insets.top }}>
              {navHeaderJsx}
            </View>

            <View style={styles.profileSection}>
              {user?.avatarUrl ? (
                <Image
                  source={{ uri: user.avatarUrl }}
                  style={styles.avatar}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Feather name="user" size={34} color={Colors.zinc500} />
                </View>
              )}
              <Text style={styles.profileName} numberOfLines={1}>
                {displayName}
              </Text>
              {handle ? (
                <Text style={styles.profileHandle} numberOfLines={1}>
                  {handle}
                </Text>
              ) : null}
            </View>

            <View style={styles.actionRow}>
              {isNeighbor ? (
                <ScalePressable
                  style={styles.actionButton}
                  contentStyle={styles.actionButtonContent}
                  onPress={() => setRemoveConfirmVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="이웃 맺음"
                >
                  <Text style={styles.actionButtonText}>이웃 맺음</Text>
                </ScalePressable>
              ) : isPending ? (
                <ScalePressable
                  style={styles.actionButton}
                  contentStyle={styles.actionButtonContent}
                  onPress={() => setCancelConfirmVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="이웃 신청 취소"
                >
                  <Text style={styles.actionButtonText}>이웃 신청 취소</Text>
                </ScalePressable>
              ) : (
                <ScalePressable
                  style={styles.actionButton}
                  contentStyle={styles.actionButtonContent}
                  onPress={handleSendNeighborRequest}
                  disabled={createNeighborRequest.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="이웃 신청"
                >
                  <Text style={styles.actionButtonText}>이웃 신청</Text>
                </ScalePressable>
              )}
              <ScalePressable
                style={styles.actionButton}
                contentStyle={styles.actionButtonContent}
                onPress={handleSendLetter}
                accessibilityRole="button"
                accessibilityLabel="편지 발신"
              >
                <Text style={styles.actionButtonText}>편지 발신</Text>
              </ScalePressable>
            </View>

            <View style={styles.subTabBar}>
              {PROFILE_TABS.map((t) => {
                const active = profileTab === t.key;
                return (
                  <ScalePressable
                    key={t.key}
                    style={styles.subTabItem}
                    contentStyle={styles.subTabItemContent}
                    onPress={() => setProfileTab(t.key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.subTabText,
                        active && styles.subTabTextActive,
                      ]}
                      allowFontScaling={false}
                    >
                      {t.label}
                    </Text>
                    <View
                      style={[
                        styles.subTabUnderline,
                        active && styles.subTabUnderlineActive,
                      ]}
                    />
                  </ScalePressable>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={listEmpty}
        contentContainerStyle={contentPadding}
        showsVerticalScrollIndicator={false}
        onScroll={handleSelectionScroll}
        scrollEventThrottle={16}
        scrollEnabled={!isOverlayActive}
      />

      {renderLetterOverlay()}

      {/* Hamburger menu — own profile only */}
      <BottomSheet
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        snapPoints={[0.32]}
      >
        <View style={styles.menuContainer}>
          <Text style={styles.menuSectionLabel}>활동</Text>
          <ScalePressable
            style={styles.menuItem}
            contentStyle={styles.menuItemContent}
            onPress={() => {
              setMenuVisible(false);
              router.push("/user-profile/recipient-only-letters" as never);
            }}
          >
            <Feather name="eye-off" size={18} color={Colors.zinc600} />
            <Text style={styles.menuItemText}>수신자만 볼 수 있는 편지</Text>
            <Feather name="chevron-right" size={16} color={Colors.zinc400} />
          </ScalePressable>
        </View>
      </BottomSheet>

      <ConfirmModal
        visible={removeConfirmVisible}
        title="이웃 삭제"
        description={`'${displayName}'님과의 이웃 관계를 해제하시겠어요?`}
        confirmLabel="해제"
        cancelLabel="취소"
        destructive
        onConfirm={handleRemoveNeighborConfirm}
        onCancel={() => setRemoveConfirmVisible(false)}
      />
      <ConfirmModal
        visible={cancelConfirmVisible}
        title="이웃 신청 취소"
        description="이웃 신청을 취소할까요?"
        confirmLabel="취소하기"
        cancelLabel="돌아가기"
        onConfirm={handleCancelNeighborRequest}
        onCancel={() => setCancelConfirmVisible(false)}
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
  profileSection: {
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 20,
  },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    marginBottom: 14,
    backgroundColor: Colors.zinc100,
  },
  avatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
    letterSpacing: -0.5,
  },
  profileHandle: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginTop: 4,
  },
  actionRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingBottom: 12,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    height: 38,
  },
  actionButtonDisabled: {
    backgroundColor: Colors.zinc50,
  },
  actionButtonContent: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc700,
    letterSpacing: -0.2,
  },
  subTabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
    paddingHorizontal: GRID_PAD,
    marginBottom: 8,
  },
  subTabItem: {
    flex: 1,
  },
  subTabItemContent: {
    alignItems: "center",
  },
  subTabText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    letterSpacing: -0.2,
    paddingVertical: 12,
  },
  subTabTextActive: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc900,
  },
  subTabUnderline: {
    height: 2,
    alignSelf: "stretch",
    backgroundColor: Colors.transparent,
    marginBottom: -1,
  },
  subTabUnderlineActive: {
    backgroundColor: Colors.zinc900,
  },
  gridContent: {
    paddingTop: 4,
  },
  gridRow: {
    flexDirection: "row",
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
    paddingHorizontal: GRID_PAD,
  },
  gridCell: {
    overflow: "hidden",
  },
  groupRow: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  groupRowContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  groupIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  groupTextWrap: {
    flex: 1,
    gap: 4,
  },
  groupTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
    letterSpacing: -0.3,
  },
  groupMeta: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  groupTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  groupTagOwner: {
    backgroundColor: Colors.noticeAccentSoft,
  },
  groupTagMember: {
    backgroundColor: Colors.zinc100,
  },
  groupTagText: {
    fontSize: 12,
    fontWeight: "600",
  },
  groupTagTextOwner: {
    color: Colors.noticeAccent,
  },
  groupTagTextMember: {
    color: Colors.zinc500,
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 80,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc500,
  },
  emptyText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 20,
  },
  menuContainer: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
    gap: 6,
  },
  menuSectionLabel: {
    ...Typography.caption,
    fontSize: 11,
    color: Colors.zinc400,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  menuItem: {
    borderRadius: 14,
  },
  menuItemContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 15,
    backgroundColor: Colors.zinc50,
    borderRadius: 14,
  },
  menuItemText: {
    flex: 1,
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc800,
    letterSpacing: -0.2,
  },
});
