import { detectReceiptType, type ReceiptType } from '../expenses/receipt-file.js';

/** Limit for display images: trip cover images and profile pictures. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Identifies a display image (trip cover, profile picture) from its first bytes, using the same
 * magic-number check as receipts, but accepts only JPEG, PNG and WebP, which every client can
 * display. Returns null for anything else.
 */
export function detectImageType(data: Buffer): ReceiptType | null {
  const type = detectReceiptType(data);
  return type && IMAGE_TYPES.includes(type.contentType) ? type : null;
}
