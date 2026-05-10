import React, { useCallback, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Colors } from "@/constants/tokens";
import { PageHeader } from "@/components/NavBar/PageHeader";
import { SendInline } from "@/components/ToInline/SendInline";

type ParamRouter = ReturnType<typeof useRouter>;

function clearRouterParams(router: ParamRouter, keys: string[]): void {
  const cleared = Object.fromEntries(keys.map((k) => [k, undefined])) as unknown as Record<
    string,
    string
  >;
  router.setParams(cleared);
}

export default function ToScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    targetGroup?: string;
    targetGroupName?: string;
    returnToId?: string;
    articleId?: string;
    neighborId?: string;
  }>();

  const prefillKey = useMemo(
    () =>
      [
        params.targetGroup ?? "",
        params.targetGroupName ?? "",
        params.articleId ?? "",
        params.neighborId ?? "",
        params.returnToId ?? "",
      ].join("|"),
    [
      params.targetGroup,
      params.targetGroupName,
      params.articleId,
      params.neighborId,
      params.returnToId,
    ],
  );

  const handleSendComplete = useCallback(() => {
    clearRouterParams(router, [
      "targetGroup",
      "targetGroupName",
      "articleId",
      "neighborId",
      "returnToId",
    ]);
  }, [router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader
        title="발신함"
        showSearch={false}
        showHistory
        onHistoryPress={() => router.push("/mypage-sendrecords")}
      />
      <SendInline
        targetGroup={params.targetGroup}
        targetGroupName={params.targetGroupName}
        prefillArticleId={params.articleId}
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
});
