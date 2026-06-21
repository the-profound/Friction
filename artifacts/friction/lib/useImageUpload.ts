import { useState, useCallback } from "react";
import * as ImagePicker from "expo-image-picker";

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
): Promise<void> {
  const blob = await fetchBlob(uri);
  const res = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
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

export async function uploadInlineImage(
  uri: string,
  mimeType: string,
  fileSize: number,
): Promise<string> {
  const baseUrl = getApiBaseUrl();
  const filename = uri.split("/").pop() ?? "image.jpg";

  const urlResponse = await fetch(`${baseUrl}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: filename, size: fileSize, contentType: mimeType }),
  });

  if (!urlResponse.ok) {
    throw new Error("업로드 URL 발급에 실패했습니다.");
  }

  const { uploadURL, objectPath } = (await urlResponse.json()) as {
    uploadURL: string;
    objectPath: string;
  };

  await uploadToPresignedUrl(uploadURL, uri, mimeType);

  const relativePath = objectPath.replace(/^\/objects\//, "");
  return `${baseUrl}/api/storage/objects/${relativePath}`;
}

export function useInlineImageUpload({
  onSuccess,
  onError,
}: {
  onSuccess?: (imageUrl: string) => void;
  onError?: (error: Error) => void;
}) {
  const [isUploading, setIsUploading] = useState(false);

  const pickAndUpload = useCallback(async (source: InlineImageSource) => {
    let asset: ImagePicker.ImagePickerAsset | null = null;

    if (source === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        onError?.(new Error("카메라 접근 권한이 필요합니다."));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]) return;
      asset = result.assets[0];
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onError?.(new Error("사진 접근 권한이 필요합니다."));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]) return;
      asset = result.assets[0];
    }

    const uri = asset.uri;
    const mimeType = asset.mimeType ?? "image/jpeg";
    const fileSize = asset.fileSize ?? 0;

    setIsUploading(true);
    try {
      const imageUrl = await uploadInlineImage(uri, mimeType, fileSize);
      onSuccess?.(imageUrl);
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error("업로드 중 오류가 발생했습니다."));
    } finally {
      setIsUploading(false);
    }
  }, [onSuccess, onError]);

  return { pickAndUpload, isUploading };
}
