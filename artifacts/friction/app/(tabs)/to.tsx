import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ScalePressable from "@/components/shared/ScalePressable";
import ArticleCardItem from "@/components/ArticleCardItem/ArticleCardItem";
import CardSelectOverlay from "@/components/CardSelectOverlay/CardSelectOverlay";
import { Colors, Spacing, Typography, Sizing } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useUser } from "@/contexts/UserContext";
import {
  useGetUser,
  useListArticles,
  useListTeamCollections,
  useListSendRecords,
} from "@workspace/api-client-react";
import type { Article, TeamCollectionWithRole, SendRecordWithDetails } from "@workspace/api-client-react";
import type { OriginLayout } from "@/components/CardSelectOverlay/CardSelectOverlay";

type MyTab = "letters" | "publications" | "groups";

const MY_TABS: { key: MyTab; label: string }[] = [
  { key: "letters", label: "편지" },
  { key: "publications", label: "간행물" },
  { key: "groups", label: "모임" },
];

const GRID_PAD = 12;
const GRID_GAP = 4;
const GRID_COLS = 3;

export default function MyScreen() {
  const insets = useSafeAreaInsets();
  const navBottom = useNavBarBottomSafeArea();
  const router = useRouter();
  const { userId } = useUser();
  const { width: windowWidth } = useWindowDimensions();

  const [myTab, setMyTab] = useState<MyTab>("letters");

  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedOrigin, setSelectedOrigin] = useState<OriginLayout | null>(null);
  const [selectedCollectionName, setSelectedCollectionName] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  const userQuery = useGetUser(userId);
  const articlesQuery = useListArticles({ authorId: userId });
  const teamsQuery = useListTeamCollections({ userId });
  const sendRecordsQuery = useListSendRecords({ senderId: userId });

  const refetchArticles = articlesQuery.refetch;
  const refetchTeams = teamsQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      refetchArticles();
      refetchTeams();
    }, [refetchArticles, refetchTeams]),
  );

  const collectionNameByArticleId = useMemo<Record<string, { name: string | null; id: string | null }>>(() => {
    const records = (sendRecordsQuery.data ?? []) as SendRecordWithDetails[];
    const map: Record<string, { name: string | null; id: string | null }> = {};
    for (const r of records) {
      if (r.articleId) {
        map[r.articleId] = { name: r.collectionName ?? null, id: r.collectionId ?? null };
      }
    }
    return map;
  }, [sendRecordsQuery.data]);

  const user = userQuery.data;
  const displayName = user?.nickname?.trim() || "이름 없음";
  const handle = user?.nickname?.trim() ? `@${user.nickname.trim()}` : "";

  const letters = useMemo<Article[]>(() => {
    const list = (articlesQuery.data ?? []).filter((a) => a.status === "LETTER");
    return [...list].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [articlesQuery.data]);

  const teams = useMemo<TeamCollectionWithRole[]>(() => {
    return (teamsQuery.data ?? []) as TeamCollectionWithRole[];
  }, [teamsQuery.data]);

  const cellWidth = Math.floor(
    (windowWidth - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS,
  );

  const cellHeight = Math.floor(cellWidth * Sizing.cardRatio);

  const cardSlotRefs = useRef<Map<string, View | null>>(new Map());

  const handleLetterPress = useCallback(
    (article: Article) => {
      const colEntry = collectionNameByArticleId[article.id] ?? null;
      const colName = colEntry?.name ?? null;
      const colId = colEntry?.id ?? null;
      const slotRef = cardSlotRefs.current.get(article.id);
      if (slotRef) {
        slotRef.measureInWindow((x, y, width, height) => {
          setSelectedOrigin({ x, y, width, height });
          setSelectedArticle(article);
          setSelectedCollectionName(colName);
          setSelectedCollectionId(colId);
        });
      } else {
        setSelectedOrigin({ x: 0, y: 0, width: cellWidth, height: cellHeight });
        setSelectedArticle(article);
        setSelectedCollectionName(colName);
        setSelectedCollectionId(colId);
      }
    },
    [cellWidth, cellHeight, collectionNameByArticleId],
  );

  const handleOverlayClose = useCallback(() => {
    setSelectedArticle(null);
    setSelectedOrigin(null);
    setSelectedCollectionName(null);
    setSelectedCollectionId(null);
  }, []);

  const handleNavigateToCollection = useCallback(
    (collectionId: string) => {
      router.push({ pathname: "/of-02-detail", params: { id: collectionId } });
    },
    [router],
  );

  const handleOverlayRead = useCallback(() => {
    if (!selectedArticle) return;
    const article = selectedArticle;
    setSelectedArticle(null);
    router.push({
      pathname: "/read" as never,
      params: { articleId: article.id, mode: "re_read" },
    });
  }, [selectedArticle, router]);

  const handleGroupPress = useCallback(
    (team: TeamCollectionWithRole) => {
      router.push({ pathname: "/of-02-detail", params: { id: team.id } });
    },
    [router],
  );

  const ListHeader = useMemo(
    () => (
      <View>
        <View style={styles.topBar}>
          <ScalePressable
            style={styles.settingsButton}
            contentStyle={styles.settingsButtonContent}
            onPress={() => router.push("/mypage" as never)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="설정 및 활동"
          >
            <Feather name="settings" size={22} color={Colors.zinc700} />
          </ScalePressable>
        </View>

        <View style={styles.profileSection}>
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={styles.avatar} />
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

        <View style={styles.neighborWrap}>
          <ScalePressable
            style={styles.neighborButton}
            contentStyle={styles.neighborButtonContent}
            onPress={() => router.push("/mypage-neighbors" as never)}
            accessibilityRole="button"
            accessibilityLabel="나의 이웃"
          >
            <Feather name="users" size={16} color={Colors.zinc700} />
            <Text style={styles.neighborButtonText}>나의 이웃</Text>
          </ScalePressable>
        </View>

        <View style={styles.subTabBar}>
          {MY_TABS.map((t) => {
            const active = myTab === t.key;
            return (
              <ScalePressable
                key={t.key}
                style={styles.subTabItem}
                contentStyle={styles.subTabItemContent}
                onPress={() => setMyTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.subTabText, active && styles.subTabTextActive]}
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
    ),
    [user?.avatarUrl, displayName, handle, myTab, router],
  );

  const renderLetter = useCallback(
    ({ item }: { item: Article }) => {
      const isHidden = selectedArticle?.id === item.id;
      const itemCollectionName = collectionNameByArticleId[item.id]?.name ?? null;
      return (
        <View
          ref={(ref) => { cardSlotRefs.current.set(item.id, ref); }}
          style={[styles.gridCell, { width: cellWidth, opacity: isHidden ? 0 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={item.title || "제목 없음"}
        >
          <ArticleCardItem
            title={item.title || "제목 없음"}
            authorName={item.authorNickname ?? user?.nickname ?? undefined}
            collectionName={itemCollectionName}
            cover={item.cover}
            cardWidth={cellWidth}
            isActive
            onPress={() => handleLetterPress(item)}
          />
        </View>
      );
    },
    [cellWidth, handleLetterPress, selectedArticle?.id, collectionNameByArticleId, user?.nickname],
  );

  const renderGroup = useCallback(
    ({ item }: { item: TeamCollectionWithRole }) => (
      <ScalePressable
        style={styles.groupRow}
        contentStyle={styles.groupRowContent}
        onPress={() => handleGroupPress(item)}
        accessibilityRole="button"
        accessibilityLabel={item.name}
      >
        <View style={styles.groupIcon}>
          <Feather name="share-2" size={20} color={Colors.zinc500} />
        </View>
        <View style={styles.groupTextWrap}>
          <Text style={styles.groupTitle} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.groupMeta} numberOfLines={1}>
            참여자 {item.memberCount ?? 0}명
          </Text>
        </View>
        <View
          style={[
            styles.groupTag,
            item.role === "OWNER" ? styles.groupTagOwner : styles.groupTagMember,
          ]}
        >
          <Text
            style={[
              styles.groupTagText,
              item.role === "OWNER"
                ? styles.groupTagTextOwner
                : styles.groupTagTextMember,
            ]}
          >
            {item.role === "OWNER" ? "소유자" : "멤버"}
          </Text>
        </View>
      </ScalePressable>
    ),
    [handleGroupPress],
  );

  const renderEmpty = useCallback(
    (message: string, subtitle?: string) => {
      const loading =
        (myTab === "letters" && articlesQuery.isLoading) ||
        (myTab === "groups" && teamsQuery.isLoading);
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
    [myTab, articlesQuery.isLoading, teamsQuery.isLoading],
  );

  const contentPadding = { paddingBottom: navBottom + 24 };

  if (myTab === "letters") {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <FlatList
          key="my-letters"
          data={letters}
          keyExtractor={(item) => item.id}
          renderItem={renderLetter}
          numColumns={GRID_COLS}
          columnWrapperStyle={styles.gridRow}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={renderEmpty("아직 보낸 편지가 없어요")}
          contentContainerStyle={[styles.gridContent, contentPadding]}
          showsVerticalScrollIndicator={false}
        />
        <CardSelectOverlay
          article={selectedArticle}
          originLayout={selectedOrigin}
          onClose={handleOverlayClose}
          onRead={handleOverlayRead}
          authorNameOverride={selectedArticle?.authorNickname ?? user?.nickname ?? null}
          collectionNameOverride={selectedCollectionName}
          collectionIdOverride={selectedCollectionId}
          onNavigateToCollection={handleNavigateToCollection}
          dateOverride={selectedArticle?.letterAt ?? selectedArticle?.updatedAt ?? null}
        />
      </View>
    );
  }

  if (myTab === "groups") {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <FlatList
          key="my-groups"
          data={teams}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={renderEmpty(
            "참여 중인 모임이 없어요",
            "모임 탭에서 모임을 만들거나 참여해보세요",
          )}
          contentContainerStyle={contentPadding}
          showsVerticalScrollIndicator={false}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <FlatList
        key="my-publications"
        data={[]}
        keyExtractor={() => "none"}
        renderItem={null}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={renderEmpty(
          "아직 비어있어요",
          "간행물 기능은 곧 만나볼 수 있어요",
        )}
        contentContainerStyle={contentPadding}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
    height: 44,
  },
  settingsButton: {
    width: 36,
    height: 36,
  },
  settingsButtonContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  profileSection: {
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 24,
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
    color: Colors.zinc400,
    marginTop: 4,
  },
  neighborWrap: {
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: 20,
  },
  neighborButton: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.zinc200,
    backgroundColor: Colors.white,
  },
  neighborButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  neighborButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc700,
    letterSpacing: -0.2,
  },
  subTabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
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
    color: Colors.zinc400,
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
    paddingHorizontal: GRID_PAD,
    paddingTop: 12,
  },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  gridCell: {
    overflow: "hidden",
  },
  groupRow: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.zinc100,
  },
  groupRowContent: {
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
    color: Colors.zinc400,
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
    fontSize: 11,
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
    color: Colors.zinc400,
    textAlign: "center",
    lineHeight: 20,
  },
});
