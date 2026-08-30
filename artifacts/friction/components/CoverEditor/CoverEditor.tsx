import React, { useState, useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, View, Text, StyleSheet, ScrollView } from "react-native";
import ScalePressable from "@/components/shared/ScalePressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Colors, ReaderTokens, Typography, Spacing } from "../../constants/tokens";
import BottomSheet from "../BottomSheet/BottomSheet";
import CoverPreview from "../CoverPreview/CoverPreview";
import ColorPicker from "../ColorPicker/ColorPicker";
import { resolveArticleCover } from "../../utils/articleCover";
import {
  CoverPhotoPickerError,
  pickCoverPhoto,
  type SelectedCoverPhoto,
} from "../../lib/coverPhotoPicker";
import {
  CoverPhotoUploadError,
  uploadCoverPhoto,
} from "../../lib/coverPhotoUpload";
import type {
  ArticleCover,
  ArticleCoverFontFamily,
  ArticleCoverType,
} from "@workspace/api-client-react";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

const COVER_TYPES: { key: ArticleCoverType; label: string; icon: FeatherIconName }[] = [
  { key: "default", label: "기본", icon: "layout" },
  { key: "color", label: "단색", icon: "droplet" },
  { key: "image", label: "사진", icon: "image" },
];

const COVER_FONTS: {
  key: ArticleCoverFontFamily;
  label: string;
  sample: string;
}[] = [
  { key: "sans", label: "고딕", sample: "가나다" },
  { key: "serif", label: "세리프", sample: "가나다" },
];

interface CoverEditorProps {
  visible: boolean;
  onClose: () => void;
  cover: ArticleCover;
  onChange: (cover: ArticleCover) => void;
  title: string;
  author?: string;
  articleId: string;
  onPhotoOperationStateChange?: (active: boolean) => void;
  onCommitPhotoCover: (cover: ArticleCover) => Promise<void>;
}

export default function CoverEditor({
  visible,
  onClose,
  cover,
  onChange,
  title,
  author,
  articleId,
  onPhotoOperationStateChange,
  onCommitPhotoCover,
}: CoverEditorProps) {
  const insets = useSafeAreaInsets();
  const [local, setLocal] = useState<ArticleCover>(() => resolveArticleCover(cover));
  const localRef = useRef(local);
  localRef.current = local;
  const [photoPanelVisible, setPhotoPanelVisible] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isSelectingPhoto, setIsSelectingPhoto] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const photoOperationInProgressRef = useRef(false);
  const retryPhotoRef = useRef<SelectedCoverPhoto | null>(null);
  const retryUploadedImageUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (visible) {
      const next = resolveArticleCover(cover);
      setLocal(next);
      localRef.current = next;
      setPhotoPanelVisible(next.type === "image");
      setPhotoError(null);
      retryPhotoRef.current = null;
      retryUploadedImageUrlRef.current = null;
      if (
        next.textColor !== cover.textColor ||
        next.bgColor !== cover.bgColor
      ) {
        onChange(next);
      }
    }
  }, [visible]);

  const update = useCallback(
    (patch: Partial<ArticleCover>) => {
      if (photoOperationInProgressRef.current) return;
      const next = { ...localRef.current, ...patch };
      setLocal(next);
      onChange(next);
    },
    [onChange],
  );

  const setUploading = useCallback(
    (uploading: boolean) => {
      setIsUploading(uploading);
    },
    [],
  );

  useEffect(
    () => () => {
      onPhotoOperationStateChange?.(false);
    },
    [onPhotoOperationStateChange],
  );

  const uploadSelectedPhoto = useCallback(
    async (photo: SelectedCoverPhoto) => {
      retryPhotoRef.current = photo;
      setPhotoPanelVisible(true);
      setPhotoError(null);
      setUploading(true);
      try {
        const imageUrl =
          retryUploadedImageUrlRef.current ??
          await uploadCoverPhoto(articleId, photo);
        retryUploadedImageUrlRef.current = imageUrl;
        const next = { ...localRef.current, type: "image" as const, imageUrl };
        try {
          await onCommitPhotoCover(next);
        } catch {
          throw new Error("사진 표지를 저장하지 못했어요. 다시 시도해주세요.");
        }
        localRef.current = next;
        setLocal(next);
        retryPhotoRef.current = null;
        retryUploadedImageUrlRef.current = null;
      } catch (error) {
        const message =
          error instanceof CoverPhotoUploadError
            ? error.message
            : error instanceof Error
              ? error.message
            : "사진 업로드에 실패했어요. 다시 시도해주세요.";
        setPhotoError(message);
      } finally {
        setUploading(false);
      }
    },
    [articleId, onCommitPhotoCover, setUploading],
  );

  const selectPhoto = useCallback(async () => {
    if (photoOperationInProgressRef.current) return;
    photoOperationInProgressRef.current = true;
    onPhotoOperationStateChange?.(true);
    setIsSelectingPhoto(true);
    setPhotoPanelVisible(true);
    setPhotoError(null);
    try {
      const selection = await pickCoverPhoto();
      if (!selection) return;
      retryUploadedImageUrlRef.current = null;
      await uploadSelectedPhoto(selection);
    } catch (error) {
      const message =
        error instanceof CoverPhotoPickerError
          ? error.message
          : "사진을 선택하지 못했어요. 다시 시도해주세요.";
      setPhotoError(message);
    } finally {
      photoOperationInProgressRef.current = false;
      onPhotoOperationStateChange?.(false);
      setIsSelectingPhoto(false);
    }
  }, [onPhotoOperationStateChange, uploadSelectedPhoto]);

  const handleTypePress = useCallback(
    (type: ArticleCoverType) => {
      if (photoOperationInProgressRef.current) return;
      if (type === "image") {
        setPhotoPanelVisible(true);
        if (localRef.current.imageUrl) {
          update({ type: "image" });
        } else {
          // Selecting the type only reveals the in-editor action. Keep the
          // persisted cover untouched until the user explicitly chooses a
          // photo and the upload/commit completes.
          const next = { ...localRef.current, type: "image" as const };
          localRef.current = next;
          setLocal(next);
        }
        return;
      }
      setPhotoPanelVisible(false);
      setPhotoError(null);
      retryPhotoRef.current = null;
      retryUploadedImageUrlRef.current = null;
      update({ type });
    },
    [selectPhoto, update],
  );

  const retryUpload = useCallback(async () => {
    if (photoOperationInProgressRef.current) return;
    const photo = retryPhotoRef.current;
    if (photo) {
      photoOperationInProgressRef.current = true;
      onPhotoOperationStateChange?.(true);
      try {
        await uploadSelectedPhoto(photo);
      } finally {
        photoOperationInProgressRef.current = false;
        onPhotoOperationStateChange?.(false);
      }
    } else {
      await selectPhoto();
    }
  }, [onPhotoOperationStateChange, selectPhoto, uploadSelectedPhoto]);

  const isPhotoBusy = isSelectingPhoto || isUploading;

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
              onPress={() => handleTypePress(t.key)}
              disabled={isPhotoBusy}
              accessibilityRole="button"
              accessibilityLabel={`${t.label} 표지`}
              accessibilityState={{
                selected: local.type === t.key,
                disabled: isPhotoBusy,
                busy: t.key === "image" && isPhotoBusy,
              }}
              contentStyle={[
                styles.typeChipContent,
                local.type === t.key && styles.typeChipActive,
                isPhotoBusy && styles.controlDisabled,
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

        {(photoPanelVisible || local.type === "image") && (
          <View style={styles.photoSection}>
            <ScalePressable
              style={styles.photoButton}
              contentStyle={[
                styles.photoButtonContent,
                isPhotoBusy && styles.controlDisabled,
              ]}
              onPress={selectPhoto}
              disabled={isPhotoBusy}
              accessibilityRole="button"
              accessibilityLabel={local.imageUrl ? "표지 사진 변경" : "표지 사진 선택"}
              accessibilityState={{ disabled: isPhotoBusy, busy: isPhotoBusy }}
            >
              {isUploading ? (
                <ActivityIndicator size="small" color={Colors.zinc600} />
              ) : (
                <Feather name="image" size={16} color={Colors.zinc700} />
              )}
              <Text style={styles.photoButtonLabel}>
                {isUploading
                  ? "업로드 중..."
                  : isSelectingPhoto
                    ? "사진 선택 중..."
                  : local.imageUrl
                    ? "이미지 변경"
                    : "사진 선택"}
              </Text>
            </ScalePressable>
            {photoError ? (
              <View style={styles.photoErrorBox} accessibilityLiveRegion="polite">
                <Text style={styles.photoErrorText}>{photoError}</Text>
                <ScalePressable
                  style={styles.retryButton}
                  contentStyle={styles.retryButtonContent}
                  onPress={() => void retryUpload()}
                  disabled={isPhotoBusy}
                  accessibilityRole="button"
                  accessibilityLabel="사진 업로드 다시 시도"
                  accessibilityState={{ disabled: isPhotoBusy, busy: isPhotoBusy }}
                >
                  <Text style={styles.retryButtonLabel}>다시 시도</Text>
                </ScalePressable>
              </View>
            ) : null}
          </View>
        )}

        <Text style={styles.sectionLabel}>서체</Text>
        <View style={styles.chipRow}>
          {COVER_FONTS.map((font) => {
            const isActive = (local.fontFamily ?? "sans") === font.key;
            return (
              <ScalePressable
                key={font.key}
                style={styles.fontChip}
                onPress={() => update({ fontFamily: font.key })}
                disabled={isPhotoBusy}
                accessibilityRole="button"
                accessibilityLabel={`${font.label} 서체`}
                accessibilityState={{ selected: isActive }}
                contentStyle={[
                  styles.fontChipContent,
                  isActive && styles.typeChipActive,
                  isPhotoBusy && styles.controlDisabled,
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
        <ColorPicker
          value={local.textColor}
          onChange={(textColor) => update({ textColor })}
          label="텍스트 색상"
          testID="cover-text-color-picker"
          disabled={isPhotoBusy}
        />

        {local.type === "color" && (
          <>
            <Text style={styles.sectionLabel}>배경 색상</Text>
            <ColorPicker
              value={local.bgColor ?? Colors.zinc50}
              onChange={(bgColor) => update({ bgColor })}
              label="배경 색상"
              testID="cover-background-color-picker"
              disabled={isPhotoBusy}
            />
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
    height: 40,
    flexGrow: 0,
    flexShrink: 0,
  },
  typeChipContent: {
    height: 40,
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
  controlDisabled: {
    opacity: 0.55,
  },
  photoSection: {
    marginTop: 12,
    gap: 8,
  },
  photoButton: {
    width: "100%",
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
  },
  photoButtonContent: {
    width: "100%",
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: Colors.zinc100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  photoButtonLabel: {
    ...Typography.bodySemiBold,
    fontSize: 14,
    color: Colors.zinc700,
  },
  photoErrorBox: {
    borderRadius: 10,
    backgroundColor: Colors.noticeAccentSoft,
    padding: 12,
    gap: 10,
  },
  photoErrorText: {
    ...Typography.caption,
    fontSize: 12,
    lineHeight: 18,
    color: Colors.noticeAccent,
  },
  retryButton: {
    height: 36,
    alignSelf: "flex-start",
    flexGrow: 0,
    flexShrink: 0,
  },
  retryButtonContent: {
    height: 36,
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonLabel: {
    ...Typography.bodySemiBold,
    fontSize: 13,
    color: Colors.noticeAccent,
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
});
