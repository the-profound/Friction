import { describe, expect, it } from "vitest";
import {
  getInlineImageTransformUrl,
  isPersistableInlineImageUrl,
  removeUnpersistableInlineImages,
} from "../inlineImages";
import {
  getInlineImageResizeAction,
  INLINE_IMAGE_COMPRESSION,
} from "../inlineImagePreparation";

describe("inline image persistence", () => {
  it("does not let unfinished device URLs reach saved markdown", () => {
    const markdown = [
      "시작",
      "![local](file:///private/photo.jpg)",
      "![camera](ph://A1B2)",
      "![remote](https://example.com/image.jpg)",
      "![legacy](http://legacy.example/image.jpg)",
    ].join("\n\n");

    expect(removeUnpersistableInlineImages(markdown)).toContain("https://example.com/image.jpg");
    expect(removeUnpersistableInlineImages(markdown)).toContain("http://legacy.example/image.jpg");
    expect(removeUnpersistableInlineImages(markdown)).not.toContain("file://");
    expect(removeUnpersistableInlineImages(markdown)).not.toContain("ph://");
    expect(removeUnpersistableInlineImages(markdown)).not.toContain("data:image/");
    expect(isPersistableInlineImageUrl("blob:https://app/123")).toBe(false);
  });

  it("uses only Supabase public originals for width-aware transforms", () => {
    const original =
      "https://project.supabase.co/storage/v1/object/public/inline-images/originals/user/photo.jpg";
    expect(getInlineImageTransformUrl(original, 240, 3, "https://project.supabase.co")).toBe(
      "https://project.supabase.co/storage/v1/render/image/public/inline-images/originals/user/photo.jpg?width=720&resize=contain&quality=80",
    );
    expect(getInlineImageTransformUrl(original, 900, 3, "https://project.supabase.co")).toContain(
      "width=1600",
    );
    expect(getInlineImageTransformUrl("https://legacy.example/photo.jpg", 240, 2, "https://project.supabase.co")).toBe(
      "https://legacy.example/photo.jpg",
    );
  });
});

describe("inline image preparation", () => {
  it("limits the longest edge to 1600px before the JPEG re-encode", () => {
    expect(getInlineImageResizeAction(3200, 1800)).toEqual({ width: 1600 });
    expect(getInlineImageResizeAction(1200, 2400)).toEqual({ height: 1600 });
    expect(getInlineImageResizeAction(1200, 900)).toBeNull();
    expect(INLINE_IMAGE_COMPRESSION).toBe(0.8);
  });
});