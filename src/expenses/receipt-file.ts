export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export interface ReceiptType {
  contentType: string;
  extension: string;
}

/**
 * Identifies a receipt upload from its first bytes (magic numbers), not from the file name or
 * the client's Content-Type, which can't be trusted. Accepts photos (JPEG, PNG, WebP, HEIC/HEIF,
 * the iPhone default) and PDF invoices. Returns null for anything else.
 */
export function detectReceiptType(data: Buffer): ReceiptType | null {
  const ascii = (start: number, end: number) => data.subarray(start, end).toString('latin1');
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { contentType: 'image/webp', extension: 'webp' };
  if (ascii(4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(ascii(8, 12))) {
    return { contentType: 'image/heic', extension: 'heic' };
  }
  if (ascii(0, 5) === '%PDF-') return { contentType: 'application/pdf', extension: 'pdf' };
  return null;
}
