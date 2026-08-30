import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type ArticleCoverUploadResponse,
  type ArticleCoverVerificationResponse,
} from "@workspace/api-client-react";
import {
  CoverPhotoUploadError,
  uploadCoverPhoto,
} from "./coverPhotoUpload";
import {
  MAX_COVER_PHOTO_BYTES,
  type SelectedCoverPhoto,
} from "./coverPhotoTypes";

const photo: SelectedCoverPhoto = {
  uri: "blob:cover",
  name: "cover.jpg",
  size: 4,
  contentType: "image/jpeg",
  blob: new Blob(["test"], { type: "image/jpeg" }),
};

function dependencies(overrides: {
  token?: string | null;
  target?: ArticleCoverUploadResponse;
  verified?: ArticleCoverVerificationResponse;
  putResponse?: Response;
  requestError?: Error;
  verifyError?: Error;
} = {}) {
  const requestUploadUrl = vi.fn(async () => {
    if (overrides.requestError) throw overrides.requestError;
    return overrides.target ?? {
      uploadURL: "https://storage.example.test/upload",
      objectPath: "/objects/cover-staging/article-id/upload-id",
    };
  });
  const verifyUpload = vi.fn(async () => {
    if (overrides.verifyError) throw overrides.verifyError;
    return overrides.verified ?? {
      imageUrl: "/api/storage/objects/cover-images/article-id/cover.jpg",
    };
  });
  const put = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      overrides.putResponse ?? new Response(null, { status: 200 }),
  );
  return {
    deps: {
      getAccessToken: () => overrides.token === undefined ? "valid-token" : overrides.token,
      requestUploadUrl,
      verifyUpload,
      put: put as typeof fetch,
      apiBaseUrl: "https://api.example.test",
    },
    requestUploadUrl,
    verifyUpload,
    put,
  };
}

describe("uploadCoverPhoto", () => {
  it("requests an authenticated upload target, uploads bytes, and returns an absolute image URL", async () => {
    const { deps, requestUploadUrl, verifyUpload, put } = dependencies();

    await expect(uploadCoverPhoto("article-id", photo, deps)).resolves.toBe(
      "https://api.example.test/api/storage/objects/cover-images/article-id/cover.jpg",
    );
    expect(requestUploadUrl).toHaveBeenCalledWith("article-id", photo);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: photo.blob,
    });
    expect(verifyUpload).toHaveBeenCalledWith(
      "article-id",
      "/objects/cover-staging/article-id/upload-id",
    );
  });

  it("does not request an upload target when the validated session is missing", async () => {
    const { deps, requestUploadUrl, put } = dependencies({ token: null });

    await expect(uploadCoverPhoto("article-id", photo, deps)).rejects.toMatchObject({
      code: "auth-expired",
    } satisfies Partial<CoverPhotoUploadError>);
    expect(requestUploadUrl).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("reports an expired session when the authenticated endpoint returns 401", async () => {
    const authError = new ApiError(
      new Response(JSON.stringify({ error: "expired" }), { status: 401 }),
      { error: "expired" },
      { method: "POST", url: "/api/articles/article-id/cover-image" },
    );
    const { deps, put } = dependencies({ requestError: authError });

    await expect(uploadCoverPhoto("article-id", photo, deps)).rejects.toMatchObject({
      code: "auth-expired",
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects oversized photos before any network request", async () => {
    const { deps, requestUploadUrl } = dependencies();

    await expect(
      uploadCoverPhoto(
        "article-id",
        { ...photo, size: MAX_COVER_PHOTO_BYTES + 1 },
        deps,
      ),
    ).rejects.toMatchObject({ code: "too-large" });
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("keeps upload failures retryable by returning a stable upload error", async () => {
    const { deps } = dependencies({
      putResponse: new Response(null, { status: 503 }),
    });

    await expect(uploadCoverPhoto("article-id", photo, deps)).rejects.toMatchObject({
      code: "upload-failed",
    });
  });

  it("does not return an image URL unless the server verifies the uploaded bytes", async () => {
    const { deps } = dependencies({ verifyError: new Error("invalid image") });

    await expect(uploadCoverPhoto("article-id", photo, deps)).rejects.toMatchObject({
      code: "upload-failed",
    });
  });
});