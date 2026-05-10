import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useNavBarBottomSafeArea } from "@/hooks/useNavBarBottomSafeArea";
import { PageHeader } from "@/components/NavBar/PageHeader";

export default function ArchiveScreen() {
  const insets = useSafeAreaInsets();
  const navBarBottom = useNavBarBottomSafeArea();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PageHeader title="보관함" />
      <View style={[styles.content, { paddingBottom: navBarBottom }]}>
        <Text style={styles.placeholder}>준비 중입니다.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.screenPx,
  },
  placeholder: {
    ...Typography.body,
    color: Colors.zinc400,
  },
});
