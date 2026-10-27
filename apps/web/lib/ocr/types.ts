/**
 * Types and bounds for the local receipt OCR pipeline.
 *
 * Enforces strict limits:
 *   - Bounded file size (max 10 MB)
 *   - Allowed MIME types (JPEG, PNG, WebP)
 *   - Decoded dimension bounds (min 50x50, max 8192x8192, max 16MP total)
 *   - Mandatory human review before conversion to BillManifest
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export const MIN_IMAGE_DIMENSION = 50; // pixels
export const MAX_IMAGE_DIMENSION = 8192; // pixels
export const MAX_IMAGE_PIXELS = 4096 * 4096; // 16,777,216 pixels (~16 MP)

export type ImageValidationResult =
  | {
      valid: true;
      width: number;
      height: number;
      mimeType: AllowedImageMime;
      byteLength: number;
    }
  | {
      valid: false;
      error: string;
    };

export interface OcrProgress {
  status: string;
  progress: number; // 0.0 to 1.0
}

export interface ParsedItemCandidate {
  id: string;
  label: string;
  amountMinor: string;
  assigneeIds: string[];
}

export interface ParsedReceiptCandidate {
  title: string;
  currency: string;
  scale: number;
  items: ParsedItemCandidate[];
  subtotalMinor: string;
  taxMinor: string;
  tipMinor: string;
  discountMinor: string;
  totalMinor: string;
  rawText: string;
  confidence: number;
  reviewed: false;
}

export interface ManualReceiptInput {
  title: string;
  currency?: string;
  scale?: number;
  items: {
    id?: string;
    label: string;
    amountMinor: string;
    assigneeIds?: string[];
  }[];
  taxMinor?: string;
  tipMinor?: string;
  discountMinor?: string;
  totalMinor?: string;
}

export interface ReceiptReviewEdits {
  title?: string;
  currency?: string;
  scale?: number;
  items?: {
    id?: string;
    label: string;
    amountMinor: string;
    assigneeIds?: string[];
  }[];
  taxMinor?: string;
  tipMinor?: string;
  discountMinor?: string;
  totalMinor?: string;
}
