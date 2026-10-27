/**
 * Bounded client-side image validation.
 *
 * Verifies byte size, MIME type, and decoded dimensions before passing
 * images to the OCR worker. Images are decoded in-memory and never uploaded.
 */

import {
  ALLOWED_IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MIN_IMAGE_DIMENSION,
  type AllowedImageMime,
  type ImageValidationResult,
} from "./types";

export interface ImageDimensionReader {
  (file: Blob): Promise<{ width: number; height: number }>;
}

/**
 * Default browser dimension reader using createImageBitmap or HTMLImageElement.
 */
async function defaultDecodeDimensions(file: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close?.();
      return { width, height };
    } catch {
      throw new Error("Could not decode image. The file may be corrupt or an unsupported format.");
    }
  }

  if (typeof Image !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not decode image. The file may be corrupt or an unsupported format."));
      };
      img.src = url;
    });
  }

  throw new Error("This browser cannot decode receipt images. Use manual receipt entry instead.");
}

/**
 * Validates a receipt image against size, MIME, and decoded dimension bounds.
 */
export async function validateReceiptImage(
  file: Blob | File,
  dimensionReader: ImageDimensionReader = defaultDecodeDimensions,
): Promise<ImageValidationResult> {
  if (!file || typeof file.size !== "number") {
    return { valid: false, error: "Please select a valid image file." };
  }

  // 1. File size check
  if (file.size === 0) {
    return { valid: false, error: "The selected image file is empty." };
  }

  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `Image size (${mb} MiB) exceeds the 10 MiB limit. Please choose a smaller photo.`,
    };
  }

  // 2. MIME type check
  const mime = file.type?.toLowerCase();
  if (!mime || !ALLOWED_IMAGE_MIMES.includes(mime as AllowedImageMime)) {
    return {
      valid: false,
      error: "Unsupported image format. Please use JPEG, PNG, or WebP.",
    };
  }

  // 3. Decoded dimensions check
  try {
    const { width, height } = await dimensionReader(file);

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < MIN_IMAGE_DIMENSION ||
      height < MIN_IMAGE_DIMENSION
    ) {
      return {
        valid: false,
        error: `Image dimensions (${width}x${height}) are too small for text recognition. Minimum is ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}.`,
      };
    }

    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      return {
        valid: false,
        error: `Image dimensions (${width}x${height}) exceed the maximum permitted (${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}).`,
      };
    }

    const pixels = width * height;
    if (pixels > MAX_IMAGE_PIXELS) {
      return {
        valid: false,
        error: "Image resolution exceeds the 16 megapixel ceiling. Please scale down before scanning.",
      };
    }

    return {
      valid: true,
      width,
      height,
      mimeType: mime as AllowedImageMime,
      byteLength: file.size,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Failed to decode image dimensions.",
    };
  }
}

/**
 * Asserts an image is valid or throws an error.
 */
export async function assertValidReceiptImage(
  file: Blob | File,
  dimensionReader?: ImageDimensionReader,
): Promise<Extract<ImageValidationResult, { valid: true }>> {
  const result = await validateReceiptImage(file, dimensionReader);
  if (!result.valid) {
    throw new Error(result.error);
  }
  return result;
}
