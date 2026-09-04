import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { ArticleCover } from "@workspace/api-client-react";
import ScalePressable from "@/components/shared/ScalePressable";
import { Colors, ReaderTokens, Typography } from "@/constants/tokens";
import BottomSheet from "../BottomSheet/BottomSheet";
import ColorPicker from "../ColorPicker/ColorPicker";
import { resolveArticleCover } from "@/utils/articleCover";
import {
  CoverPhotoPickerError,
  pickCoverPhoto,
  type SelectedCoverPhoto,
} from "@/lib/coverPhotoPicker";
import { CoverPhotoUploadError, uploadCoverPhoto } from "@/lib/coverPhotoUpload";

type Panel = "text" | "background" | null;

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
  sheetTranslateYAnim?: import("react-native").Animated.Value;
}

const CONTROL_HEIGHT = 56;

export default function CoverEditor({
  visible,
  onClose,
  cover,
  onChange,
  articleId,
  onPhotoOperationStateChange,
  onCommitPhotoCover,
  sheetTranslateYAnim,
}: CoverEditorProps) {
  const [local, setLocal] = useState<ArticleCover>(() => resolveArticleCover(cover));
  const localRef = useRef(local);
  localRef.current = local;
  const [panel, setPanel] = useState<Panel>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isSelectingPhoto, setIsSelectingPhoto] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const photoOperationInProgressRef = useRef(false);
  const retryPhotoRef = useRef<SelectedCoverPhoto | null>(null);
  const retryUploadedImageUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const next = resolveArticleCover(cover);
    setLocal(next);
    localRef.current = next;
    setPanel(null);
    setPhotoError(null);
    retryPhotoRef.current = null;
    retryUploadedImageUrlRef.current = null;
    if (next.textColor !== cover.textColor || next.bgColor !== cover.bgColor) {
      onChange(next);
    }
  }, [visible]); // Each opening is a new editor session; live edits stay local.

  useEffect(
    () => () => {
      onPhotoOperationStateChange?.(false);
    },
    [onPhotoOperationStateChange],
  );

  const update = useCallback(
    (patch: Partial<ArticleCover>) => {
      if (photoOperationInProgressRef.current) return;
      const next = { ...localRef.current, ...patch };
      localRef.current = next;
      setLocal(next);
      onChange(next);
    },
    [onChange],
  );

  const uploadSelectedPhoto = useCallback(
    async (photo: SelectedCoverPhoto) => {
      retryPhotoRef.current = photo;
      setPhotoError(null);
      setIsUploading(true);
      try {
        const imageUrl =
          retryUploadedImageUrlRef.current ?? (await uploadCoverPhoto(articleId, photo));
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
        setPhotoError(
          error instanceof CoverPhotoUploadError || error instanceof Error
            ? error.message
            : "사진 업로드에 실패했어요. 다시 시도해주세요.",
        );
      } finally {
        setIsUploading(false);
      }
    },
    [articleId, onCommitPhotoCover],
  );

  const selectPhoto = useCallback(async () => {
    if (photoOperationInProgressRef.current) return;
    photoOperationInProgressRef.current = true;
    onPhotoOperationStateChange?.(true);
    setIsSelectingPhoto(true);
    setPhotoError(null);
    try {
      const selection = await pickCoverPhoto();
      if (!selection) return;
      retryUploadedImageUrlRef.current = null;
      await uploadSelectedPhoto(selection);
    } catch (error) {
      setPhotoError(
        error instanceof CoverPhotoPickerError
          ? error.message
          : "사진을 선택하지 못했어요. 다시 시도해주세요.",
      );
    } finally {
      photoOperationInProgressRef.current = false;
      onPhotoOperationStateChange?.(false);
      setIsSelectingPhoto(false);
    }
  }, [onPhotoOperationStateChange, uploadSelectedPhoto]);

  const retryUpload = useCallback(async () => {
    if (photoOperationInProgressRef.current) return;
    const photo = retryPhotoRef.current;
    if (!photo) {
      await selectPhoto();
      return;
    }
    photoOperationInProgressRef.current = true;
    onPhotoOperationStateChange?.(true);
    try {
      await uploadSelectedPhoto(photo);
    } finally {
      photoOperationInProgressRef.current = false;
      onPhotoOperationStateChange?.(false);
    }
  }, [onPhotoOperationStateChange, selectPhoto, uploadSelectedPhoto]);

  const isPhotoBusy = isSelectingPhoto || isUploading;
  const fontFamily = local.fontFamily ?? "sans";
  const backgroundColor = local.bgColor ?? Colors.zinc50;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={[0.58]}
      translateYAnim={sheetTranslateYAnim}
    >
      <View style={styles.container}>
        <ScrollView
          style={styles.panelScroll}
          contentContainerStyle={styles.panelContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {panel === "text" ? (
            <ColorPicker
              value={local.textColor}
              onChange={(textColor) => update({ textColor })}
              label="글자 색상"
              testID="cover-text-color-picker"
              disabled={isPhotoBusy}
            />
          ) : panel === "background" ? (
            <>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>배경</Text>
                <ScalePressable
                  style={styles.photoButton}
                  contentStyle={styles.photoButtonContent}
                  onPress={selectPhoto}
                  disabled={isPhotoBusy}
                  accessibilityRole="button"
                  accessibilityLabel={local.imageUrl ? "표지 사진 변경" : "표지 사진 추가"}
                  accessibilityState={{ disabled: isPhotoBusy, busy: isPhotoBusy }}
                  testID="cover-photo-button"
                >
                  {isPhotoBusy ? (
                    <ActivityIndicator size="small" color={Colors.zinc700} />
                  ) : (
                    <Feather name="image" size={18} color={Colors.zinc700} />
                  )}
                  <Text style={styles.photoButtonLabel}>
                    {isUploading ? "업로드 중" : "사진 추가"}
                  </Text>
                </ScalePressable>
              </View>
              <ColorPicker
                value={backgroundColor}
                onChange={(bgColor) => update({ type: "color", bgColor })}
                label="배경 색상"
                testID="cover-background-color-picker"
                disabled={isPhotoBusy}
              />
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
            </>
          ) : (
            <View style={styles.hintWrap}>
              <Text style={styles.hint}>아래 설정을 눌러 표지를 꾸며보세요.</Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.controlRow}>
          <ScalePressable
            style={styles.controlButton}
            contentStyle={styles.controlButtonContent}
            onPress={() => update({ fontFamily: fontFamily === "sans" ? "serif" : "sans" })}
            disabled={isPhotoBusy}
            accessibilityRole="button"
            accessibilityLabel={`서체 ${fontFamily === "sans" ? "고딕" : "명조"}`}
            accessibilityHint="누르면 고딕과 명조가 전환됩니다."
            accessibilityState={{ disabled: isPhotoBusy }}
            testID="cover-font-toggle"
          >
            <Text
              style={[
                styles.controlValue,
                {
                  fontFamily:
                    fontFamily === "serif"
                      ? ReaderTokens.fontFamily.serifBold
                      : ReaderTokens.fontFamily.sansSemiBold,
                },
              ]}
            >
              {fontFamily === "sans" ? "고딕" : "명조"}
            </Text>
            <Text style={styles.controlLabel}>서체</Text>
          </ScalePressable>

          <ScalePressable
            style={styles.controlButton}
            contentStyle={[styles.controlButtonContent, panel === "text" && styles.controlActive]}
            onPress={() => setPanel((current) => (current === "text" ? null : "text"))}
            disabled={isPhotoBusy}
            accessibilityRole="button"
            accessibilityLabel={`글자 색상 ${local.textColor}`}
            accessibilityState={{ selected: panel === "text", disabled: isPhotoBusy }}
            testID="cover-text-color-button"
          >
            <View style={[styles.swatch, { backgroundColor: local.textColor }]} />
            <Text style={styles.controlLabel}>글자</Text>
          </ScalePressable>

          <ScalePressable
            style={styles.controlButton}
            contentStyle={[
              styles.controlButtonContent,
              panel === "background" && styles.controlActive,
            ]}
            onPress={() =>
              setPanel((current) => (current === "background" ? null : "background"))
            }
            disabled={isPhotoBusy}
            accessibilityRole="button"
            accessibilityLabel={
              local.type === "image" ? "사진 배경 설정" : `배경 색상 ${backgroundColor}`
            }
            accessibilityState={{ selected: panel === "background", disabled: isPhotoBusy }}
            testID="cover-background-button"
          >
            {local.type === "image" ? (
              <Feather name="image" size={22} color={Colors.zinc800} />
            ) : (
              <View style={[styles.swatch, { backgroundColor }]} />
            )}
            <Text style={styles.controlLabel}>배경</Text>
          </ScalePressable>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  panelScroll: { flex: 1 },
  panelContent: { paddingTop: 8, paddingBottom: 16 },
  hintWrap: { minHeight: 180, alignItems: "center", justifyContent: "center" },
  hint: { ...Typography.body, fontSize: 14, color: Colors.zinc500 },
  panelHeader: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  panelTitle: { ...Typography.bodySemiBold, fontSize: 15, color: Colors.zinc900 },
  photoButton: { height: 44, flexGrow: 0, flexShrink: 0 },
  photoButtonContent: {
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  photoButtonLabel: { ...Typography.bodySemiBold, fontSize: 13, color: Colors.zinc700 },
  photoErrorBox: {
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: Colors.noticeAccentSoft,
    padding: 12,
    gap: 8,
  },
  photoErrorText: { ...Typography.caption, fontSize: 12, color: Colors.noticeAccent },
  retryButton: { height: 36, alignSelf: "flex-start", flexGrow: 0, flexShrink: 0 },
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
  retryButtonLabel: { ...Typography.bodySemiBold, fontSize: 13, color: Colors.noticeAccent },
  controlRow: {
    height: CONTROL_HEIGHT,
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.zinc200,
  },
  controlButton: { flex: 1, height: CONTROL_HEIGHT, flexGrow: 1, flexShrink: 1 },
  controlButtonContent: {
    height: CONTROL_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  controlActive: { backgroundColor: Colors.zinc100 },
  controlValue: { fontSize: 15, color: Colors.zinc900 },
  controlLabel: { ...Typography.caption, fontSize: 11, color: Colors.zinc600 },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.zinc300,
  },
});