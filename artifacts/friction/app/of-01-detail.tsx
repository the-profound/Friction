import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";

export default function PersonalCollectionDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [isPublic, setIsPublic] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>개인 모음 상세</Text>
        <Pressable hitSlop={12}>
          <Feather name="more-horizontal" size={20} color={Colors.zinc600} />
        </Pressable>
      </View>
      <View style={styles.metaSection}>
        <View style={styles.visibilityRow}>
          <Text style={styles.visibilityLabel}>공개 설정</Text>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: Colors.zinc200, true: Colors.zinc900 }}
          />
        </View>
        <Text style={styles.visibilityHint}>
          {isPublic ? "다른 사람이 이 모음을 구독할 수 있어요" : "나만 볼 수 있는 모음이에요"}
        </Text>
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>글 목록</Text>
        <Pressable style={styles.addArticleButton} onPress={() => setShowPicker(true)}>
          <Feather name="plus" size={16} color={Colors.zinc600} />
          <Text style={styles.addArticleText}>글 추가</Text>
        </Pressable>
      </View>
      <View style={styles.emptyContainer}>
        <Feather name="file-text" size={36} color={Colors.zinc300} />
        <Text style={styles.emptyTitle}>아직 추가된 글이 없어요</Text>
        <Text style={styles.emptySubtitle}>완성된 편지를 이 모음에 추가해보세요</Text>
      </View>
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
  metaSection: {
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.zinc100,
  },
  visibilityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  visibilityLabel: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  visibilityHint: {
    ...Typography.body,
    fontSize: 13,
    color: Colors.zinc500,
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 14,
  },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
  },
  addArticleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.zinc50,
    borderRadius: 8,
  },
  addArticleText: {
    ...Typography.caption,
    fontSize: 13,
    color: Colors.zinc600,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.screenPx,
    gap: 8,
  },
  emptyTitle: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.zinc900,
    marginTop: 8,
  },
  emptySubtitle: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    textAlign: "center",
  },
});
