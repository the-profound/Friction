import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import ToastContainer from "@/components/Toast/Toast";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { UserProvider } from "@/contexts/UserContext";
import { ActiveReadingProvider, useActiveReading } from "@/contexts/ActiveReadingContext";

// Prevent the splash screen from auto-hiding before asset loading is complete.
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

function RootLayoutNav() {
  return (
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
        <Stack.Screen name="login" options={{ presentation: "card" }} />
      </Stack>
    </ActiveReadingGuard>
  );
}

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
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
