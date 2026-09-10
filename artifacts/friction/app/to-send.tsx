import React, { useCallback, useMemo, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import HeaderButton from "@/components/shared/HeaderButton";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography } from "@/constants/tokens";
import { SendInline } from "@/components/ToInline/SendInline";

export default function ToSendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scheduleNavigationStartedRef = useRef(false);
  const params = useLocalSearchParams<{
    targetGroup?: string;
    targetGroupName?: string;
    returnToId?: string;
    articleId?: string;
    prefillArticleId?: string;
    neighborId?: string;
    spaceId?: string;
    spaceName?: string;
  }>();

  const prefillArticleId = params.prefillArticleId ?? params.articleId;

  const prefillKey = useMemo(
    () =>
      [
        params.targetGroup ?? "",
        params.targetGroupName ?? "",
        prefillArticleId ?? "",
        params.neighborId ?? "",
        params.spaceId ?? "",
        params.spaceName ?? "",
        params.returnToId ?? "",
      ].join("|"),
    [
      params.targetGroup,
      params.targetGroupName,
      prefillArticleId,
      params.neighborId,
      params.spaceId,
      params.spaceName,
      params.returnToId,
    ],
  );

  const handleSendComplete = useCallback(() => {
    router.back();
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      scheduleNavigationStartedRef.current = false;
    }, []),
  );

  const handleScheduleSpace = useCallback(
    (spaceId: string, articleId: string) => {
      if (scheduleNavigationStartedRef.current) return;
      scheduleNavigationStartedRef.current = true;
      router.push({
        pathname: "/of-space-schedule-send",
        params: {
          id: spaceId,
          startReservation: "1",
          prefillArticleId: articleId,
        },
      });
    },
    [router],
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <HeaderButton
          variant="back"
          onPress={() => router.back()}
          accessibilityLabel="기록 목록으로 돌아가기"
        />
        <Text style={styles.headerTitle}>보내기</Text>
        <ScalePressable
          style={styles.headerActionButton}
          contentStyle={styles.headerActionButtonContent}
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
        prefillSpaceId={params.spaceId}
        prefillSpaceName={params.spaceName}
        returnToId={params.returnToId}
        prefillKey={prefillKey}
        onSent={handleSendComplete}
        onScheduleSpace={handleScheduleSpace}
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
  headerActionButton: { width: 44, height: 44, flexGrow: 0, flexShrink: 0 },
  headerActionButtonContent: {
    width: 40,
    height: 40,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
});
