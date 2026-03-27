import { Tabs } from "expo-router";
import React from "react";

import { NavBar } from "@/components/NavBar/NavBar";
import { MiniSubTabBar } from "@/components/NavBar/MiniSubTabBar";

export default function TabLayout() {
  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: "none" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "수신함" }} />
        <Tabs.Screen name="on" options={{ title: "기록함" }} />
        <Tabs.Screen name="of" options={{ title: "보관함" }} />
        <Tabs.Screen name="to" options={{ title: "발신함" }} />
      </Tabs>
      <MiniSubTabBar />
      <NavBar />
    </>
  );
}
