import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "@/constants/tokens";

export default function SendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);

  const canSend = selectedLetter && selectedRecipient;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={Colors.zinc600} />
        </Pressable>
        <Text style={styles.headerTitle}>보내기</Text>
        <View style={{ width: 20 }} />
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>편지 선택</Text>
          <Pressable style={styles.selectButton} onPress={() => Alert.alert("편지 선택", "편지 선택 기능은 준비 중입니다.")}>
            <Feather name="file-text" size={18} color={Colors.zinc500} />
            <Text style={styles.selectButtonText}>
              {selectedLetter || "보낼 편지를 선택하세요"}
            </Text>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </Pressable>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>받는 사람</Text>
          <Pressable style={styles.selectButton} onPress={() => Alert.alert("받는 사람", "받는 사람 선택 기능은 준비 중입니다.")}>
            <Feather name="user" size={18} color={Colors.zinc500} />
            <Text style={styles.selectButtonText}>
              {selectedRecipient || "받는 사람을 선택하세요"}
            </Text>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </Pressable>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>모음 선택</Text>
          <Pressable style={styles.selectButton} onPress={() => Alert.alert("모음 선택", "모음 선택 기능은 준비 중입니다.")}>
            <Feather name="folder" size={18} color={Colors.zinc500} />
            <Text style={styles.selectButtonText}>
              {selectedCollection || "편지를 담을 모음을 선택하세요"}
            </Text>
            <Feather name="chevron-right" size={18} color={Colors.zinc400} />
          </Pressable>
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          disabled={!canSend}
          onPress={() => Alert.alert("보내기", "보내기 기능은 준비 중입니다.")}
        >
          <Feather name="send" size={16} color={canSend ? Colors.white : Colors.zinc400} />
          <Text style={[styles.sendButtonText, !canSend && styles.sendButtonTextDisabled]}>
            보내기
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.screenPx,
    paddingVertical: 12,
  },
  headerTitle: {
    ...Typography.bodySemiBold,
    fontSize: 17,
    color: Colors.zinc900,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 16,
    gap: 24,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    ...Typography.bodySemiBold,
    fontSize: 15,
    color: Colors.zinc900,
  },
  selectButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.zinc50,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  selectButtonText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc500,
    flex: 1,
  },
  footer: {
    paddingHorizontal: Spacing.screenPx,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc100,
  },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.zinc900,
    paddingVertical: 16,
    borderRadius: 12,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.zinc100,
  },
  sendButtonText: {
    ...Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.white,
  },
  sendButtonTextDisabled: {
    color: Colors.zinc400,
  },
});
