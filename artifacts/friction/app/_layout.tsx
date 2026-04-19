import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, usePathname, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import ToastContainer from "@/components/Toast/Toast";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { UserProvider } from "@/contexts/UserContext";
import { ActiveReadingProvider, useActiveReading } from "@/contexts/ActiveReadingContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { setBaseUrl } from "@workspace/api-client-react";
import { Colors } from "@/constants/tokens";

if (process.env.EXPO_PUBLIC_DOMAIN) {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const baseUrl = domain.startsWith("http://") || domain.startsWith("https://")
    ? domain
    : `https://${domain}`;
  setBaseUrl(baseUrl);
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

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

  useEffect(() => {
    if (isLoading) return;

    if (!session && !inBypassRoute) {
      router.replace("/login");
    } else if (session && segments[0] === "login") {
      router.replace("/(tabs)");
    }
  }, [session, isLoading, inBypassRoute, segments, router]);

  // Block rendering while auth state is resolving
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.zinc400} />
      </View>
    );
  }

  // Block rendering protected routes while redirecting to login
  if (!session && !inBypassRoute) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.zinc400} />
      </View>
    );
  }

  return <>{children}</>;
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
          <Stack.Screen name="to-01" />
          <Stack.Screen name="to-02" />
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

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
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
                <UserProvider>
                  <ActiveReadingProvider>
                    <ToastProvider>
                      <NavigationProvider>
                        <RootLayoutNav />
                        <ToastContainer />
                      </NavigationProvider>
                    </ToastProvider>
                  </ActiveReadingProvider>
                </UserProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
