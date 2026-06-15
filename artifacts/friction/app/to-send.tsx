import React, { useCallback, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { SendInline } from "@/components/ToInline/SendInline";

export default function ToSendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    targetGroup?: string;
    targetGroupName?: string;
    returnToId?: string;
    articleId?: string;
    prefillArticleId?: string;
    neighborId?: string;
  }>();

  const prefillArticleId = params.prefillArticleId ?? params.articleId;

  const prefillKey = useMemo(
    () =>
      [
        params.targetGroup ?? "",
        params.targetGroupName ?? "",
        prefillArticleId ?? "",
        params.neighborId ?? "",
        params.returnToId ?? "",
      ].join("|"),
    [
      params.targetGroup,
      params.targetGroupName,
      prefillArticleId,
      params.neighborId,
      params.returnToId,
    ],
  );

  const handleSendComplete = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ScalePressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </ScalePressable>
        <Text style={styles.headerTitle}>보내기</Text>
        <ScalePressable
          onPress={() => router.push("/mypage-sendrecords")}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="발신 기록"
        >
          <Feather name="clock" size={20} color={Colors.zinc600} />
        </ScalePressable>
      </View>
      <SendInline
        targetGroup={params.targetGroup}
        targetGroupName={params.targetGroupName}
        prefillArticleId={prefillArticleId}
        prefillNeighborId={params.neighborId}
        returnToId={params.returnToId}
        prefillKey={prefillKey}
        onSent={handleSendComplete}
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
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
});
