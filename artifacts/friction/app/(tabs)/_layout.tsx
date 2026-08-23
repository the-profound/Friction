import { Tabs, useRouter } from "expo-router";
import React, { useCallback } from "react";
import { StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import { NavBar } from "@/components/NavBar/NavBar";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, Sizing, Spacing } from "@/constants/tokens";
import { useNavigation } from "@/contexts/NavigationContext";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/contexts/ToastContext";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { useCreateThought } from "@workspace/api-client-react";
import { invalidateArticleLists } from "@/lib/queryInvalidation";

export default function TabLayout() {
  const { showRecordFab, activeTab } = useNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  useUser();
  const { showToast } = useToast();
  const createThought = useCreateThought();

  const handleNewMemo = useCallback(async () => {
    if (createThought.isPending) return;
    try {
      const thought = await createThought.mutateAsync({
        data: { content: "# \n\n", createdFrom: "direct", status: "PRELIMINARY" },
      });
      invalidateArticleLists(queryClient);
      router.push({ pathname: "/on-01a", params: { id: thought.id } });
    } catch {
      showToast({ message: "메모 생성에 실패했습니다.", type: "error" });
    }
  }, [createThought, queryClient, router, showToast]);

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
        <Tabs.Screen name="index" options={{ title: "수신" }} />
        <Tabs.Screen name="of" options={{ title: "공간" }} />
        <Tabs.Screen name="on" options={{ title: "기록" }} />
        <Tabs.Screen name="archive" options={{ title: "보관" }} />
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
    zIndex: Sizing.navBarZIndex + 1,
  },
  fabContent: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.zinc900,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
    alignItems: "center",
    justifyContent: "center",
  },
});
