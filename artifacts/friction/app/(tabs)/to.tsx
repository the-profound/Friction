import React from "react";
import { View, StyleSheet } from "react-native";
import { Colors } from "@/constants/tokens";

export default function MyScreen() {
  return <View style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
});
