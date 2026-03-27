import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import ArticleListItem from "@/components/ArticleListItem/ArticleListItem";

const DEMO_LETTERS = [
  { id: "1", title: "봄 날의 산책", preview: "오늘 공원에서 벚꽃을 보았어요...", author: { name: "이웃A" }, timestamp: new Date(2026, 2, 25, 14, 30) },
  { id: "2", title: "어제의 일기", preview: "비가 오는 날이면 떠오르는 기억이 있어요", author: { name: "이웃B" }, timestamp: new Date(2026, 2, 24, 9, 15) },
  { id: "3", title: "좋아하는 문장", preview: "읽다가 멈춰 서게 된 한 줄이 있었어요", author: { name: "이웃C" }, timestamp: new Date(2026, 2, 23, 18, 0), isRead: true },
];

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [searchActive, setSearchActive] = useState(false);

  const handleSearchPress = useCallback(() => {
    setSearchActive((prev) => !prev);
  }, []);

  const handleArticlePress = useCallback((articleId: string) => {
    router.push({ pathname: "/read", params: { id: articleId } });
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="수신함"
        showSearch
        onSearchPress={handleSearchPress}
        searchActive={searchActive}
      />
      <FlatList
        data={DEMO_LETTERS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ArticleListItem
            title={item.title}
            preview={item.preview}
            author={item.author}
            timestamp={item.timestamp}
            isRead={item.isRead}
            onPress={() => handleArticlePress(item.id)}
          />
        )}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  listContent: {
    paddingBottom: Spacing.navBarPaddingBottom,
  },
});
