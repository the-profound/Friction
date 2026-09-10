import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type ArticleCoverUploadResponse,
  type ArticleCoverVerificationResponse,
} from "@workspace/api-client-react";
import {
  CoverPhotoUploadError,
  uploadNativeCoverFile,
  uploadCoverPhoto,
} from "./coverPhotoUpload";
import {
  MAX_COVER_PHOTO_BYTES,
  type SelectedCoverPhoto,
} from "./coverPhotoTypes";

const photo: SelectedCoverPhoto = {
  source: "web",
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
  nativeStatus?: number;
  putError?: Error;
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
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      if (overrides.putError) throw overrides.putError;
      return overrides.putResponse ?? new Response(null, { status: 200 });
    },
  );
  const putNativeFile = vi.fn(async () => ({
    status: overrides.nativeStatus ?? 200,
  }));
  return {
    deps: {
      getAccessToken: () => overrides.token === undefined ? "valid-token" : overrides.token,
      requestUploadUrl,
      verifyUpload,
      put: put as typeof fetch,
      putNativeFile,
      apiBaseUrl: "https://api.example.test",
    },
    requestUploadUrl,
    verifyUpload,
    put,
    putNativeFile,
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

  it("distinguishes an upload-target server failure from a network failure", async () => {
    const serverError = new ApiError(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
      { error: "unavailable" },
      { method: "POST", url: "/api/articles/article-id/cover-image" },
    );
    const server = dependencies({ requestError: serverError });
    const network = dependencies({ requestError: new TypeError("offline") });

    await expect(uploadCoverPhoto("article-id", photo, server.deps)).rejects.toMatchObject({
      code: "server-failed",
    });
    await expect(uploadCoverPhoto("article-id", photo, network.deps)).rejects.toMatchObject({
      code: "request-failed",
    });
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
      putResponse: new Response(null, { status: 403 }),
    });

    await expect(uploadCoverPhoto("article-id", photo, deps)).rejects.toMatchObject({
      code: "upload-failed",
    });
  });

  it("distinguishes signed PUT server and network failures", async () => {
    const server = dependencies({
      putResponse: new Response(null, { status: 503 }),
    });
    const network = dependencies({ putError: new TypeError("offline") });

    await expect(uploadCoverPhoto("article-id", photo, server.deps)).rejects.toMatchObject({
      code: "server-failed",
    });
    await expect(uploadCoverPhoto("article-id", photo, network.deps)).rejects.toMatchObject({
      code: "request-failed",
    });
  });

  it("uploads an iOS local file URI as native binary content without creating a Blob", async () => {
    const nativePhoto: SelectedCoverPhoto = {
      source: "native",
      uri: "file:///var/mobile/Containers/Data/screenshot.png",
      name: "screenshot.png",
      size: 8,
      contentType: "image/png",
    };
    const { deps, put, putNativeFile, verifyUpload } = dependencies();

    await expect(uploadCoverPhoto("article-id", nativePhoto, deps)).resolves.toContain(
      "/cover.jpg",
    );
    expect(put).not.toHaveBeenCalled();
    expect(putNativeFile).toHaveBeenCalledWith(
      "https://storage.example.test/upload",
      nativePhoto,
    );
    expect(verifyUpload).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "COVER_IMAGE_INVALID", "invalid-image"],
    [404, "COVER_IMAGE_STAGING_NOT_FOUND", "staged-missing"],
    [500, "COVER_IMAGE_VERIFY_FAILED", "server-failed"],
  ])(
    "preserves verify failure classification for status %s",
    async (status, code, expectedCode) => {
      const error = new ApiError(
        new Response(JSON.stringify({ error: "failure", code }), { status }),
        { error: "failure", code },
        { method: "POST", url: "/api/articles/article-id/cover-image/verify" },
      );
      const { deps } = dependencies({ verifyError: error });

      await expect(uploadCoverPhoto("article-id", photo, deps)).rejects.toMatchObject({
        code: expectedCode,
      });
    },
  );

  it("does not return an image URL unless the server verifies the uploaded bytes", async () => {
    const { deps } = dependencies({ verifyError: new Error("invalid image") });

    await expect(uploadCoverPhoto("article-id", photo, deps)).rejects.toMatchObject({
      code: "request-failed",
    });
  });
});

describe("uploadNativeCoverFile", () => {
  it("uses Expo binary PUT with the exact local URI and PNG content type", async () => {
    const upload = vi.fn(async () => ({
      status: 200,
      body: "",
      headers: {},
    }));
    const createFile = vi.fn(() => ({ upload }));
    const nativePhoto: SelectedCoverPhoto = {
      source: "native",
      uri: "file:///var/mobile/Containers/Data/screenshot.png",
      name: "screenshot.png",
      size: 8,
      contentType: "image/png",
    };

    await expect(
      uploadNativeCoverFile(
        "https://storage.example.test/upload",
        nativePhoto,
        async () => ({
          createFile,
          binaryUploadType: 0,
        }),
      ),
    ).resolves.toMatchObject({ status: 200 });
    expect(createFile).toHaveBeenCalledWith(nativePhoto.uri);
    expect(upload).toHaveBeenCalledWith(
      "https://storage.example.test/upload",
      {
        httpMethod: "PUT",
        uploadType: 0,
        headers: { "Content-Type": "image/png" },
        mimeType: "image/png",
        sessionType: "foreground",
      },
    );
  });
});