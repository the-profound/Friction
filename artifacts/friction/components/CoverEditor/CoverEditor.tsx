import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Image } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Colors, Typography, Spacing } from "../../constants/tokens";
import BottomSheet from "../BottomSheet/BottomSheet";
import CoverPreview from "../CoverPreview/CoverPreview";
import { getDefaultCover } from "../../utils/articleCover";
import { useImageUpload } from "../../lib/useImageUpload";
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
  articleId: string;
}

export default function CoverEditor({
  visible,
  onClose,
  cover,
  onChange,
  title,
  author,
  articleId,
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

  const { pickAndUpload, isUploading } = useImageUpload({
    articleId,
    onSuccess: (imageUrl) => {
      update({ type: "image", imageUrl });
    },
    onError: (err) => {
      Alert.alert("업로드 실패", err.message);
    },
  });

  const handleRemoveImage = useCallback(() => {
    update({ type: "default", imageUrl: undefined });
  }, [update]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="표지 설정"
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
              style={[
                styles.typeChip,
                local.type === t.key && styles.typeChipActive,
              ]}
              onPress={() => update({ type: t.key })}
            contentStyle={styles.typeChipContent}
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

        <Text style={styles.sectionLabel}>텍스트 정렬</Text>
        <View style={styles.chipRow}>
          {TEXT_ALIGNS.map((a) => (
            <ScalePressable
              key={a.key}
              style={[
                styles.alignChip,
                local.align === a.key && styles.alignChipActive,
              ]}
              onPress={() => update({ align: a.key })}
            contentStyle={styles.alignChipContent}
            >
              <Feather
                name={a.icon}
                size={18}
                color={local.align === a.key ? Colors.zinc900 : Colors.zinc400}
              />
            </ScalePressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>텍스트 색상</Text>
        <View style={styles.colorRow}>
          {TEXT_COLORS.map((c) => (
            <ScalePressable
              key={c.key}
              style={[
                styles.colorChip,
                { backgroundColor: c.color },
                LIGHT_COLORS.has(c.color) && styles.colorChipLight,
                local.textColor === c.color && styles.colorChipActive,
              ]}
              onPress={() => update({ textColor: c.color })}
            contentStyle={styles.colorChipContent}
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
                  style={[
                    styles.colorChip,
                    { backgroundColor: c.color },
                    LIGHT_COLORS.has(c.color) && styles.colorChipLight,
                    local.bgColor === c.color && styles.colorChipActive,
                  ]}
                  onPress={() => update({ bgColor: c.color })}
                contentStyle={styles.colorChipContent}
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

        {local.type === "image" && (
          <View style={styles.imageSection}>
            {local.imageUrl ? (
              <>
                <Image
                  source={{ uri: local.imageUrl }}
                  style={styles.imageThumbnail}
                  resizeMode="cover"
                />
                <View style={styles.imageActions}>
                  <ScalePressable
                    style={[styles.imageButton, styles.imageButtonSecondary]}
                    onPress={pickAndUpload}
                    disabled={isUploading}
                  contentStyle={styles.imageButtonContent}
                  >
                    {isUploading ? (
                      <ActivityIndicator size="small" color={Colors.zinc600} />
                    ) : (
                      <Feather name="refresh-cw" size={15} color={Colors.zinc600} />
                    )}
                    <Text style={styles.imageButtonSecondaryLabel}>
                      {isUploading ? "업로드 중..." : "이미지 변경"}
                    </Text>
                  </ScalePressable>
                  <ScalePressable
                    style={[styles.imageButton, styles.imageButtonDanger]}
                    onPress={handleRemoveImage}
                    disabled={isUploading}
                  contentStyle={styles.imageButtonContent}
                  >
                    <Feather name="trash-2" size={15} color="#dc2626" />
                    <Text style={styles.imageButtonDangerLabel}>이미지 제거</Text>
                  </ScalePressable>
                </View>
              </>
            ) : (
              <ScalePressable
                style={[styles.imagePickerButton, isUploading && styles.imagePickerButtonDisabled]}
                onPress={pickAndUpload}
                disabled={isUploading}
              contentStyle={styles.imagePickerButtonContent}
              >
                {isUploading ? (
                  <ActivityIndicator size="small" color={Colors.zinc600} />
                ) : (
                  <Feather name="upload" size={20} color={Colors.zinc500} />
                )}
                <Text style={styles.imagePickerLabel}>
                  {isUploading ? "업로드 중..." : "사진 선택"}
                </Text>
                {!isUploading && (
                  <Text style={styles.imagePickerHint}>카메라 롤에서 사진을 선택합니다</Text>
                )}
              </ScalePressable>
            )}
          </View>
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
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.zinc100,
  },
  typeChipContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,},
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
  },
  alignChipContent: {
    alignItems: "center",
    justifyContent: "center",},
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
  },
  colorChipContent: {
    alignItems: "center",
    justifyContent: "center",},
  colorChipLight: {
    borderWidth: 1,
    borderColor: Colors.zinc200,
  },
  colorChipActive: {
    borderWidth: 2,
    borderColor: Colors.zinc700,
  },
  imageSection: {
    marginTop: 16,
    gap: 12,
  },
  imagePickerButton: {
    borderWidth: 1,
    borderColor: Colors.zinc200,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 20,
    backgroundColor: Colors.zinc50,
  },
  imagePickerButtonContent: {
    alignItems: "center",
    gap: 8,},
  imagePickerButtonDisabled: {
    opacity: 0.6,
  },
  imagePickerLabel: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc700,
  },
  imagePickerHint: {
    ...Typography.caption,
    fontSize: 12,
    color: Colors.zinc400,
  },
  imageThumbnail: {
    width: "100%",
    height: 160,
    borderRadius: 10,
    backgroundColor: Colors.zinc100,
  },
  imageActions: {
    flexDirection: "row",
    gap: 10,
  },
  imageButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
  },
  imageButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,},
  imageButtonSecondary: {
    backgroundColor: Colors.zinc100,
  },
  imageButtonSecondaryLabel: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.zinc600,
  },
  imageButtonDanger: {
    backgroundColor: "#fef2f2",
  },
  imageButtonDangerLabel: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: "#dc2626",
  },
});
