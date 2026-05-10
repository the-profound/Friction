import { Tabs } from "expo-router";
import React from "react";

import { NavBar } from "@/components/NavBar/NavBar";

export default function TabLayout() {
  return (
    <>
      <Tabs
        initialRouteName="on"
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: "none" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "수신함" }} />
        <Tabs.Screen name="of" options={{ title: "단체 모음" }} />
        <Tabs.Screen name="on" options={{ title: "기록함" }} />
        <Tabs.Screen name="archive" options={{ title: "보관함" }} />
        <Tabs.Screen name="to" options={{ title: "발신함" }} />
      </Tabs>
      <NavBar />
    </>
  );
}
