import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useNavigation } from "@/contexts/NavigationContext";

export default function OfScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ofSubTab } = useNavigation();

  const handleViewPersonal = useCallback(() => {
    router.push("/of-01");
  }, [router]);

  const handleViewGroup = useCallback(() => {
    router.push("/of-02");
  }, [router]);

  const handleViewSentence = useCallback(() => {
    router.push("/of-03");
  }, [router]);

  const [searchActive, setSearchActive] = useState(false);

  const handleAdd = useCallback(() => {
    switch (ofSubTab) {
      case "personal":
        router.push("/of-01");
        break;
      case "group":
        router.push("/of-02");
        break;
      case "sentence":
        router.push("/of-03");
        break;
    }
  }, [ofSubTab, router]);

  const handleSearch = useCallback(() => {
    setSearchActive((prev) => !prev);
  }, []);

  const renderContent = () => {
    switch (ofSubTab) {
      case "personal":
        return (
          <Pressable style={styles.emptyContainer} onPress={handleViewPersonal}>
            <Text style={styles.emptyTitle}>개인 모음</Text>
            <Text style={styles.emptySubtitle}>완성된 편지와 읽은 글을 모아두세요</Text>
            <Text style={styles.tapHint}>탭하여 모음 보기</Text>
          </Pressable>
        );
      case "group":
        return (
          <Pressable style={styles.emptyContainer} onPress={handleViewGroup}>
            <Text style={styles.emptyTitle}>단체 모음</Text>
            <Text style={styles.emptySubtitle}>함께 글을 나눌 모임에 참여하세요</Text>
            <Text style={styles.tapHint}>탭하여 모음 보기</Text>
          </Pressable>
        );
      case "sentence":
        return (
          <Pressable style={styles.emptyContainer} onPress={handleViewSentence}>
            <Text style={styles.emptyTitle}>문장 모음</Text>
            <Text style={styles.emptySubtitle}>읽으며 수집한 문장을 다시 만나보세요</Text>
            <Text style={styles.tapHint}>탭하여 모음 보기</Text>
          </Pressable>
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
      {renderContent()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    paddingBottom: Spacing.navBarPaddingBottom,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 18,
    color: Colors.zinc900,
    marginBottom: 8,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
  tapHint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
    marginTop: 16,
  },
});
