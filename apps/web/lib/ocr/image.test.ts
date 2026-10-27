import { afterEach, describe, expect, it, vi } from "vitest";
import { validateReceiptImage, assertValidReceiptImage } from "./image";
import { MAX_IMAGE_BYTES } from "./types";

afterEach(() => vi.unstubAllGlobals());

describe("local OCR image validation", () => {
  it("rejects empty or missing files", async () => {
    const emptyBlob = new Blob([], { type: "image/jpeg" });
    const result = await validateReceiptImage(emptyBlob);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("empty");
    }
  });

  it("rejects files exceeding 10 MiB limit", async () => {
    const hugeBlob = {
      size: MAX_IMAGE_BYTES + 1024,
      type: "image/jpeg",
    } as unknown as Blob;

    const result = await validateReceiptImage(hugeBlob);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("10 MiB limit");
    }
  });

  it("rejects unsupported MIME formats (GIF, PDF, text)", async () => {
    const gifBlob = new Blob(["gif-data"], { type: "image/gif" });
    const result = await validateReceiptImage(gifBlob);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Unsupported image format");
    }

    const pdfBlob = new Blob(["pdf-data"], { type: "application/pdf" });
    expect((await validateReceiptImage(pdfBlob)).valid).toBe(false);
  });

  it("accepts supported formats (JPEG, PNG, WebP)", async () => {
    const mockDecoder = async () => ({ width: 1000, height: 1500 });

    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const png = new Blob(["png"], { type: "image/png" });
    const webp = new Blob(["webp"], { type: "image/webp" });

    expect((await validateReceiptImage(jpeg, mockDecoder)).valid).toBe(true);
    expect((await validateReceiptImage(png, mockDecoder)).valid).toBe(true);
    expect((await validateReceiptImage(webp, mockDecoder)).valid).toBe(true);
  });

  it("fails explicitly when no real browser decoder is available", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("Image", undefined);
    const blob = new Blob(["not an image"], { type: "image/png" });
    expect(await validateReceiptImage(blob)).toEqual({
      valid: false,
      error: "This browser cannot decode receipt images. Use manual receipt entry instead.",
    });
    await expect(assertValidReceiptImage(blob)).rejects.toThrow(/manual receipt entry/);
  });

  it("guards against undersized and oversized decoded dimensions", async () => {
    const blob = new Blob(["data"], { type: "image/jpeg" });

    // Too small (< 50 px)
    const tooSmall = await validateReceiptImage(blob, async () => ({ width: 30, height: 40 }));
    expect(tooSmall.valid).toBe(false);
    if (!tooSmall.valid) {
      expect(tooSmall.error).toContain("too small");
    }

    // Too large dimension (> 8192 px)
    const tooLarge = await validateReceiptImage(blob, async () => ({ width: 9000, height: 1000 }));
    expect(tooLarge.valid).toBe(false);
    if (!tooLarge.valid) {
      expect(tooLarge.error).toContain("exceed the maximum");
    }

    // Too many pixels (> 16 MP)
    const tooManyPixels = await validateReceiptImage(blob, async () => ({ width: 5000, height: 5000 }));
    expect(tooManyPixels.valid).toBe(false);
    if (!tooManyPixels.valid) {
      expect(tooManyPixels.error).toContain("16 megapixel ceiling");
    }
  });

  it("assertValidReceiptImage returns valid info or throws", async () => {
    const mockDecoder = async () => ({ width: 1200, height: 1600 });
    const blob = new Blob(["data"], { type: "image/jpeg" });

    const valid = await assertValidReceiptImage(blob, mockDecoder);
    expect(valid.valid).toBe(true);
    expect(valid.width).toBe(1200);
    expect(valid.height).toBe(1600);
    expect(valid.mimeType).toBe("image/jpeg");

    await expect(assertValidReceiptImage(new Blob([], { type: "image/jpeg" }), mockDecoder)).rejects.toThrow("empty");
  });
});
