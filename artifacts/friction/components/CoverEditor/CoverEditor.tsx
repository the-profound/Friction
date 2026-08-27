import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Colors, ReaderTokens, Typography, Spacing } from "../../constants/tokens";
import BottomSheet from "../BottomSheet/BottomSheet";
import CoverPreview from "../CoverPreview/CoverPreview";
import type {
  ArticleCover,
  ArticleCoverFontFamily,
  ArticleCoverType,
} from "@workspace/api-client-react";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

const COVER_TYPES: { key: ArticleCoverType; label: string; icon: FeatherIconName }[] = [
  { key: "default", label: "기본", icon: "layout" },
  { key: "color", label: "단색", icon: "droplet" },
];

const COVER_FONTS: {
  key: ArticleCoverFontFamily;
  label: string;
  sample: string;
}[] = [
  { key: "sans", label: "고딕", sample: "가나다" },
  { key: "serif", label: "세리프", sample: "가나다" },
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
  const insets = useSafeAreaInsets();
  const [local, setLocal] = useState<ArticleCover>(cover);
  const localRef = useRef(local);
  localRef.current = local;

  useEffect(() => {
    if (visible) {
      setLocal(cover);
    }
  }, [visible]);

  const update = useCallback(
    (patch: Partial<ArticleCover>) => {
      const next = { ...localRef.current, ...patch };
      setLocal(next);
      onChange(next);
    },
    [onChange],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={[0.75, 0.9]}
    >
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.previewWrapper}>
          <CoverPreview cover={local} title={title} author={author} compact />
        </View>

        <Text style={styles.sectionLabel}>표지 타입</Text>
        <View style={styles.chipRow}>
          {COVER_TYPES.map((t) => (
            <ScalePressable
              key={t.key}
              style={styles.typeChip}
              onPress={() => update({ type: t.key })}
              contentStyle={[
                styles.typeChipContent,
                local.type === t.key && styles.typeChipActive,
              ]}
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
            </ScalePressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>서체</Text>
        <View style={styles.chipRow}>
          {COVER_FONTS.map((font) => {
            const isActive = (local.fontFamily ?? "sans") === font.key;
            return (
              <ScalePressable
                key={font.key}
                style={styles.fontChip}
                onPress={() => update({ fontFamily: font.key })}
                accessibilityRole="button"
                accessibilityLabel={`${font.label} 서체`}
                accessibilityState={{ selected: isActive }}
                contentStyle={[
                  styles.fontChipContent,
                  isActive && styles.typeChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.fontSample,
                    isActive && styles.typeChipLabelActive,
                    {
                      fontFamily:
                        font.key === "serif"
                          ? ReaderTokens.fontFamily.serifBold
                          : ReaderTokens.fontFamily.sansSemiBold,
                    },
                  ]}
                >
                  {font.sample}
                </Text>
                <Text
                  style={[
                    styles.typeChipLabel,
                    isActive && styles.typeChipLabelActive,
                  ]}
                >
                  {font.label}
                </Text>
              </ScalePressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>텍스트 색상</Text>
        <View style={styles.colorRow}>
          {TEXT_COLORS.map((c) => (
            <ScalePressable
              key={c.key}
              style={styles.colorChip}
              onPress={() => update({ textColor: c.color })}
              contentStyle={[
                styles.colorChipContent,
                { backgroundColor: c.color },
                LIGHT_COLORS.has(c.color) && styles.colorChipLight,
                local.textColor === c.color && styles.colorChipActive,
              ]}
            >
              {local.textColor === c.color && (
                <Feather
                  name="check"
                  size={14}
                  color={LIGHT_COLORS.has(c.color) ? Colors.zinc700 : Colors.white}
                />
              )}
            </ScalePressable>
          ))}
        </View>

        {local.type === "color" && (
          <>
            <Text style={styles.sectionLabel}>배경 색상</Text>
            <View style={styles.colorRow}>
              {BG_COLORS.map((c) => (
                <ScalePressable
                  key={c.key}
                  style={styles.colorChip}
                  onPress={() => update({ bgColor: c.color })}
                  contentStyle={[
                    styles.colorChipContent,
                    { backgroundColor: c.color },
                    LIGHT_COLORS.has(c.color) && styles.colorChipLight,
                    local.bgColor === c.color && styles.colorChipActive,
                  ]}
                >
                  {local.bgColor === c.color && (
                    <Feather
                      name="check"
                      size={14}
                      color={LIGHT_COLORS.has(c.color) ? Colors.zinc700 : Colors.white}
                    />
                  )}
                </ScalePressable>
              ))}
            </View>
          </>
        )}

        <View style={{ height: insets.bottom + 120 }} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 0,
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
    flexGrow: 0,
    flexShrink: 0,
  },
  typeChipContent: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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
  fontChip: {
    height: 40,
    alignSelf: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
  },
  fontChipContent: {
    height: 40,
    minWidth: 86,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: Colors.zinc100,
  },
  fontSample: {
    fontSize: 13,
    color: Colors.zinc600,
  },
  colorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  colorChip: {
    width: 36,
    height: 36,
  },
  colorChipContent: {
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
});
