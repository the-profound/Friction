import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Spacing, Typography } from "@/constants/tokens";
import { useAuth } from "@/contexts/AuthContext";

const SESSION_TIMEOUT_MS = 10_000;

export default function LoginCallbackScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, isLoading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Start a timeout — if session doesn't arrive in time, the link likely expired
    timerRef.current = setTimeout(() => setTimedOut(true), SESSION_TIMEOUT_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (session) {
      if (timerRef.current) clearTimeout(timerRef.current);
      router.replace("/(tabs)");
    }
  }, [session, router]);

  // Only show error after explicit timeout — session may still be arriving via onAuthStateChange
  const showError = timedOut && !session;

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {!showError ? (
        <View style={styles.content}>
          <ActivityIndicator size="large" color={Colors.zinc700} />
          <Text style={styles.loadingText}>로그인 중...</Text>
        </View>
      ) : (
        <View style={styles.content}>
          <Text style={styles.errorTitle}>로그인 실패</Text>
          <Text style={styles.errorMessage}>
            {timedOut
              ? "로그인 처리 시간이 초과되었습니다. 링크가 만료되었거나 네트워크 상태를 확인해주세요."
              : "링크가 만료되었거나 유효하지 않습니다. 다시 로그인을 시도해주세요."}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => router.replace("/login")}
            accessibilityRole="button"
            accessibilityLabel="로그인 화면으로 돌아가기"
          >
            <Text style={styles.buttonText}>로그인 화면으로</Text>
          </Pressable>
        </View>
      )}
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
    gap: 16,
  },
  loadingText: {
    ...Typography.body,
    fontSize: 16,
    color: Colors.zinc500,
    marginTop: 8,
  },
  errorTitle: {
    ...Typography.bodySemiBold,
    fontSize: 20,
    color: Colors.zinc900,
  },
  errorMessage: {
    ...Typography.body,
    fontSize: 15,
    color: Colors.zinc500,
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    marginTop: 8,
    backgroundColor: Colors.zinc900,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.white,
  },
});
