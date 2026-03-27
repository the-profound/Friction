import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [searchActive, setSearchActive] = useState(false);

  const handleSearchPress = useCallback(() => {
    setSearchActive((prev) => !prev);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="수신함"
        showSearch
        onSearchPress={handleSearchPress}
        searchActive={searchActive}
      />
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>아직 받은 편지가 없어요</Text>
        <Text style={styles.emptySubtitle}>이웃에게 편지를 받으면 여기에 표시됩니다</Text>
      </View>
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
});
