import React, { useCallback, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  RefreshControl,
  TextInput,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useNavigation } from "@/contexts/NavigationContext";
import { useUser } from "@/contexts/UserContext";
import {
  useListMyCollections,
  useListTeamCollections,
  useListStoredSentences,
  useCreateMyCollection,
  useCreateTeamCollection,
} from "@workspace/api-client-react";
import type {
  MyCollection,
  TeamCollectionWithRole,
  StoredSentence,
} from "@workspace/api-client-react";
import BottomSheet from "@/components/BottomSheet/BottomSheet";

export default function OfScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ofSubTab, ofMiniSubTab } = useNavigation();
  const { userId } = useUser();

  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const myCollectionsQuery = useListMyCollections({ ownerId: userId });
  const teamCollectionsQuery = useListTeamCollections({ userId });
  const sentencesQuery = useListStoredSentences({ userId });

  const createMyCollection = useCreateMyCollection();
  const createTeamCollection = useCreateTeamCollection();

  const myCollections = (myCollectionsQuery.data ?? []) as MyCollection[];
  const teamCollections = (teamCollectionsQuery.data ?? []) as TeamCollectionWithRole[];
  const sentences = (sentencesQuery.data ?? []) as StoredSentence[];

  const activeMiniPersonal = ofMiniSubTab.personal;
  const activeMiniGroup = ofMiniSubTab.group;

  const filteredMyCollections = useMemo(() => {
    let list = myCollections;
    if (activeMiniPersonal === "my") {
      list = myCollections.filter((c) => !c.isPublic);
    } else if (activeMiniPersonal === "subscribed") {
      list = myCollections.filter((c) => c.isPublic);
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [myCollections, searchQuery, activeMiniPersonal]);

  const filteredTeamCollections = useMemo(() => {
    let list = teamCollections;
    if (activeMiniGroup === "my") {
      list = teamCollections.filter((c) => c.role === "OWNER");
    } else if (activeMiniGroup === "joined") {
      list = teamCollections.filter((c) => c.role === "MEMBER");
    } else if (activeMiniGroup === "subscribed") {
      list = teamCollections.filter((c) => c.role !== "OWNER" && c.role !== "MEMBER");
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [teamCollections, searchQuery, activeMiniGroup]);

  const filteredSentences = useMemo(() => {
    if (!searchQuery.trim()) return sentences;
    const q = searchQuery.toLowerCase();
    return sentences.filter((s) => s.text.toLowerCase().includes(q));
  }, [sentences, searchQuery]);

  const handleSearch = useCallback(() => {
    setSearchActive((prev) => {
      if (prev) setSearchQuery("");
      return !prev;
    });
  }, []);

  const handleAdd = useCallback(() => {
    if (ofSubTab === "sentence") {
      Alert.alert("안내", "읽기 화면에서 문장을 길게 눌러 수집할 수 있어요.");
      return;
    }
    setNewName("");
    setNewDescription("");
    setCreateSheetVisible(true);
  }, [ofSubTab]);

  const handleCreateConfirm = useCallback(async () => {
    if (!newName.trim()) {
      Alert.alert("오류", "이름을 입력해주세요.");
      return;
    }
    try {
      if (ofSubTab === "personal") {
        await createMyCollection.mutateAsync({
          data: { ownerId: userId, name: newName.trim(), description: newDescription.trim() },
        });
        myCollectionsQuery.refetch();
      } else {
        await createTeamCollection.mutateAsync({
          data: { creatorId: userId, name: newName.trim(), description: newDescription.trim() },
        });
        teamCollectionsQuery.refetch();
      }
      setCreateSheetVisible(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "모음 생성에 실패했습니다.";
      Alert.alert("오류", msg);
    }
  }, [ofSubTab, newName, newDescription, userId, createMyCollection, createTeamCollection, myCollectionsQuery, teamCollectionsQuery]);

  const handleRefresh = useCallback(() => {
    if (ofSubTab === "personal") myCollectionsQuery.refetch();
    else if (ofSubTab === "group") teamCollectionsQuery.refetch();
    else sentencesQuery.refetch();
  }, [ofSubTab, myCollectionsQuery, teamCollectionsQuery, sentencesQuery]);

  const isRefetching =
    ofSubTab === "personal"
      ? myCollectionsQuery.isRefetching
      : ofSubTab === "group"
        ? teamCollectionsQuery.isRefetching
        : sentencesQuery.isRefetching;

  const isLoading =
    ofSubTab === "personal"
      ? myCollectionsQuery.isLoading
      : ofSubTab === "group"
        ? teamCollectionsQuery.isLoading
        : sentencesQuery.isLoading;

  const isError =
    ofSubTab === "personal"
      ? myCollectionsQuery.isError
      : ofSubTab === "group"
        ? teamCollectionsQuery.isError
        : sentencesQuery.isError;

  const renderPersonalItem = ({ item }: { item: MyCollection }) => (
    <Pressable
      style={styles.collectionCard}
      onPress={() => router.push({ pathname: "/of-01-detail", params: { id: item.id } })}
    >
      <View style={styles.collectionIcon}>
        <Feather name="folder" size={20} color={Colors.zinc500} />
      </View>
      <Text style={styles.collectionName} numberOfLines={1}>{item.name}</Text>
      <View style={styles.collectionMeta}>
        <Text style={styles.collectionCount}>{item.articleCount ?? 0}편</Text>
        {item.isPublic && <Feather name="globe" size={12} color={Colors.zinc400} />}
      </View>
    </Pressable>
  );

  const renderTeamItem = ({ item }: { item: TeamCollectionWithRole }) => (
    <Pressable
      style={styles.collectionCard}
      onPress={() => router.push({ pathname: "/of-02-detail", params: { id: item.id } })}
    >
      <View style={[styles.collectionIcon, { backgroundColor: "#EDE9FE" }]}>
        <Feather name="users" size={20} color="#7C3AED" />
      </View>
      <Text style={styles.collectionName} numberOfLines={1}>{item.name}</Text>
      <View style={styles.collectionMeta}>
        <Text style={styles.collectionCount}>{item.role === "OWNER" ? "소유자" : item.role === "MEMBER" ? "멤버" : "구독"}</Text>
      </View>
    </Pressable>
  );

  const renderSentenceItem = ({ item }: { item: StoredSentence }) => (
    <Pressable
      style={styles.sentenceItem}
      onPress={() => router.push({ pathname: "/of-03" })}
    >
      <Text style={styles.sentenceText} numberOfLines={2}>
        &ldquo;{item.text}&rdquo;
      </Text>
      <View style={styles.sentenceMeta}>
        <Text style={styles.sentenceDate}>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</Text>
        {item.isFavorite && <Feather name="star" size={12} color="#F59E0B" />}
      </View>
    </Pressable>
  );

  const renderEmptyPersonal = () => {
    if (activeMiniPersonal === "subscribed") {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="globe" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>공개 모음이 없어요</Text>
          <Text style={styles.emptySubtitle}>다른 사람과 공유할 공개 모음을 만들어보세요{"\n"}공개로 설정한 모음이 여기에 표시돼요</Text>
          <Pressable style={styles.emptyButton} onPress={handleAdd}>
            <Text style={styles.emptyButtonText}>새 모음 만들기</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Feather name="folder" size={40} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>내 모음이 없어요</Text>
        <Text style={styles.emptySubtitle}>완성된 편지를 모아두는 나만의 공간을 만들어보세요</Text>
        <Pressable style={styles.emptyButton} onPress={handleAdd}>
          <Text style={styles.emptyButtonText}>새 모음 만들기</Text>
        </Pressable>
      </View>
    );
  };

  const renderEmptyTeam = () => (
    <View style={styles.emptyContainer}>
      <Feather name="users" size={40} color={Colors.zinc300} />
      <Text style={styles.emptyTitle}>단체 모음이 없어요</Text>
      <Text style={styles.emptySubtitle}>함께 글을 나눌 모임을 만들어보세요</Text>
      <Pressable style={styles.emptyButton} onPress={handleAdd}>
        <Text style={styles.emptyButtonText}>새 단체 모음 만들기</Text>
      </Pressable>
    </View>
  );

  const renderEmptySentence = () => (
    <View style={styles.emptyContainer}>
      <Feather name="bookmark" size={40} color={Colors.zinc300} />
      <Text style={styles.emptyTitle}>수집한 문장이 없어요</Text>
      <Text style={styles.emptySubtitle}>읽기 화면에서 마음에 드는 문장을{"\n"}길게 눌러 수집해보세요</Text>
    </View>
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.loadingText}>불러오는 중...</Text>
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.emptyContainer}>
          <Feather name="alert-circle" size={40} color={Colors.zinc300} />
          <Text style={styles.emptyTitle}>불러오기에 실패했어요</Text>
          <Pressable style={styles.emptyButton} onPress={handleRefresh}>
            <Text style={styles.emptyButtonText}>다시 시도</Text>
          </Pressable>
        </View>
      );
    }

    switch (ofSubTab) {
      case "personal":
        return filteredMyCollections.length === 0 ? (
          renderEmptyPersonal()
        ) : (
          <FlatList
            data={filteredMyCollections}
            keyExtractor={(item) => item.id}
            renderItem={renderPersonalItem}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContent}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={Colors.zinc400} />}
            showsVerticalScrollIndicator={false}
          />
        );
      case "group":
        return filteredTeamCollections.length === 0 ? (
          renderEmptyTeam()
        ) : (
          <FlatList
            data={filteredTeamCollections}
            keyExtractor={(item) => item.id}
            renderItem={renderTeamItem}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContent}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={Colors.zinc400} />}
            showsVerticalScrollIndicator={false}
          />
        );
      case "sentence":
        return filteredSentences.length === 0 ? (
          renderEmptySentence()
        ) : (
          <FlatList
            data={filteredSentences}
            keyExtractor={(item) => item.id}
            renderItem={renderSentenceItem}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={Colors.zinc400} />}
            showsVerticalScrollIndicator={false}
          />
        );
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="보관함"
        showAdd
        onAddPress={handleAdd}
        showSearch
        onSearchPress={handleSearch}
        searchActive={searchActive}
      />

      {searchActive && (
        <View style={styles.searchBar}>
          <Feather name="search" size={16} color={Colors.zinc400} />
          <TextInput
            style={styles.searchInput}
            placeholder={
              ofSubTab === "personal"
                ? "모음 이름으로 검색"
                : ofSubTab === "group"
                  ? "단체 모음 이름으로 검색"
                  : "문장 내용으로 검색"
            }
            placeholderTextColor={Colors.zinc400}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Feather name="x" size={16} color={Colors.zinc400} />
            </Pressable>
          )}
        </View>
      )}

      {renderContent()}

      <BottomSheet
        visible={createSheetVisible}
        onClose={() => setCreateSheetVisible(false)}
        title={ofSubTab === "personal" ? "새 개인 모음" : "새 단체 모음"}
        snapPoints={[0.45]}
      >
        <View style={styles.createForm}>
          <TextInput
            style={styles.createInput}
            placeholder="모음 이름"
            placeholderTextColor={Colors.zinc400}
            value={newName}
            onChangeText={setNewName}
            autoFocus
          />
          <TextInput
            style={[styles.createInput, styles.createInputMulti]}
            placeholder="설명 (선택사항)"
            placeholderTextColor={Colors.zinc400}
            value={newDescription}
            onChangeText={setNewDescription}
            multiline
            textAlignVertical="top"
          />
          <Pressable
            style={[styles.createConfirmButton, !newName.trim() && styles.createConfirmDisabled]}
            onPress={handleCreateConfirm}
            disabled={!newName.trim()}
          >
            <Text style={styles.createConfirmText}>만들기</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.zinc50,
    marginHorizontal: Spacing.screenPx,
    borderRadius: 20,
    height: 40,
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc900,
    padding: 0,
  },
  gridContent: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 8,
    paddingBottom: Spacing.navBarPaddingBottom,
  },
  gridRow: {
    gap: 12,
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: Spacing.navBarPaddingBottom,
  },
  collectionCard: {
    flex: 1,
    backgroundColor: Colors.zinc50,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    maxWidth: "48%",
  },
  collectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionName: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  collectionMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  collectionCount: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
  },
  sentenceItem: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.screenPx,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  sentenceText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc700,
    fontStyle: "italic",
    lineHeight: 22,
  },
  sentenceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  sentenceDate: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: Spacing.navBarPaddingBottom,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    marginTop: 12,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
  },
  emptyButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
  },
  emptyButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.white,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
  },
  createForm: {
    paddingVertical: 12,
    gap: 12,
  },
  createInput: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc900,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  createInputMulti: {
    minHeight: 80,
    lineHeight: 22,
  },
  createConfirmButton: {
    backgroundColor: Colors.zinc900,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  createConfirmDisabled: {
    backgroundColor: Colors.zinc300,
  },
  createConfirmText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
});
