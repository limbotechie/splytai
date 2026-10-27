"use client";

const MAX_DIMENSION = 1600;
const TARGET_MIME = "image/jpeg";
const JPEG_QUALITY = 0.82;
const MAX_PARSE_BYTES = 2_800_000; // backend cap is 3 MB; leave headroom for base64 overhead.

export interface CompressedImage {
  base64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteLength: number;
}

export async function compressForParse(file: File): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, TARGET_MIME, JPEG_QUALITY)
  );
  if (!blob) throw new Error("Failed to encode image");
  if (blob.size > MAX_PARSE_BYTES) {
    throw new Error("Image too large after compression. Try a smaller photo.");
  }

  const base64 = await blobToBase64(blob);
  return { base64, mimeType: "image/jpeg", byteLength: blob.size };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const data = reader.result;
      if (typeof data !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      const comma = data.indexOf(",");
      resolve(comma >= 0 ? data.slice(comma + 1) : data);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
