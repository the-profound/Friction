import "react-native-url-polyfill/auto";
import { useFonts } from "expo-font";
import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, usePathname, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Asset } from "expo-asset";
import { setEditorFonts, setEditorFontsError } from "@/lib/editorFontStore";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import ToastContainer from "@/components/Toast/Toast";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { UserProvider } from "@/contexts/UserContext";
import { ActiveReadingProvider, useActiveReading } from "@/contexts/ActiveReadingContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { setBaseUrl } from "@workspace/api-client-react";
import { Colors } from "@/constants/tokens";
import { Platform } from "react-native";

// 웹 개발 환경에서는 로그인 없이 시뮬레이션 (DEV_WEB_BYPASS_USER_ID로 시드된 계정 사용)
const DEV_WEB_BYPASS = __DEV__ && Platform.OS === "web";
const DEV_WEB_BYPASS_USER_ID = "92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f";

if (process.env.EXPO_PUBLIC_DOMAIN) {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const baseUrl = domain.startsWith("http://") || domain.startsWith("https://")
    ? domain
    : `https://${domain}`;
  setBaseUrl(baseUrl);
}

SplashScreen.preventAutoHideAsync();

// Keep cached data "fresh" for 30 seconds so that switching between tabs
// does not trigger a full refetch (and show a loading spinner) if the data
// was fetched within the last half-minute.  Individual screens still call
// refetch() on focus, but only when the data is older than this threshold
// (see `isQueryStale` in lib/useScreenFocused.ts).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});

function ActiveReadingGuard({ children }: { children: React.ReactNode }) {
  const { activeSession } = useActiveReading();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (activeSession && pathname !== "/read") {
      router.push({
        pathname: "/read",
        params: {
          articleId: activeSession.articleId,
          inboxId: activeSession.inboxId,
          mode: activeSession.mode,
        },
      });
    }
  }, [activeSession, router, pathname]);

  return <>{children}</>;
}

const AUTH_BYPASS_ROUTES = new Set(["login", "login-callback"]);

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  const inBypassRoute = segments[0] != null && AUTH_BYPASS_ROUTES.has(segments[0] as string);
  const isAuthed = DEV_WEB_BYPASS || !!session;

  useEffect(() => {
    if (isLoading && !DEV_WEB_BYPASS) return;

    if (!isAuthed && !inBypassRoute) {
      router.replace("/login");
    } else if (isAuthed && segments[0] === "login") {
      router.replace("/(tabs)");
    }
  }, [isAuthed, isLoading, inBypassRoute, segments, router]);

  // Block rendering while auth state is resolving (개발 바이패스 시 스킵)
  if (isLoading && !DEV_WEB_BYPASS) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.zinc400} />
      </View>
    );
  }

  // Authenticated: wrap ALL routes (including login/bypass) in UserProvider so
  // that there is no window during the login→tabs navigation transition where a
  // tab screen mounts while UserProvider is absent from the tree.
  // login.tsx / login-callback.tsx do not call useUser(), so this is safe.
  if (session?.user?.id) {
    return <UserProvider>{children}</UserProvider>;
  }

  if (DEV_WEB_BYPASS) {
    return <UserProvider userId={DEV_WEB_BYPASS_USER_ID}>{children}</UserProvider>;
  }

  // Block rendering protected routes while redirecting to login
  if (!isAuthed && !inBypassRoute) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.zinc400} />
      </View>
    );
  }

  // Unauthenticated login/bypass routes — no UserProvider needed
  if (inBypassRoute) {
    return <>{children}</>;
  }

  // Transient: authenticated state resolving
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={Colors.zinc400} />
    </View>
  );
}

function RootLayoutNav() {
  return (
    <AuthGuard>
      <ActiveReadingGuard>
        <Stack screenOptions={{ headerShown: false, headerBackTitle: "Back" }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="read" />
          <Stack.Screen name="of-01" />
          <Stack.Screen name="of-01-detail" />
          <Stack.Screen name="of-02" />
          <Stack.Screen name="of-02-detail" />
          <Stack.Screen name="of-03" />
          <Stack.Screen name="on-01a" />
          <Stack.Screen name="on-01b" />
          <Stack.Screen name="on-01c" />
          <Stack.Screen name="on-02" />
          <Stack.Screen name="to-03" />
          <Stack.Screen name="settings" options={{ presentation: "card" }} />
          <Stack.Screen name="terms" options={{ presentation: "card" }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="login-callback" options={{ headerShown: false }} />
        </Stack>
      </ActiveReadingGuard>
    </AuthGuard>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
});

async function loadEditorFonts(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const FileSystem = await import("expo-file-system/legacy");
    const [regularAsset, semiBoldAsset] = await Asset.loadAsync([
      require("../assets/fonts/Eulyoo1945-Regular.otf"),
      require("../assets/fonts/Eulyoo1945-SemiBold.otf"),
    ]);
    const regularUri = regularAsset.localUri ?? regularAsset.uri;
    const semiBoldUri = semiBoldAsset.localUri ?? semiBoldAsset.uri;
    const [regular, semiBold] = await Promise.all([
      FileSystem.readAsStringAsync(regularUri, { encoding: "base64" }),
      FileSystem.readAsStringAsync(semiBoldUri, { encoding: "base64" }),
    ]);
    setEditorFonts(regular, semiBold);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[editorFonts] Failed to load editor fonts:", err);
    setEditorFontsError(message);
  }
}

loadEditorFonts();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ...Feather.font,
    ...MaterialCommunityIcons.font,
    "Pretendard-ExtraLight": require("../assets/fonts/Pretendard-ExtraLight.otf"),
    "Pretendard-SemiBold": require("../assets/fonts/Pretendard-SemiBold.otf"),
    "Pretendard-Black": require("../assets/fonts/Pretendard-Black.otf"),
    "Eulyoo1945-Regular": require("../assets/fonts/Eulyoo1945-Regular.otf"),
    "Eulyoo1945-SemiBold": require("../assets/fonts/Eulyoo1945-SemiBold.otf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AuthProvider>
                <ActiveReadingProvider>
                  <ToastProvider>
                    <NavigationProvider>
                      <RootLayoutNav />
                      <ToastContainer />
                    </NavigationProvider>
                  </ToastProvider>
                </ActiveReadingProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
