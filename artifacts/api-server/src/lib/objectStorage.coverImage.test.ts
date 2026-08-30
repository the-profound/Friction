import { describe, expect, it } from "vitest";
import {
  InvalidCoverImageError,
  detectCoverImageType,
  inspectCoverImageBytes,
} from "./objectStorage";

describe("detectCoverImageType", () => {
  it.each([
    [Buffer.from([0xff, 0xd8, 0xff, 0xdb]), "image/jpeg"],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [Buffer.from("GIF89a....", "ascii"), "image/gif"],
    [Buffer.from("RIFF0000WEBP", "ascii"), "image/webp"],
    [Buffer.from("0000ftypheic", "ascii"), "image/heic"],
    [Buffer.from("0000ftypavif", "ascii"), "image/avif"],
  ])("recognizes verified raster image bytes", (bytes, contentType) => {
    expect(detectCoverImageType(bytes)?.contentType).toBe(contentType);
  });

  it("rejects HTML even when it was uploaded with an image content type", () => {
    expect(detectCoverImageType(Buffer.from("<html>not an image</html>"))).toBeNull();
  });

  it("enforces the limit against the exact bytes selected for publication", () => {
    const oversized = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(8),
    ]);
    expect(() => inspectCoverImageBytes(oversized, 10)).toThrow(
      InvalidCoverImageError,
    );
  });
});