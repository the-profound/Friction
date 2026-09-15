import "react-native-url-polyfill/auto";
import { useFonts } from "expo-font";
import {
  NotoSerifKR_400Regular,
  NotoSerifKR_600SemiBold,
  NotoSerifKR_800ExtraBold,
} from "@expo-google-fonts/noto-serif-kr";
import {
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import { Stack, useRouter, usePathname, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { getNotificationsModule } from "@/lib/safeNotifications";
import { subscribeToNetInfo } from "@/lib/safeNetInfo";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import {
  setEditorFontFallback,
  setEditorFonts,
  setEditorFontsError,
} from "@/lib/editorFontStore";
import { posthog, PostHogProvider } from "@/lib/posthog";
import { trackAppOpen } from "@/lib/analytics";
import { usePushNotifications } from "@/lib/usePushNotifications";
import { useNotificationDeepLink } from "@/lib/useNotificationDeepLink";
import { runtimeConfig } from "@/lib/runtimeConfig";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  QueryClientBoundary,
  renderQueryClientBoundary,
} from "@/components/QueryClientBoundary";
import ToastContainer from "@/components/Toast/Toast";
import ServerVersionGate from "@/components/ServerVersionGate/ServerVersionGate";
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
import { queryClient } from "@/lib/queryClient";
import { Colors } from "@/constants/tokens";
import { Platform } from "react-native";
import { ReaderTransitionProvider } from "@/contexts/ReaderTransitionContext";
import {
  BODY_FONT_ASSET_NAMES,
  BODY_FONT_ASSET_PATHS,
  BODY_FONT_CONFIG_VERSION,
} from "@/components/shared/bodyTypographyFonts";
import {
  getActiveReadingForUser,
  getAuthNavigationDecision,
  getProtectedNavigationDecision,
} from "@/lib/authNavigation";

setBaseUrl(runtimeConfig.apiBaseUrl);

// React Native has no browser-style navigator.onLine events, so use NetInfo
// when the installed binary provides it. Older development clients may not
// include RNCNetInfo; the safe adapter then preserves React Query's online
// default so startup and normal network use continue without offline sensing.
onlineManager.setEventListener(subscribeToNetInfo);

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
import { reportNativeBodyFontReady } from "@/lib/nativeBodyFontMode";

function ActiveReadingGuard({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  const { activeSession, isHydrated, refreshActiveSession } = useActiveReading();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  // Cold-start restoration and the native default tab are decided exactly
  // once per authenticated user. Foreground storage refreshes only synchronize
  // state; they must never replace or unmount the current navigation stack.
  const hasCompletedInitialNavigationRef = useRef(false);
  const navigationDecision = getProtectedNavigationDecision({
    shouldDecideInitialRoute: !hasCompletedInitialNavigationRef.current,
    isActiveReadingHydrated: isHydrated,
    activeSession,
    userId,
    pathname,
    shouldOpenRecords:
      segments[0] === "login" ||
      segments[0] === "login-callback" ||
      (Platform.OS !== "web" &&
        segments[0] === "(tabs)" &&
        (segments[1] == null || (segments[1] as string) === "index")),
  });
  const protectedNavigationKind = navigationDecision.kind;
  const readingToRestore =
    navigationDecision.kind === "restore-reading"
      ? navigationDecision.activeSession
      : null;

  useEffect(() => {
    if (!isHydrated) return;
    hasCompletedInitialNavigationRef.current = true;
  }, [isHydrated]);

  useEffect(() => {
    if (protectedNavigationKind === "restore-reading" && readingToRestore) {
      router.replace({
        pathname: "/read",
        params: {
          articleId: readingToRestore.articleId,
          inboxId: readingToRestore.inboxId,
          entrySource: readingToRestore.entrySource,
          mode: readingToRestore.mode,
          analyticsSessionId: readingToRestore.analyticsSessionId,
          analyticsIsReread: readingToRestore.analyticsIsReread ? "true" : undefined,
        },
      });
    } else if (protectedNavigationKind === "open-records") {
      router.replace("/(tabs)/on");
    }
  }, [
    protectedNavigationKind,
    readingToRestore?.articleId,
    readingToRestore?.inboxId,
    readingToRestore?.entrySource,
    readingToRestore?.mode,
    readingToRestore?.analyticsSessionId,
    readingToRestore?.analyticsIsReread,
    router,
  ]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshActiveSession();
      }
    });
    return () => subscription.remove();
  }, [refreshActiveSession]);

  return <>{children}</>;
}

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

function ProtectedRouteStack({ userId }: { userId: string }) {
  return (
    <QueryClientBoundary>
      <UserProvider key={userId} userId={userId}>
        <ActiveReadingGuard userId={userId}>
          <Stack
            key={`protected-${userId}`}
            screenLayout={renderQueryClientBoundary}
            screenOptions={{ headerShown: false, headerBackTitle: "Back" }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="read" options={{ animation: "none" }} />
            <Stack.Screen name="of-01" />
            <Stack.Screen name="of-01-detail" />
            <Stack.Screen name="of-02" />
            <Stack.Screen name="of-02-detail" />
            <Stack.Screen name="of-03" />
            <Stack.Screen name="stored-sentence-detail" />
            <Stack.Screen name="of-space-rounds" />
            <Stack.Screen name="of-space-basic-settings" />
            <Stack.Screen name="of-space-start" />
            <Stack.Screen name="of-space-schedule-send" />
            <Stack.Screen name="of-space-archive" />
            <Stack.Screen
              name="on-01a"
              options={{ animation: "none", animationTypeForReplace: "pop" }}
            />
            <Stack.Screen
              name="on-01b"
              options={{ animation: "none", animationTypeForReplace: "pop" }}
            />
            <Stack.Screen name="on-01c" options={{ animation: "none" }} />
            <Stack.Screen name="to-03" />
            <Stack.Screen name="to-send" options={{ presentation: "card", animation: "slide_from_right" }} />
            <Stack.Screen name="mypage" />
            <Stack.Screen name="user-profile/[userId]" />
            <Stack.Screen name="mypage-neighbors" />
            <Stack.Screen name="mypage-sendrecords" />
            <Stack.Screen name="settings" options={{ presentation: "card" }} />
            <Stack.Screen name="terms" options={{ presentation: "card" }} />
            {/* Keep the login route declared while redirecting after sign-in.
                It is still inside UserProvider, so it cannot expose a provider
                gap if the router has not processed the redirect yet. */}
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="login-callback" options={{ headerShown: false }} />
          </Stack>
        </ActiveReadingGuard>
      </UserProvider>
    </QueryClientBoundary>
  );
}

function PublicRouteStack() {
  return (
    <Stack key="public" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="login-callback" />
    </Stack>
  );
}

function AuthGuard() {
  const { session, isLoading, configurationError } = useAuth();
  // Register push token once the user is authenticated
  const sessionUserId = session?.user?.id ?? null;
  usePushNotifications(sessionUserId);
  // Navigate to inbox when a LETTER_ARRIVED notification is tapped
  useNotificationDeepLink(sessionUserId);
  const { activeSession, clearActiveSession, isHydrated: isActiveReadingHydrated } = useActiveReading();
  const router = useRouter();
  const segments = useSegments();
  const previousUserIdRef = useRef<string | null>(null);

  const firstSegment = segments[0] as string | undefined;
  const decision = getAuthNavigationDecision({
    isLoading,
    userId: sessionUserId,
    firstSegment,
  });
  const navigationKind = decision.kind;

  useEffect(() => {
    if (configurationError || isLoading) return;

    if (navigationKind === "redirect-login") {
      clearActiveSession();
      router.replace("/login");
    }
  }, [clearActiveSession, configurationError, isLoading, navigationKind, router]);

  useEffect(() => {
    if (configurationError || !isActiveReadingHydrated) return;
    if (!sessionUserId) {
      previousUserIdRef.current = null;
      if (activeSession) clearActiveSession();
      return;
    }

    const accountChanged =
      previousUserIdRef.current !== null &&
      previousUserIdRef.current !== sessionUserId;
    const activeReadingBelongsToAnotherAccount =
      activeSession !== null &&
      getActiveReadingForUser(activeSession, sessionUserId) === null;
    if (accountChanged || activeReadingBelongsToAnotherAccount) {
      clearActiveSession();
    }
    previousUserIdRef.current = sessionUserId;
  }, [activeSession, clearActiveSession, configurationError, isActiveReadingHydrated, sessionUserId]);

  if (configurationError) {
    return <AuthConfigurationErrorView message={configurationError} />;
  }

  if (
    decision.kind === "loading" ||
    (decision.kind === "protected" && !isActiveReadingHydrated)
  ) {
    return <AuthLoadingView message="로그인 상태를 확인하고 있어요" />;
  }

  if (decision.kind === "protected") {
    return <ProtectedRouteStack userId={decision.userId} />;
  }

  if (decision.kind === "redirect-login") {
    return <AuthLoadingView message="화면을 불러오고 있어요" />;
  }

  return <PublicRouteStack />;
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
  const assetSpecs = [
    {
      name: BODY_FONT_ASSET_NAMES[0],
      path: BODY_FONT_ASSET_PATHS[0],
      module: require("../assets/fonts/Eulyoo1945-Regular.woff2"),
    },
    {
      name: BODY_FONT_ASSET_NAMES[1],
      path: BODY_FONT_ASSET_PATHS[1],
      module: require("../assets/fonts/Eulyoo1945-SemiBold.woff2"),
    },
    {
      name: BODY_FONT_ASSET_NAMES[2],
      path: BODY_FONT_ASSET_PATHS[2],
      module: require("../assets/fonts/NotoSerifKR-400Regular-korean.woff2"),
    },
    {
      name: BODY_FONT_ASSET_NAMES[3],
      path: BODY_FONT_ASSET_PATHS[3],
      module: require("../assets/fonts/NotoSerifKR-600SemiBold-korean.woff2"),
    },
  ];
  const diagnosticContext = {
    contractVersion: BODY_FONT_CONFIG_VERSION,
    serverId:
      process.env.EXPO_PUBLIC_FRICTION_DEV_SERVER_ID?.trim() || "unknown",
    serverContractVersion:
      process.env.EXPO_PUBLIC_FRICTION_DEV_FONT_CONTRACT_VERSION?.trim() ||
      "unknown",
    platform: Platform.OS,
    assetPaths: assetSpecs.map(({ path }) => path),
    assetModuleRefs: assetSpecs.map(({ module }) =>
      typeof module === "number" ? String(module) : typeof module,
    ),
  };
  console.info(
    "[editorFonts] Loading native body-font assets",
    diagnosticContext,
  );
  const loaded = new Map<string, { asset: Asset; base64: string }>();
  const failures = new Map<string, { uri: string; error: string }>();
  for (
    let attempt = 1;
    attempt <= 2 && loaded.size < assetSpecs.length;
    attempt += 1
  ) {
    const pending = assetSpecs.filter(({ name }) => !loaded.has(name));
    const results = await Promise.allSettled(
      pending.map(async (spec) => {
        const asset = Asset.fromModule(spec.module);
        const remoteUri = asset.uri;
        try {
          const base64 = await withEditorFontAssetTimeout(
            (async () => {
              await asset.downloadAsync();
              const readableUri = asset.localUri ?? asset.uri;
              return FileSystem.readAsStringAsync(readableUri, {
                encoding: "base64",
              });
            })(),
            spec.name,
          );
          return { spec, asset, base64 };
        } catch (error) {
          throw {
            spec,
            uri: remoteUri,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    results.forEach((result, index) => {
      const spec = pending[index];
      if (result.status === "fulfilled") {
        loaded.set(spec.name, {
          asset: result.value.asset,
          base64: result.value.base64,
        });
        failures.delete(spec.name);
      } else {
        const reason = result.reason as
          | { uri?: string; error?: string }
          | undefined;
        failures.set(spec.name, {
          uri: reason?.uri ?? Asset.fromModule(spec.module).uri,
          error: reason?.error ?? String(result.reason),
        });
        console.warn("[editorFonts] Native font asset attempt failed", {
          ...diagnosticContext,
          attempt,
          name: spec.name,
          path: spec.path,
          uri: reason?.uri ?? Asset.fromModule(spec.module).uri,
          error: reason?.error ?? String(result.reason),
        });
      }
    });
    if (loaded.size < assetSpecs.length && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  try {
    if (loaded.size !== assetSpecs.length) {
      throw new Error(
        `Failed assets: ${assetSpecs
          .filter(({ name }) => !loaded.has(name))
          .map(({ name }) => name)
          .join(", ")}`,
      );
    }
    const [regular, semiBold, notoRegular, notoSemiBold] =
      BODY_FONT_ASSET_NAMES.map((name) => loaded.get(name)!.base64);
    setEditorFonts(regular, semiBold, notoRegular, notoSemiBold);
    console.info("[editorFonts] Native body-font assets loaded", {
      ...diagnosticContext,
      loadedAssets: [
        ...BODY_FONT_ASSET_NAMES.map((name) => loaded.get(name)!.asset),
      ].map((asset, index) => ({
        name: assetSpecs[index].name,
        type: asset.type,
        hasLocalUri: Boolean(asset.localUri),
        hasUri: Boolean(asset.uri),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notoRegular = loaded.get(BODY_FONT_ASSET_NAMES[2])?.base64;
    const notoSemiBold = loaded.get(BODY_FONT_ASSET_NAMES[3])?.base64;
    reportNativeBodyFontReady(false);
    if (notoRegular && notoSemiBold) {
      setEditorFontFallback(notoRegular, notoSemiBold, message);
    } else {
      setEditorFontsError(message);
    }
    console.error("[editorFonts] Failed to load editor fonts:", {
      ...diagnosticContext,
      error: message,
      failedAssets: assetSpecs
        .filter(({ name }) => !loaded.has(name))
        .map(({ name, path }) => ({
          name,
          path,
          uri: failures.get(name)?.uri ?? "unknown",
          error: failures.get(name)?.error ?? "unknown",
        })),
      fallback:
        notoRegular && notoSemiBold
          ? "session-wide-noto-serif-kr"
          : "embedded-noto-unavailable",
      hint:
        diagnosticContext.serverContractVersion !== BODY_FONT_CONFIG_VERSION
          ? "Dev server font contract differs from the running app bundle."
          : "Check the four WOFF2 asset modules and restart the matching Metro server.",
    });
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

  // Register the Android letter-arrived notification channel on startup.
  // The channel must exist before any notification with this channelId is
  // delivered; creating it multiple times is idempotent.
  // Channel id must match the one the server sends with (pushSender.ts).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const Notifications = getNotificationsModule();
    if (!Notifications) return;
    Notifications.setNotificationChannelAsync("letter-arrived", {
      name: "편지 도착 알림",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
      enableLights: true,
      enableVibrate: true,
    }).catch((err) => {
      console.warn("[notifications] setNotificationChannelAsync failed:", err);
    });
    // Remove the old silent channel from installs that created it before
    // this change; Android doesn't let us mutate an existing channel's
    // importance, which is why the new behavior uses a different channel id.
    Notifications.deleteNotificationChannelAsync("letter-arrived-silent").catch(
      () => {},
    );
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
    "Eulyoo1945-Regular": require("../assets/fonts/Eulyoo1945-Regular-Body.otf"),
    "Eulyoo1945-SemiBold": require("../assets/fonts/Eulyoo1945-SemiBold-Body.otf"),
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

  const startupReady = fontsLoaded || fontError || fontLoadTimedOut;

  useEffect(() => {
    if (startupReady) {
      // Guard: SplashScreen.hideAsync() is a TurboModule call; a failure here
      // should not leave the app stuck on the splash screen indefinitely.
      SplashScreen.hideAsync().catch((err) => {
        console.warn("[SplashScreen] hideAsync failed:", err);
      });
    }
  }, [startupReady]);

  const loadingView = (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={Colors.zinc400} />
      <Text style={styles.loadingLabel}>앱을 준비하고 있어요</Text>
    </View>
  );

  const appTree = (
    <SafeAreaProvider>
      {Platform.OS === "web"
        ? React.createElement(
            "style",
            {},
            `input,textarea{caret-color:${Colors.cursorAccent}}`,
          )
        : null}
      <ErrorBoundary>
        {/* Keep authenticated disk persistence disabled until its storage key
            and hydrated queries are scoped to the resolved user identity.
            In-memory caching and NetInfo reconnect behavior remain active. */}
        <QueryClientProvider client={queryClient}>
          {startupReady ? (
            <GestureHandlerRootView>
              <AuthProvider>
                <ActiveReadingProvider>
                  <ToastProvider>
                    <ThoughtComposerProvider>
                      <NavigationProvider>
                        <ReaderTransitionProvider>
                          <AuthGuard />
                          <ToastContainer />
                          <ServerVersionGate />
                        </ReaderTransitionProvider>
                      </NavigationProvider>
                    </ThoughtComposerProvider>
                  </ToastProvider>
                </ActiveReadingProvider>
              </AuthProvider>
            </GestureHandlerRootView>
          ) : (
            loadingView
          )}
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

const EDITOR_FONT_ASSET_ATTEMPT_TIMEOUT_MS = 15_000;

function withEditorFontAssetTimeout<T>(
  operation: Promise<T>,
  assetName: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${assetName} timed out after ${EDITOR_FONT_ASSET_ATTEMPT_TIMEOUT_MS}ms`,
        ),
      );
    }, EDITOR_FONT_ASSET_ATTEMPT_TIMEOUT_MS);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
