export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const VOICE_MAX_DURATION_MS = 2 * 60 * 1000;

export interface VoiceType {
  contentType: string;
  extension: string;
}

// MP4-family brands used for audio recordings (iOS / Android recorders write M4A with these).
const MP4_AUDIO_BRANDS = ['M4A ', 'M4B ', 'mp42', 'mp41', 'isom', 'iso2', 'iso5', 'dash'];

/**
 * Identifies a voice message from its first bytes, not from the file name or the client's
 * Content-Type. Accepts AAC in an M4A/MP4 container (iOS and most Android recorders), raw AAC
 * (ADTS) and Ogg (Opus). An MP4 with a video track is refused: chat carries no video (change
 * request v1.0, change 8). Returns null for anything else.
 */
export function detectVoiceType(data: Buffer): VoiceType | null {
  if (data.length < 12) return null;
  const ascii = (start: number, end: number) => data.subarray(start, end).toString('latin1');
  if (ascii(4, 8) === 'ftyp' && MP4_AUDIO_BRANDS.includes(ascii(8, 12))) {
    return hasVideoTrack(data) ? null : { contentType: 'audio/mp4', extension: 'm4a' };
  }
  if (data[0] === 0xff && (data[1] & 0xf6) === 0xf0) return { contentType: 'audio/aac', extension: 'aac' }; // ADTS sync word
  if (ascii(0, 4) === 'OggS') return { contentType: 'audio/ogg', extension: 'ogg' };
  return null;
}

/** MP4 tracks declare their type in a `hdlr` box: handler `vide` = video. */
function hasVideoTrack(data: Buffer): boolean {
  for (let i = data.indexOf('hdlr', 0, 'latin1'); i !== -1; i = data.indexOf('hdlr', i + 4, 'latin1')) {
    // box type, then version/flags (4 bytes) and pre_defined (4 bytes), then the handler type.
    if (data.subarray(i + 12, i + 16).toString('latin1') === 'vide') return true;
  }
  return false;
}
