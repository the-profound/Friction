import { Tabs } from "expo-router";
import React from "react";

import { NavBar } from "@/components/NavBar/NavBar";
import { useUser } from "@/contexts/UserContext";

export default function TabLayout() {
  useUser();

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
    </>
  );
}
