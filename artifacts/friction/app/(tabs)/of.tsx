import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { MiniSubTabBar } from "@/components/NavBar/MiniSubTabBar";
import { useNavigation } from "@/contexts/NavigationContext";

export default function OfScreen() {
  const insets = useSafeAreaInsets();
  const { ofSubTab } = useNavigation();

  const renderContent = () => {
    switch (ofSubTab) {
      case "personal":
        return (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>개인 모음</Text>
            <Text style={styles.emptySubtitle}>완성된 편지와 읽은 글을 모아두세요</Text>
          </View>
        );
      case "group":
        return (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>단체 모음</Text>
            <Text style={styles.emptySubtitle}>함께 글을 나눌 모임에 참여하세요</Text>
          </View>
        );
      case "sentence":
        return (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>문장 모음</Text>
            <Text style={styles.emptySubtitle}>읽으며 수집한 문장을 다시 만나보세요</Text>
          </View>
        );
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader title="보관함" />
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
});
