import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { useNavigation } from "@/contexts/NavigationContext";

export default function ToScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { toSubTab } = useNavigation();

  const handleAddNeighbor = useCallback(() => {
    router.push("/to-01");
  }, [router]);

  const handleSend = useCallback(() => {
    router.push("/to-02");
  }, [router]);

  const handleViewHistory = useCallback(() => {
    router.push("/to-03");
  }, [router]);

  const renderContent = () => {
    switch (toSubTab) {
      case "neighbors":
        return (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>이웃 목록</Text>
            <Text style={styles.emptySubtitle}>편지를 주고받을 이웃을 추가해보세요</Text>
            <Pressable style={styles.actionButton} onPress={handleAddNeighbor}>
              <Feather name="user-plus" size={16} color={Colors.white} />
              <Text style={styles.actionButtonText}>이웃 추가</Text>
            </Pressable>
          </View>
        );
      case "history":
        return (
          <Pressable style={styles.emptyContainer} onPress={handleViewHistory}>
            <Text style={styles.emptyTitle}>발신 목록</Text>
            <Text style={styles.emptySubtitle}>보낸 편지의 기록이 여기에 표시됩니다</Text>
          </Pressable>
        );
      case "send":
        return (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>보내기</Text>
            <Text style={styles.emptySubtitle}>완성된 편지를 이웃에게 보내보세요</Text>
            <Pressable style={styles.actionButton} onPress={handleSend}>
              <Feather name="send" size={16} color={Colors.white} />
              <Text style={styles.actionButtonText}>보내기</Text>
            </Pressable>
          </View>
        );
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="발신함"
        showAdd
        onAddPress={handleAddNeighbor}
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
    marginBottom: 24,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.zinc900,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
