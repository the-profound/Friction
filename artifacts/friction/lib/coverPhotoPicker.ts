import { Platform } from "react-native";
import {
  MAX_COVER_PHOTO_BYTES,
  type SelectedCoverPhoto,
} from "./coverPhotoTypes";

export { MAX_COVER_PHOTO_BYTES, type SelectedCoverPhoto } from "./coverPhotoTypes";

export type CoverPhotoPickerErrorCode =
  | "permission-denied"
  | "module-unavailable"
  | "invalid-type"
  | "too-large"
  | "read-failed";

export class CoverPhotoPickerError extends Error {
  constructor(
    readonly code: CoverPhotoPickerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoverPhotoPickerError";
  }
}

interface NativeCoverPhotoAsset {
  uri: string;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
}

export async function selectedNativeCoverPhoto(
  asset: NativeCoverPhotoAsset,
  readFileSize: (uri: string) => Promise<number | undefined> = async (uri) => {
    const { File } = await import("expo-file-system");
    return new File(uri).info().size;
  },
): Promise<SelectedCoverPhoto> {
  const contentType = asset.mimeType || "image/jpeg";
  const size = asset.fileSize || (await readFileSize(asset.uri));
  if (!size) {
    throw new CoverPhotoPickerError(
      "read-failed",
      "선택한 사진을 읽을 수 없어요. 다른 사진을 선택해주세요.",
    );
  }
  ensureImageFile(contentType, size);
  return {
    source: "native",
    uri: asset.uri,
    name: asset.fileName || `cover-image.${contentType.split("/")[1] || "jpg"}`,
    size,
    contentType,
  };
}

function ensureImageFile(contentType: string, size: number): void {
  if (!contentType.startsWith("image/")) {
    throw new CoverPhotoPickerError(
      "invalid-type",
      "이미지 파일만 표지로 사용할 수 있어요.",
    );
  }
  if (size > MAX_COVER_PHOTO_BYTES) {
    throw new CoverPhotoPickerError(
      "too-large",
      "사진은 10MB 이하만 사용할 수 있어요.",
    );
  }
  if (size <= 0) {
    throw new CoverPhotoPickerError(
      "read-failed",
      "선택한 사진을 읽을 수 없어요. 다른 사진을 선택해주세요.",
    );
  }
}

function pickWebPhoto(): Promise<SelectedCoverPhoto | null> {
  if (typeof document === "undefined") {
    throw new CoverPhotoPickerError(
      "module-unavailable",
      "이 환경에서는 파일 선택을 사용할 수 없어요.",
    );
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = false;

    let settled = false;
    const finish = (selection: SelectedCoverPhoto | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      resolve(selection);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus);
      reject(error);
    };
    const handleWindowFocus = () => {
      window.setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 300);
    };

    input.addEventListener("cancel", () => finish(null), { once: true });
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (!file) {
          finish(null);
          return;
        }
        try {
          ensureImageFile(file.type, file.size);
          finish({
            source: "web",
            uri: file.name,
            name: file.name || "cover-image",
            size: file.size,
            contentType: file.type,
            blob: file,
          });
        } catch (error) {
          fail(error);
        }
      },
      { once: true },
    );
    window.addEventListener("focus", handleWindowFocus, { once: true });
    input.click();
  });
}

async function pickNativePhoto(): Promise<SelectedCoverPhoto | null> {
  let picker: typeof import("expo-image-picker");
  try {
    // Keep this import inside the user action. Existing development clients
    // without the native module must still be able to start and load routes.
    picker = await import("expo-image-picker");
  } catch {
    throw new CoverPhotoPickerError(
      "module-unavailable",
      "사진 표지를 사용하려면 개발 앱을 새로 빌드해주세요.",
    );
  }

  try {
    const permission = await picker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new CoverPhotoPickerError(
        "permission-denied",
        "사진 보관함 권한이 필요해요. 권한을 허용한 뒤 다시 시도해주세요.",
      );
    }

    const result = await picker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      allowsMultipleSelection: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return null;

    const asset = result.assets[0];
    return selectedNativeCoverPhoto(asset);
  } catch (error) {
    if (error instanceof CoverPhotoPickerError) throw error;
    throw new CoverPhotoPickerError(
      "read-failed",
      "선택한 사진을 읽을 수 없어요. 다른 사진을 선택해주세요.",
    );
  }
}

export function pickCoverPhoto(): Promise<SelectedCoverPhoto | null> {
  return Platform.OS === "web" ? pickWebPhoto() : pickNativePhoto();
}