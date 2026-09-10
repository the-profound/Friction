import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

import {
  CoverPhotoPickerError,
  selectedNativeCoverPhoto,
} from "./coverPhotoPicker";
import { MAX_COVER_PHOTO_BYTES } from "./coverPhotoTypes";

describe("selectedNativeCoverPhoto", () => {
  it("preserves an iOS screenshot URI, PNG MIME type, and picker byte size without reading a Blob", async () => {
    const readFileSize = vi.fn();

    await expect(
      selectedNativeCoverPhoto(
        {
          uri: "file:///var/mobile/Containers/Data/screenshot.png",
          fileName: "IMG_1234.PNG",
          fileSize: 2_048,
          mimeType: "image/png",
        },
        readFileSize,
      ),
    ).resolves.toEqual({
      source: "native",
      uri: "file:///var/mobile/Containers/Data/screenshot.png",
      name: "IMG_1234.PNG",
      size: 2_048,
      contentType: "image/png",
    });
    expect(readFileSize).not.toHaveBeenCalled();
  });

  it("reads native file metadata when the picker omits the size", async () => {
    const readFileSize = vi.fn(async () => 4_096);

    await expect(
      selectedNativeCoverPhoto(
        {
          uri: "file:///data/user/0/app/cache/photo.jpg",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
        },
        readFileSize,
      ),
    ).resolves.toMatchObject({ source: "native", size: 4_096 });
    expect(readFileSize).toHaveBeenCalledWith(
      "file:///data/user/0/app/cache/photo.jpg",
    );
  });

  it("keeps the 10MB limit before native upload starts", async () => {
    await expect(
      selectedNativeCoverPhoto({
        uri: "file:///var/mobile/Containers/Data/large.png",
        fileSize: MAX_COVER_PHOTO_BYTES + 1,
        mimeType: "image/png",
      }),
    ).rejects.toMatchObject({
      code: "too-large",
    } satisfies Partial<CoverPhotoPickerError>);
  });
});