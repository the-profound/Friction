import { View, StyleSheet, Platform } from "react-native";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import NotepadSwipe from "@/components/NotepadSwipe/NotepadSwipe";

export default function NotepadScreen() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <Stack.Screen
        options={{
          title: "노트패드",
          headerShown: true,
          headerBackTitle: "뒤로",
          headerStyle: { backgroundColor: "#e8e8e8" },
          headerShadowVisible: false,
          headerTintColor: "#3f3f46",
        }}
      />
      <NotepadSwipe />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#e8e8e8",
  },
});
