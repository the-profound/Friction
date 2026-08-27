import { useState, useCallback, useRef } from "react";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { getCurrentAuthAccessToken } from "./authTokenStore";
import {
  getInlineImageResizeAction,
  INLINE_IMAGE_COMPRESSION,
} from "./inlineImagePreparation";

function getApiBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "";
  if (!domain) return "";
  return domain.startsWith("http://") || domain.startsWith("https://")
    ? domain.replace(/\/+$/, "")
    : `https://${domain}`;
}

function fetchBlob(uri: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new Error("Failed to read image file"));
    xhr.responseType = "blob";
    xhr.open("GET", uri);
    xhr.send();
  });
}

async function uploadToPresignedUrl(
  uploadURL: string,
  uri: string,
  mimeType: string,
  token?: string,
): Promise<void> {
  const blob = await fetchBlob(uri);
  const res = await fetch(uploadURL, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

export interface UseImageUploadOptions {
  articleId: string;
  onSuccess?: (imageUrl: string) => void;
  onError?: (error: Error) => void;
}

export function useImageUpload({ articleId, onSuccess, onError }: UseImageUploadOptions) {
  const [isUploading, setIsUploading] = useState(false);

  const pickAndUpload = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onError?.(new Error("사진 접근 권한이 필요합니다."));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [5, 8],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const uri = asset.uri;
    const filename = uri.split("/").pop() ?? "cover.jpg";
    const mimeType = asset.mimeType ?? "image/jpeg";
    const fileSize = asset.fileSize ?? 0;

    setIsUploading(true);
    try {
      const baseUrl = getApiBaseUrl();

      const urlResponse = await fetch(`${baseUrl}/api/articles/${articleId}/cover-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: filename, size: fileSize, contentType: mimeType }),
      });

      if (!urlResponse.ok) {
        throw new Error("업로드 URL 발급에 실패했습니다.");
      }

      const { uploadURL, imageUrl: imagePath } = (await urlResponse.json()) as {
        uploadURL: string;
        imageUrl: string;
      };

      await uploadToPresignedUrl(uploadURL, uri, mimeType);

      const imageUrl = imagePath.startsWith("http") ? imagePath : `${baseUrl}${imagePath}`;
      onSuccess?.(imageUrl);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error("업로드 중 오류가 발생했습니다."));
    } finally {
      setIsUploading(false);
    }
  }, [articleId, onSuccess, onError]);

  return { pickAndUpload, isUploading };
}

export type InlineImageSource = "camera" | "gallery";

interface PreparedInlineImage {
  uri: string;
  mimeType: "image/jpeg";
  fileSize: number;
  name: string;
}

export interface PendingInlineImage {
  imageId: string;
  localUrl: string;
  source: InlineImageSource;
}

interface InlineImageUploadRequest {
  imageId: string;
  source: InlineImageSource;
  asset: ImagePicker.ImagePickerAsset;
}

function createImageId(): string {
  return `inline-image-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function prepareInlineImage(
  asset: ImagePicker.ImagePickerAsset,
): Promise<PreparedInlineImage> {
  const resize = getInlineImageResizeAction(asset.width, asset.height);

  // Re-encode every inline photo as JPEG. This gives iOS, Android, and web
  // the same MIME type and quality guarantee before any bytes leave the device.
  const result = await ImageManipulator.manipulateAsync(
    asset.uri,
    resize ? [{ resize }] : [],
    {
      compress: INLINE_IMAGE_COMPRESSION,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );
  const blob = await fetchBlob(result.uri);
  return {
    uri: result.uri,
    mimeType: "image/jpeg",
    fileSize: blob.size,
    name: "inline-image.jpg",
  };
}

export async function uploadInlineImage(
  prepared: PreparedInlineImage,
): Promise<string> {
  const baseUrl = getApiBaseUrl();
  const token = getCurrentAuthAccessToken();
  if (!token) throw new Error("로그인 상태를 확인한 뒤 다시 시도해 주세요.");

  const imageBytes = await fetchBlob(prepared.uri);
  const response = await fetch(`${baseUrl}/api/storage/inline-images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": prepared.mimeType,
    },
    body: imageBytes,
  });
  if (!response.ok) {
    throw new Error("사진 업로드에 실패했습니다.");
  }
  const { imageUrl } = await response.json() as { imageUrl: string };
  return imageUrl;
}

export function useInlineImageUpload({
  onPicked,
  onSuccess,
  onError,
}: {
  onPicked?: (image: PendingInlineImage) => void;
  onSuccess?: (image: { imageId: string; imageUrl: string }) => void;
  onError?: (image: { imageId: string; error: Error }) => void;
}) {
  const [uploadingImageIds, setUploadingImageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const requestsRef = useRef<Map<string, InlineImageUploadRequest>>(new Map());

  const upload = useCallback(async (request: InlineImageUploadRequest) => {
    setUploadingImageIds((previous) => new Set(previous).add(request.imageId));
    try {
      const prepared = await prepareInlineImage(request.asset);
      const imageUrl = await uploadInlineImage(prepared);
      onSuccess?.({ imageId: request.imageId, imageUrl });
    } catch (err) {
      onError?.({
        imageId: request.imageId,
        error: err instanceof Error ? err : new Error("업로드 중 오류가 발생했습니다."),
      });
    } finally {
      setUploadingImageIds((previous) => {
        const next = new Set(previous);
        next.delete(request.imageId);
        return next;
      });
    }
  }, [onError, onSuccess]);

  const pickAndUpload = useCallback(async (source: InlineImageSource) => {
    let asset: ImagePicker.ImagePickerAsset | null = null;

    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        onError?.({ imageId: "", error: new Error("카메라 접근 권한이 필요합니다.") });
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      asset = result.assets[0];
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onError?.({ imageId: "", error: new Error("사진 접근 권한이 필요합니다.") });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      asset = result.assets[0];
    }

    const request: InlineImageUploadRequest = {
      imageId: createImageId(),
      source,
      asset,
    };
    requestsRef.current.set(request.imageId, request);
    onPicked?.({
      imageId: request.imageId,
      localUrl: asset.uri,
      source,
    });
    void upload(request);
  }, [onPicked, upload]);

  const retry = useCallback((imageId: string) => {
    const request = requestsRef.current.get(imageId);
    if (!request) {
      onError?.({ imageId, error: new Error("이 사진을 다시 준비할 수 없습니다. 사진을 다시 선택해 주세요.") });
      return;
    }
    void upload(request);
  }, [onError, upload]);

  return {
    pickAndUpload,
    retry,
    isUploading: uploadingImageIds.size > 0,
    uploadingImageIds,
  };
}
