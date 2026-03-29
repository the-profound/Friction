import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing, Typography } from "@/constants/tokens";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.content}>
        <Feather name="book-open" size={56} color={Colors.zinc300} />
        <Text style={styles.title}>Friction</Text>
        <Text style={styles.subtitle}>읽고, 나누고, 연결하세요</Text>
        <Pressable
          style={styles.button}
          onPress={() => router.replace("/(tabs)" as never)}
          accessibilityRole="button"
          accessibilityLabel="계속하기"
        >
          <Text style={styles.buttonText}>계속하기</Text>
        </Pressable>
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
    gap: 12,
  },
  title: {
    ...Typography.headerTitle,
    fontSize: 36,
    color: Colors.zinc900,
    marginTop: 16,
  },
  subtitle: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc500,
    textAlign: "center",
  },
  button: {
    marginTop: 32,
    backgroundColor: Colors.zinc900,
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 14,
  },
  buttonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
});
