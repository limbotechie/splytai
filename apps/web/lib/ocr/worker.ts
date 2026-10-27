/**
 * Local OCR Worker wrapper.
 *
 * Configures Tesseract.js to use ONLY local, self-hosted static assets.
 * Guarantees worker cleanup after execution.
 */

import { createWorker } from "tesseract.js";
import type { OcrProgress } from "./types";

export interface OcrRecognizeResult {
  text: string;
  confidence: number;
}

export interface WorkerRunner {
  (
    image: Blob | File | string,
    onProgress?: (progress: OcrProgress) => void,
  ): Promise<OcrRecognizeResult>;
}

/**
 * Runs client-side recognition using the local self-hosted worker.
 */
export async function defaultRecognizeReceipt(
  image: Blob | File | string,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrRecognizeResult> {
  const worker = await createWorker("eng", 1, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang-data",
    gzip: true,
    logger: (m) => {
      if (onProgress && m && typeof m.progress === "number") {
        onProgress({
          status: m.status || "processing",
          progress: Math.min(1, Math.max(0, m.progress)),
        });
      }
    },
  });

  try {
    const result = await worker.recognize(image);
    if (typeof result.data.text !== "string" || !Number.isFinite(result.data.confidence)) {
      throw new Error("Receipt recognition did not return a valid result. Enter the receipt manually instead.");
    }
    return {
      text: result.data.text,
      confidence: result.data.confidence,
    };
  } finally {
    try {
      await worker.terminate();
    } catch {
      // Ignore worker termination errors
    }
  }
}
