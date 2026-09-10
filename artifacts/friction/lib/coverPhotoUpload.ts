import {
  ApiError,
  requestArticleCoverUploadUrl,
  verifyArticleCoverUpload,
  type ArticleCoverUploadResponse,
  type ArticleCoverVerificationResponse,
} from "@workspace/api-client-react";
import { getCurrentAuthAccessToken } from "./authTokenStore";
import { runtimeConfig } from "./runtimeConfig";
import {
  MAX_COVER_PHOTO_BYTES,
  type SelectedCoverPhoto,
} from "./coverPhotoTypes";
import type {
  UploadOptions,
  UploadResult,
  UploadType,
} from "expo-file-system";

export type CoverPhotoUploadErrorCode =
  | "auth-expired"
  | "too-large"
  | "invalid-image"
  | "staged-missing"
  | "server-failed"
  | "request-failed"
  | "upload-failed";

export class CoverPhotoUploadError extends Error {
  constructor(
    readonly code: CoverPhotoUploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoverPhotoUploadError";
  }
}

interface CoverPhotoUploadDependencies {
  getAccessToken: () => string | null;
  requestUploadUrl: (
    articleId: string,
    photo: Pick<SelectedCoverPhoto, "name" | "size" | "contentType">,
  ) => Promise<ArticleCoverUploadResponse>;
  verifyUpload: (
    articleId: string,
    objectPath: string,
  ) => Promise<ArticleCoverVerificationResponse>;
  put: typeof fetch;
  putNativeFile: (
    uploadUrl: string,
    photo: Extract<SelectedCoverPhoto, { source: "native" }>,
  ) => Promise<{ status: number }>;
  apiBaseUrl: string | null;
}

interface NativeFileUploadAdapter {
  createFile: (uri: string) => {
    upload: (url: string, options?: UploadOptions) => Promise<UploadResult>;
  };
  binaryUploadType: UploadType;
}

export async function uploadNativeCoverFile(
  uploadUrl: string,
  photo: Extract<SelectedCoverPhoto, { source: "native" }>,
  loadAdapter: () => Promise<NativeFileUploadAdapter> = async () => {
    const { File, UploadType } = await import("expo-file-system");
    return {
      createFile: (uri) => new File(uri),
      binaryUploadType: UploadType.BINARY_CONTENT,
    };
  },
): Promise<{ status: number }> {
  const adapter = await loadAdapter();
  return adapter.createFile(photo.uri).upload(uploadUrl, {
    httpMethod: "PUT",
    uploadType: adapter.binaryUploadType,
    headers: { "Content-Type": photo.contentType },
    mimeType: photo.contentType,
    sessionType: "foreground",
  });
}

const defaultDependencies: CoverPhotoUploadDependencies = {
  getAccessToken: getCurrentAuthAccessToken,
  requestUploadUrl: (articleId, photo) =>
    requestArticleCoverUploadUrl(articleId, {
      name: photo.name,
      size: photo.size,
      contentType: photo.contentType,
    }),
  verifyUpload: (articleId, objectPath) =>
    verifyArticleCoverUpload(articleId, { objectPath }),
  put: fetch,
  putNativeFile: uploadNativeCoverFile,
  apiBaseUrl: runtimeConfig.apiBaseUrl,
};

function apiErrorCode(error: ApiError): string | null {
  if (!error.data || typeof error.data !== "object") return null;
  const code = (error.data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function absoluteImageUrl(imageUrl: string, apiBaseUrl: string | null): string {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  if (!apiBaseUrl) {
    throw new CoverPhotoUploadError(
      "request-failed",
      "서버 주소를 확인할 수 없어요. 앱을 다시 시작한 뒤 시도해주세요.",
    );
  }
  return new URL(imageUrl, `${apiBaseUrl}/`).toString();
}

export async function uploadCoverPhoto(
  articleId: string,
  photo: SelectedCoverPhoto,
  dependencies: CoverPhotoUploadDependencies = defaultDependencies,
): Promise<string> {
  if (!dependencies.getAccessToken()) {
    throw new CoverPhotoUploadError(
      "auth-expired",
      "로그인이 만료되었어요. 다시 로그인한 뒤 시도해주세요.",
    );
  }
  if (photo.size > MAX_COVER_PHOTO_BYTES) {
    throw new CoverPhotoUploadError(
      "too-large",
      "사진은 10MB 이하만 사용할 수 있어요.",
    );
  }

  let uploadTarget: ArticleCoverUploadResponse;
  try {
    uploadTarget = await dependencies.requestUploadUrl(articleId, photo);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new CoverPhotoUploadError(
        "auth-expired",
        "로그인이 만료되었어요. 다시 로그인한 뒤 시도해주세요.",
      );
    }
    if (error instanceof ApiError && error.status >= 500) {
      throw new CoverPhotoUploadError(
        "server-failed",
        "서버에서 사진 업로드를 준비하지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    }
    throw new CoverPhotoUploadError(
      "request-failed",
      "사진 업로드를 준비하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.",
    );
  }

  let uploadStatus: number;
  try {
    if (photo.source === "native") {
      uploadStatus = (
        await dependencies.putNativeFile(uploadTarget.uploadURL, photo)
      ).status;
    } else {
      uploadStatus = (
        await dependencies.put(uploadTarget.uploadURL, {
          method: "PUT",
          headers: { "Content-Type": photo.contentType },
          body: photo.blob,
        })
      ).status;
    }
  } catch {
    throw new CoverPhotoUploadError(
      "request-failed",
      "사진 업로드에 실패했어요. 네트워크를 확인하고 다시 시도해주세요.",
    );
  }
  if (uploadStatus < 200 || uploadStatus >= 300) {
    if (uploadStatus >= 500) {
      throw new CoverPhotoUploadError(
        "server-failed",
        "사진 저장소가 응답하지 않아요. 잠시 후 다시 시도해주세요.",
      );
    }
    throw new CoverPhotoUploadError(
      "upload-failed",
      "사진 업로드에 실패했어요. 잠시 후 다시 시도해주세요.",
    );
  }

  let verified: ArticleCoverVerificationResponse;
  try {
    verified = await dependencies.verifyUpload(articleId, uploadTarget.objectPath);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw new CoverPhotoUploadError(
        "auth-expired",
        "로그인이 만료되었어요. 다시 로그인한 뒤 시도해주세요.",
      );
    }
    if (
      error instanceof ApiError &&
      apiErrorCode(error) === "COVER_IMAGE_INVALID"
    ) {
      throw new CoverPhotoUploadError(
        "invalid-image",
        "지원하지 않거나 손상된 이미지예요. JPG, PNG 등 다른 이미지를 선택해주세요.",
      );
    }
    if (
      error instanceof ApiError &&
      apiErrorCode(error) === "COVER_IMAGE_STAGING_NOT_FOUND"
    ) {
      throw new CoverPhotoUploadError(
        "staged-missing",
        "업로드한 사진을 찾지 못했어요. 다시 업로드해주세요.",
      );
    }
    if (error instanceof ApiError && error.status >= 500) {
      throw new CoverPhotoUploadError(
        "server-failed",
        "서버에서 사진을 확인하지 못했어요. 잠시 후 다시 시도해주세요.",
      );
    }
    throw new CoverPhotoUploadError(
      "request-failed",
      "사진을 확인하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.",
    );
  }

  return absoluteImageUrl(verified.imageUrl, dependencies.apiBaseUrl);
}