import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import {
  useGetArticle,
  useGetUser,
  getGetArticleQueryKey,
  getGetUserQueryKey,
} from "@workspace/api-client-react";
import { resolveArticleCover } from "@/utils/articleCover";
import { normalizePageItem } from "@/utils/normalizePageItem";
import { computeBodyLayout } from "@/lib/bodyLayout";
import { splitContentToPages } from "@/lib/pageDivision";
import { Colors, Typography, ReaderTokens, ZIndex } from "@/constants/tokens";
import { useToast } from "@/contexts/ToastContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CoverPage from "@/components/CoverPage/CoverPage";
import WebViewMarkdownReader from "@/components/WebViewMarkdownReader";

type Phase =
  | "idle"
  | "requesting-permission"
  | "capturing"
  | "done"
  | "error";

interface SaveAsPhotosModalProps {
  visible: boolean;
  articleId: string;
  onClose: () => void;
}

export default function SaveAsPhotosModal({
  visible,
  articleId,
  onClose,
}: SaveAsPhotosModalProps) {
  const { showToast } = useToast();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const articleQuery = useGetArticle(articleId, {
    query: {
      queryKey: getGetArticleQueryKey(articleId),
      enabled: visible && !!articleId,
    },
  });
  const article = articleQuery.data;

  const authorId = article?.authorId ?? "";
  const authorQuery = useGetUser(authorId, {
    query: {
      queryKey: getGetUserQueryKey(authorId),
      enabled: visible && !!authorId,
    },
  });
  const authorName = authorId
    ? (authorQuery.data?.nickname ?? authorQuery.data?.email ?? undefined)
    : undefined;

  const cover = useMemo(
    () => resolveArticleCover(article?.cover),
    [article?.cover],
  );

  const contentPages: string[] = useMemo(() => {
    if (!article) return [];
    if (article.pages && Array.isArray(article.pages) && article.pages.length > 0) {
      return article.pages.map(normalizePageItem);
    }
    if (article.content && article.content.trim().length > 0) {
      return splitContentToPages(article.content).map((p) => p.content);
    }
    return [];
  }, [article]);

  const totalPageCount = article ? 1 + contentPages.length : 0;

  const [phase, setPhase] = useState<Phase>("idle");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [coverImageReady, setCoverImageReady] = useState(false);
  const captureViewRef = useRef<View>(null);
  const savedAssetsRef = useRef<string[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const effectiveLayoutWidth = useMemo(() => {
    const stored = (article?.layoutWidth != null && article.layoutWidth > 0)
      ? article.layoutWidth
      : undefined;
    const widthFromHeight = screenHeight * ReaderTokens.aspectRatio;
    const fallback = widthFromHeight <= screenWidth ? widthFromHeight : screenWidth;
    return stored ?? fallback;
  }, [article?.layoutWidth, screenWidth, screenHeight]);

  const containerWidth = effectiveLayoutWidth;
  const containerHeight = containerWidth / ReaderTokens.aspectRatio;
  const bodyLayout = useMemo(() => computeBodyLayout(containerWidth), [containerWidth]);

  const resetState = useCallback(() => {
    setPhase("idle");
    setCurrentIndex(0);
    setCoverImageReady(false);
    savedAssetsRef.current = [];
  }, []);

  useEffect(() => {
    if (!visible) {
      resetState();
    }
  }, [visible, resetState]);

  const finishWithError = useCallback(
    (message: string) => {
      setPhase("error");
      showToast({ message, type: "error" });
      onClose();
      resetState();
    },
    [showToast, onClose, resetState],
  );

  const finishSuccess = useCallback(
    (count: number) => {
      setPhase("done");
      showToast({
        message: `${count}장의 이미지를 저장했어요`,
        type: "success",
      });
      onClose();
      resetState();
    },
    [showToast, onClose, resetState],
  );

  const captureAndSave = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") return false;
    try {
      const { captureRef } = await import("react-native-view-shot");
      const uri = await captureRef(captureViewRef, {
        format: "jpg",
        quality: 0.92,
        result: "tmpfile",
      });

      const MediaLibrary = await import("expo-media-library");
      const asset = await MediaLibrary.createAssetAsync(uri);
      savedAssetsRef.current.push(asset.id);

      try {
        const albumName = "Friction";
        let album = await MediaLibrary.getAlbumAsync(albumName);
        if (!album) {
          await MediaLibrary.createAlbumAsync(albumName, asset, false);
        } else {
          await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
        }
      } catch {
      }

      return true;
    } catch (e) {
      console.warn("[SaveAsPhotos] captureAndSave error:", e);
      return false;
    }
  }, []);

  const startCapture = useCallback(async () => {
    if (Platform.OS === "web") {
      showToast({
        message: "사진 저장은 모바일 앱에서 사용해주세요",
        type: "info",
        duration: 3000,
      });
      onClose();
      return;
    }

    if (!article || totalPageCount === 0) {
      finishWithError("편지 데이터를 불러오지 못했어요");
      return;
    }

    setPhase("requesting-permission");

    try {
      const MediaLibrary = await import("expo-media-library");
      const current = await MediaLibrary.getPermissionsAsync(true);
      if (current.canAskAgain === false) {
        showToast({
          message: "설정에서 사진첩 권한을 허용해주세요",
          type: "error",
          duration: 4000,
        });
        const { Linking } = await import("react-native");
        await Linking.openSettings();
        onClose();
        resetState();
        return;
      }
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== "granted") {
        showToast({
          message: "사진첩 접근 권한이 없어요",
          type: "error",
          duration: 3000,
        });
        onClose();
        resetState();
        return;
      }
    } catch (e) {
      finishWithError("권한 요청 중 오류가 발생했어요");
      return;
    }

    setPhase("capturing");
    setCurrentIndex(0);
  }, [article, totalPageCount, showToast, onClose, resetState, finishWithError]);

  useEffect(() => {
    if (!visible || phase !== "idle") return;
    if (articleQuery.isLoading) return;
    if (articleQuery.isError || !article) {
      finishWithError("편지 데이터를 불러오지 못했어요");
      return;
    }
    if (authorId && authorQuery.isLoading) return;
    startCapture();
  }, [visible, phase, article, articleQuery.isLoading, articleQuery.isError, authorId, authorQuery.isLoading, startCapture, finishWithError]);

  const handlePageReady = useCallback(async () => {
    if (phaseRef.current !== "capturing") return;

    await new Promise((resolve) => setTimeout(resolve, 600));

    if (phaseRef.current !== "capturing") return;

    const success = await captureAndSave();

    if (phaseRef.current !== "capturing") return;

    if (!success) {
      const saved = savedAssetsRef.current.length;
      if (saved > 0) {
        const failedAt = saved + 1;
        setPhase("error");
        showToast({
          message: `${saved}/${totalPageCount}장 저장 후 ${failedAt}번째에서 실패했어요`,
          type: "error",
          duration: 5000,
        });
      } else {
        setPhase("error");
        showToast({ message: "이미지 저장에 실패했어요", type: "error" });
      }
      onClose();
      resetState();
      return;
    }

    setCurrentIndex((prev) => {
      const next = prev + 1;
      if (next >= totalPageCount) {
        const count = savedAssetsRef.current.length;
        setTimeout(() => finishSuccess(count), 0);
        return prev;
      }
      return next;
    });
  }, [captureAndSave, totalPageCount, finishSuccess, showToast, onClose, resetState]);

  const isImageCover = cover.type === "image" && !!cover.imageUrl;

  const handleCoverReady = useCallback(() => {
    if (phaseRef.current !== "capturing") return;
    const timer = setTimeout(() => {
      handlePageReady();
    }, 100);
    return () => clearTimeout(timer);
  }, [handlePageReady]);

  useEffect(() => {
    if (phase === "capturing" && currentIndex === 0 && article) {
      if (isImageCover && !coverImageReady) return;
      return handleCoverReady();
    }
    return undefined;
  }, [phase, currentIndex, article, isImageCover, coverImageReady, handleCoverReady]);

  if (!visible) return null;

  const isLoading =
    phase === "idle" ||
    phase === "requesting-permission" ||
    articleQuery.isLoading;

  const progressLabel = isLoading
    ? "준비 중..."
    : phase === "capturing"
      ? `${currentIndex + 1} / ${totalPageCount} 페이지 저장 중…`
      : "";

  const currentContentPage =
    phase === "capturing" && currentIndex > 0
      ? (contentPages[currentIndex - 1] ?? "")
      : "";

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.progressCard}>
          <ActivityIndicator size="small" color={Colors.zinc400} />
          <Text style={styles.progressText}>{progressLabel}</Text>
        </View>
      </View>

      <View
        style={[
          styles.captureContainer,
          {
            left: -(containerWidth + 20),
            width: containerWidth,
            height: containerHeight,
          },
        ]}
        pointerEvents="none"
      >
        <View
          ref={captureViewRef}
          style={[
            styles.captureFrame,
            { width: containerWidth, height: containerHeight },
          ]}
        >
          {phase === "capturing" && article && currentIndex === 0 && (
            <CoverPage
              cover={cover}
              title={article.title}
              authorName={authorName}
              containerWidth={containerWidth}
              containerHeight={containerHeight}
              onImageLoad={() => setCoverImageReady(true)}
            />
          )}

          {phase === "capturing" && article && currentIndex > 0 && (
            <View style={{ flex: 1, width: containerWidth }}>
              <View style={{
                flex: 1,
                width: bodyLayout.pageWidth,
                paddingHorizontal: bodyLayout.paddingX,
                paddingTop: bodyLayout.paddingY,
                paddingBottom: insets.bottom + bodyLayout.paddingY + bodyLayout.titleBarHeight,
              }}>
                <View style={{ width: bodyLayout.textColumnWidth, flex: 1 }}>
                  <WebViewMarkdownReader
                    key={`capture-page-${currentIndex}`}
                    markdown={currentContentPage}
                    bodyFontSize={bodyLayout.bodyFontSize}
                    bodyLetterSpacing={bodyLayout.bodyLetterSpacing}
                    onReady={handlePageReady}
                  />
                </View>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: ZIndex.modal,
  },
  progressCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingHorizontal: 28,
    paddingVertical: 20,
    alignItems: "center",
    gap: 12,
    minWidth: 180,
  },
  progressText: {
    ...Typography.body,
    fontSize: 14,
    color: Colors.zinc600,
    textAlign: "center",
  },
  captureContainer: {
    position: "absolute",
    top: 0,
    overflow: "hidden",
  },
  captureFrame: {
    backgroundColor: Colors.white,
    overflow: "hidden",
  },
});
