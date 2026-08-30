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

export type CoverPhotoUploadErrorCode =
  | "auth-expired"
  | "too-large"
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
  apiBaseUrl: string | null;
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
  apiBaseUrl: runtimeConfig.apiBaseUrl,
};

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
    throw new CoverPhotoUploadError(
      "request-failed",
      "사진 업로드를 준비하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.",
    );
  }

  let response: Response;
  try {
    response = await dependencies.put(uploadTarget.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": photo.contentType },
      body: photo.blob,
    });
  } catch {
    throw new CoverPhotoUploadError(
      "upload-failed",
      "사진 업로드에 실패했어요. 네트워크를 확인하고 다시 시도해주세요.",
    );
  }
  if (!response.ok) {
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
    throw new CoverPhotoUploadError(
      "upload-failed",
      "사진을 확인하지 못했어요. 지원되는 이미지인지 확인하고 다시 시도해주세요.",
    );
  }

  return absoluteImageUrl(verified.imageUrl, dependencies.apiBaseUrl);
}