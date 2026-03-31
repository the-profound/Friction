import React, { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "../../constants/tokens";
import BottomSheet from "../BottomSheet/BottomSheet";
import CoverPreview from "../CoverPreview/CoverPreview";
import { getDefaultCover } from "../../utils/articleCover";
import type {
  ArticleCover,
  ArticleCoverType,
  ArticleCoverAlign,
} from "@workspace/api-client-react";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

const COVER_TYPES: { key: ArticleCoverType; label: string; icon: FeatherIconName }[] = [
  { key: "default", label: "기본", icon: "layout" },
  { key: "color", label: "단색", icon: "droplet" },
  { key: "image", label: "이미지", icon: "image" },
];

const TEXT_ALIGNS: { key: ArticleCoverAlign; label: string; icon: FeatherIconName }[] = [
  { key: "left", label: "왼쪽", icon: "align-left" },
  { key: "center", label: "가운데", icon: "align-center" },
];

const BG_COLORS = [
  { key: "zinc50", color: "#fafafa" },
  { key: "warm", color: "#FEF3C7" },
  { key: "cool", color: "#DBEAFE" },
  { key: "nature", color: "#D1FAE5" },
  { key: "soft", color: "#FCE7F3" },
  { key: "lavender", color: "#EDE9FE" },
  { key: "peach", color: "#FFEDD5" },
  { key: "slate", color: "#CBD5E1" },
  { key: "dark", color: "#27272a" },
  { key: "black", color: "#18181b" },
];

const TEXT_COLORS = [
  { key: "dark", color: "#18181b" },
  { key: "zinc700", color: "#3f3f46" },
  { key: "zinc500", color: "#71717a" },
  { key: "white", color: "#FFFFFF" },
  { key: "warm", color: "#92400E" },
  { key: "cool", color: "#1E40AF" },
  { key: "nature", color: "#065F46" },
  { key: "rose", color: "#9F1239" },
];

const LIGHT_COLORS = new Set([
  "#fafafa", "#FEF3C7", "#DBEAFE", "#D1FAE5", "#FCE7F3",
  "#EDE9FE", "#FFEDD5", "#CBD5E1", "#FFFFFF",
]);

interface CoverEditorProps {
  visible: boolean;
  onClose: () => void;
  cover: ArticleCover;
  onChange: (cover: ArticleCover) => void;
  title: string;
  author?: string;
}

export default function CoverEditor({
  visible,
  onClose,
  cover,
  onChange,
  title,
  author,
}: CoverEditorProps) {
  const [local, setLocal] = useState<ArticleCover>(cover);

  useEffect(() => {
    if (visible) {
      setLocal(cover);
    }
  }, [visible]);

  const update = useCallback(
    (patch: Partial<ArticleCover>) => {
      setLocal((prev) => {
        const next = { ...prev, ...patch };
        onChange(next);
        return next;
      });
    },
    [onChange],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="표지 설정"
      snapPoints={[0.75, 0.9]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.previewWrapper}>
          <CoverPreview cover={local} title={title} author={author} compact />
        </View>

        <Text style={styles.sectionLabel}>표지 타입</Text>
        <View style={styles.chipRow}>
          {COVER_TYPES.map((t) => (
            <Pressable
              key={t.key}
              style={[
                styles.typeChip,
                local.type === t.key && styles.typeChipActive,
              ]}
              onPress={() => update({ type: t.key })}
            >
              <Feather
                name={t.icon}
                size={16}
                color={local.type === t.key ? Colors.white : Colors.zinc600}
              />
              <Text
                style={[
                  styles.typeChipLabel,
                  local.type === t.key && styles.typeChipLabelActive,
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>텍스트 정렬</Text>
        <View style={styles.chipRow}>
          {TEXT_ALIGNS.map((a) => (
            <Pressable
              key={a.key}
              style={[
                styles.alignChip,
                local.align === a.key && styles.alignChipActive,
              ]}
              onPress={() => update({ align: a.key })}
            >
              <Feather
                name={a.icon}
                size={18}
                color={local.align === a.key ? Colors.zinc900 : Colors.zinc400}
              />
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>텍스트 색상</Text>
        <View style={styles.colorRow}>
          {TEXT_COLORS.map((c) => (
            <Pressable
              key={c.key}
              style={[
                styles.colorChip,
                { backgroundColor: c.color },
                LIGHT_COLORS.has(c.color) && styles.colorChipLight,
                local.textColor === c.color && styles.colorChipActive,
              ]}
              onPress={() => update({ textColor: c.color })}
            >
              {local.textColor === c.color && (
                <Feather
                  name="check"
                  size={14}
                  color={LIGHT_COLORS.has(c.color) ? Colors.zinc700 : Colors.white}
                />
              )}
            </Pressable>
          ))}
        </View>

        {local.type === "color" && (
          <>
            <Text style={styles.sectionLabel}>배경 색상</Text>
            <View style={styles.colorRow}>
              {BG_COLORS.map((c) => (
                <Pressable
                  key={c.key}
                  style={[
                    styles.colorChip,
                    { backgroundColor: c.color },
                    LIGHT_COLORS.has(c.color) && styles.colorChipLight,
                    local.bgColor === c.color && styles.colorChipActive,
                  ]}
                  onPress={() => update({ bgColor: c.color })}
                >
                  {local.bgColor === c.color && (
                    <Feather
                      name="check"
                      size={14}
                      color={LIGHT_COLORS.has(c.color) ? Colors.zinc700 : Colors.white}
                    />
                  )}
                </Pressable>
              ))}
            </View>
          </>
        )}

        {local.type === "image" && (
          <View style={styles.imageNote}>
            <Feather name="info" size={14} color={Colors.zinc400} />
            <Text style={styles.imageNoteText}>
              이미지 업로드는 추후 지원 예정입니다.
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 20,
  },
  previewWrapper: {
    alignItems: "center",
    marginBottom: 20,
    paddingHorizontal: 40,
  },
  sectionLabel: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    marginBottom: 8,
    marginTop: 16,
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
  },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc100,
  },
  typeChipActive: {
    backgroundColor: Colors.zinc900,
  },
  typeChipLabel: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc600,
  },
  typeChipLabelActive: {
    color: Colors.white,
  },
  alignChip: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.zinc100,
    alignItems: "center",
    justifyContent: "center",
  },
  alignChipActive: {
    backgroundColor: Colors.zinc200,
    borderWidth: 2,
    borderColor: Colors.zinc700,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  colorChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  colorChipLight: {
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  colorChipActive: {
    borderWidth: 2,
    borderColor: Colors.zinc700,
  },
  imageNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    padding: 12,
    backgroundColor: Colors.zinc50,
    borderRadius: 10,
  },
  imageNoteText: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc500,
    flex: 1,
  },
});
