import "react-native-url-polyfill/auto";
import { useFonts } from "expo-font";
import {
  NotoSerifKR_400Regular,
  NotoSerifKR_600SemiBold,
  NotoSerifKR_800ExtraBold,
} from "@expo-google-fonts/noto-serif-kr";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, usePathname, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { getNotificationsModule } from "@/lib/safeNotifications";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { setEditorFonts, setEditorFontsError } from "@/lib/editorFontStore";
import { posthog, PostHogProvider } from "@/lib/posthog";
import { trackAppOpen } from "@/lib/analytics";
import { usePushNotifications } from "@/lib/usePushNotifications";
import { useNotificationDeepLink } from "@/lib/useNotificationDeepLink";
import { runtimeConfig } from "@/lib/runtimeConfig";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import ToastContainer from "@/components/Toast/Toast";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { ThoughtComposerProvider } from "@/contexts/ThoughtComposerContext";
import { UserProvider } from "@/contexts/UserContext";
import { ActiveReadingProvider, useActiveReading } from "@/contexts/ActiveReadingContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { uploadPendingCrashLogIfAny } from "@/lib/crashDiagnostics";
import { supabase } from "@/lib/supabase";
import { getCurrentAuthAccessToken } from "@/lib/authTokenStore";
import { Colors } from "@/constants/tokens";
import { Platform } from "react-native";
import { ReaderTransitionProvider } from "@/contexts/ReaderTransitionContext";

// 웹 개발 환경 로그인 바이패스 (비활성화: 실제 Supabase 인증 사용)
const DEV_WEB_BYPASS = false;
const DEV_WEB_BYPASS_USER_ID = "92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f";

setBaseUrl(runtimeConfig.apiBaseUrl);

// Best-effort: if the previous launch crashed with a fatal JS error, upload
// the diagnostic captured for it (see lib/crashDiagnostics.ts) now that the
// API base URL is configured.
if (runtimeConfig.apiBaseUrl) {
  uploadPendingCrashLogIfAny();
}

setAuthTokenGetter(async () => {
  // AuthProvider is the single native restore authority. Do not read a
  // persisted session here: that could race AppState handling and hand an
  // expired token to an API request before recovery has finished.
  return getCurrentAuthAccessToken();
});

// SplashScreen is a TurboModule call; guard it so a failure here doesn't abort
// startup. The splash will simply auto-hide instead.
try {
  SplashScreen.preventAutoHideAsync();
} catch (err) {
  console.warn("[SplashScreen] preventAutoHideAsync failed:", err);
}

// Keep cached data "fresh" for 30 seconds so that switching between tabs
// does not trigger a full refetch (and show a loading spinner) if the data
// was fetched within the last half-minute.  Individual screens still call
// refetch() on focus, but only when the data is older than this threshold
// (see `isQueryStale` in lib/useScreenFocused.ts).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Treat cached data as fresh for 30s — avoids refetch spinners during quick tab switches.
      staleTime: 30_000,
      // Keep inactive query cache around for 5 minutes so brief tab departures
      // (e.g. checking another app) don't drop data and force a full reload.
      gcTime: 5 * 60_000,
      // Retry once on failure — covers transient mobile network blips without
      // burning battery on infinite retry loops when the server is truly down.
      retry: 1,
      // After the device regains connectivity, always refetch so stale cached
      // data from before the disconnect is replaced with the latest server state.
      refetchOnReconnect: "always",
    },
    mutations: {
      // Never auto-retry mutations — they may be non-idempotent (e.g. send letter,
      // create collection); the user should explicitly retry from the UI instead.
      retry: 0,
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

function AuthLoadingView({ message }: { message: string }) {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={Colors.zinc400} />
      <Text style={styles.loadingLabel}>{message}</Text>
    </View>
  );
}

function AuthConfigurationErrorView({ message }: { message: string }) {
  return (
    <View style={styles.loadingContainer}>
      <Text style={styles.configurationTitle}>앱을 시작할 수 없어요</Text>
      <Text style={styles.loadingLabel}>{message}</Text>
      <Text style={styles.configurationHint}>
        최신 버전으로 다시 설치하거나 잠시 후 다시 시도해주세요.
      </Text>
    </View>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, isLoading, configurationError } = useAuth();
  // Register push token once the user is authenticated
  usePushNotifications(session?.user?.id ?? (DEV_WEB_BYPASS ? DEV_WEB_BYPASS_USER_ID : null));
  // Navigate to inbox when a LETTER_ARRIVED notification is tapped
  useNotificationDeepLink(session?.user?.id ?? (DEV_WEB_BYPASS ? DEV_WEB_BYPASS_USER_ID : null));
  const router = useRouter();
  const segments = useSegments();
  const hasRedirectedRef = useRef(false);

  if (configurationError) {
    return <AuthConfigurationErrorView message={configurationError} />;
  }

  const inBypassRoute = segments[0] != null && AUTH_BYPASS_ROUTES.has(segments[0] as string);
  const isAuthed = DEV_WEB_BYPASS || !!session;

  useEffect(() => {
    if (isLoading && !DEV_WEB_BYPASS) return;

    if (!isAuthed && !inBypassRoute) {
      router.replace("/login");
    } else if (isAuthed && segments[0] === "login") {
      hasRedirectedRef.current = true;
      router.replace("/(tabs)/on");
    } else if (
      isAuthed &&
      Platform.OS !== "web" &&
      segments[0] === "(tabs)" &&
      (segments[1] == null || (segments[1] as string) === "index") &&
      !hasRedirectedRef.current
    ) {
      hasRedirectedRef.current = true;
      router.replace("/(tabs)/on");
    }
  }, [isAuthed, isLoading, inBypassRoute, segments, router]);

  // Block rendering while auth state is resolving (개발 바이패스 시 스킵)
  if (isLoading && !DEV_WEB_BYPASS) {
    return <AuthLoadingView message="로그인 상태를 확인하고 있어요" />;
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
    return <AuthLoadingView message="화면을 불러오고 있어요" />;
  }

  // Unauthenticated login/bypass routes — no UserProvider needed
  if (inBypassRoute) {
    return <>{children}</>;
  }

  // Transient: authenticated state resolving
  return <AuthLoadingView message="화면을 준비하고 있어요" />;
}

function RootLayoutNav() {
  return (
    <AuthGuard>
      <ActiveReadingGuard>
        <Stack screenOptions={{ headerShown: false, headerBackTitle: "Back" }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="read" options={{ animation: "none" }} />
          <Stack.Screen name="of-01" />
          <Stack.Screen name="of-01-detail" />
          <Stack.Screen name="of-02" />
          <Stack.Screen name="of-02-detail" />
          <Stack.Screen name="of-03" />
          <Stack.Screen name="of-space-rounds" />
          <Stack.Screen name="of-space-start" />
          <Stack.Screen name="of-space-schedule-send" />
          <Stack.Screen name="of-space-archive" />
          <Stack.Screen name="on-01a" options={{ animationTypeForReplace: "pop" }} />
          <Stack.Screen name="on-01b" options={{ animationTypeForReplace: "pop" }} />
          <Stack.Screen name="on-01c" />
          <Stack.Screen name="to-03" />
          <Stack.Screen name="to-send" options={{ presentation: "modal" }} />
          <Stack.Screen name="mypage" />
          <Stack.Screen name="user-profile/[userId]" />
          <Stack.Screen name="mypage-neighbors" />
          <Stack.Screen name="mypage-sendrecords" />
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
    gap: 12,
  },
  loadingLabel: {
    color: Colors.zinc500,
    fontSize: 14,
  },
  configurationTitle: {
    color: Colors.zinc900,
    fontSize: 20,
    fontWeight: "600",
  },
  configurationHint: {
    color: Colors.zinc400,
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
  },
});

async function loadEditorFonts(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
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
  useEffect(() => {
    try {
      // posthog?.capture() is a TurboModule call; guard so analytics failure
      // never interrupts the startup render cycle.
      trackAppOpen();
    } catch (err) {
      console.warn("[analytics] trackAppOpen failed:", err);
    }
  }, []);

  // Register the Android silent-notification channel on startup.
  // The channel must exist before any notification with this channelId is
  // delivered; creating it multiple times is idempotent.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const Notifications = getNotificationsModule();
    if (!Notifications) return;
    Notifications.setNotificationChannelAsync("letter-arrived-silent", {
      name: "편지 도착 알림",
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: null,
      sound: null,
      enableLights: false,
      enableVibrate: false,
    }).catch((err) => {
      console.warn("[notifications] setNotificationChannelAsync failed:", err);
    });
  }, []);

  useEffect(() => {
    Asset.loadAsync([require("@/assets/images/wordmark_maroon.png")]);
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    "Pretendard-ExtraLight": require("../assets/fonts/Pretendard-ExtraLight.otf"),
    "Pretendard-Regular": require("../assets/fonts/Pretendard-Regular.otf"),
    "Pretendard-Medium": require("../assets/fonts/Pretendard-Medium.otf"),
    "Pretendard-SemiBold": require("../assets/fonts/Pretendard-SemiBold.otf"),
    "Pretendard-Black": require("../assets/fonts/Pretendard-Black.otf"),
    "Eulyoo1945-Regular": require("../assets/fonts/Eulyoo1945-Regular.otf"),
    "Eulyoo1945-SemiBold": require("../assets/fonts/Eulyoo1945-SemiBold.otf"),
    NotoSerifKR_400Regular,
    NotoSerifKR_600SemiBold,
    NotoSerifKR_800ExtraBold,
  });
  const [fontLoadTimedOut, setFontLoadTimedOut] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const timeoutId = setTimeout(() => {
      console.warn(
        "[fonts] Font loading exceeded 10 seconds; continuing with system fallbacks.",
      );
      setFontLoadTimedOut(true);
    }, 10000);
    return () => clearTimeout(timeoutId);
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (fontsLoaded || fontError || fontLoadTimedOut) {
      // Guard: SplashScreen.hideAsync() is a TurboModule call; a failure here
      // should not leave the app stuck on the splash screen indefinitely.
      SplashScreen.hideAsync().catch((err) => {
        console.warn("[SplashScreen] hideAsync failed:", err);
      });
    }
  }, [fontsLoaded, fontError, fontLoadTimedOut]);

  if (!fontsLoaded && !fontError && !fontLoadTimedOut) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.zinc400} />
        <Text style={styles.loadingLabel}>앱을 준비하고 있어요</Text>
      </View>
    );
  }

  const appTree = (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <AuthProvider>
              <ActiveReadingProvider>
                <ToastProvider>
                  <ThoughtComposerProvider>
                    <NavigationProvider>
                      <ReaderTransitionProvider>
                        <RootLayoutNav />
                        <ToastContainer />
                      </ReaderTransitionProvider>
                    </NavigationProvider>
                  </ThoughtComposerProvider>
                </ToastProvider>
              </ActiveReadingProvider>
            </AuthProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );

  // PostHogProvider throws if given neither a client nor an apiKey, so skip it
  // entirely when no client was initialized (e.g. EXPO_PUBLIC_POSTHOG_TOKEN unset).
  if (!posthog) return appTree;

  return (
    <PostHogProvider client={posthog} autocapture>
      {appTree}
    </PostHogProvider>
  );
}
