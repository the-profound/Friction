import { Tabs, useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Alert, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import { NavBar } from "@/components/NavBar/NavBar";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Sizing, Spacing } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";
import { useUser } from "@/contexts/UserContext";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useCreateArticle } from "@workspace/api-client-react";
import { invalidateArticleLists } from "@/lib/queryInvalidation";

export default function TabLayout() {
  const { showRecordFab, activeTab } = useNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId } = useUser();
  const createArticle = useCreateArticle();

  const handleNewMemo = useCallback(async () => {
    if (createArticle.isPending) return;
    try {
      const article = await createArticle.mutateAsync({
        data: { authorId: userId, title: "" },
      });
      invalidateArticleLists(queryClient);
      router.push({ pathname: "/on-01a", params: { id: article.id } });
    } catch {
      Alert.alert("오류", "메모 생성에 실패했습니다.");
    }
  }, [createArticle, userId, queryClient, router]);

  const fabBottom = useNavBarBottomSafeArea(8);

  return (
    <>
      <Tabs
        initialRouteName="index"
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: "none" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "수신함" }} />
        <Tabs.Screen name="archive" options={{ title: "보관함" }} />
        <Tabs.Screen name="on" options={{ title: "기록함" }} />
        <Tabs.Screen name="of" options={{ title: "단체 모음" }} />
        <Tabs.Screen name="to" options={{ title: "마이" }} />
      </Tabs>
      <NavBar />
      {showRecordFab && activeTab === "ON" && (
        <ScalePressable
          style={[styles.fab, { bottom: fabBottom }]}
          contentStyle={styles.fabContent}
          onPress={handleNewMemo}
          accessibilityRole="button"
          accessibilityLabel="메모 추가"
        >
          <Feather name="edit-3" size={20} color={Colors.white} />
        </ScalePressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: Spacing.screenPx,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.zinc900,
    zIndex: Sizing.navBarZIndex + 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  fabContent: {
    alignItems: "center",
    justifyContent: "center",
  },
});
