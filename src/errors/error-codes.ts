import { HttpStatus, type HttpException } from '@nestjs/common';

/**
 * Stable, machine-readable error codes (backend handover 2026-10-22, P-10). Every error response
 * has a `code` next to the human `message`, so the app can branch on the code instead of matching
 * message text. Messages may be reworded; codes don't change once published.
 */
export enum ErrorCode {
  // Generic, from the status (used when nothing more specific applies)
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_FAILED = 'VALIDATION_FAILED', // 400 with a list of field messages
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  GONE = 'GONE',
  PRECONDITION_FAILED = 'PRECONDITION_FAILED',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  // Auth
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  ACCOUNT_NOT_VERIFIED = 'ACCOUNT_NOT_VERIFIED',
  ACCOUNT_DELETED = 'ACCOUNT_DELETED',
  INVALID_CODE = 'INVALID_CODE', // wrong or expired OTP / verification / reset code
  TOO_MANY_ATTEMPTS = 'TOO_MANY_ATTEMPTS', // 5 wrong codes: request a new one
  REFRESH_TOKEN_INVALID = 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_REVOKED = 'REFRESH_TOKEN_REVOKED',
  ACCOUNT_EXISTS = 'ACCOUNT_EXISTS',
  USERNAME_TAKEN = 'USERNAME_TAKEN',

  // Features
  DRAFT_CHANGED = 'DRAFT_CHANGED', // itinerary If-Match mismatch (412)
  LIVE_LOCATION_UNAVAILABLE = 'LIVE_LOCATION_UNAVAILABLE', // Redis down (503)
  PROVIDER_BUSY = 'PROVIDER_BUSY', // an outside service is rate-limiting us (429)
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE', // an outside service failed or is off (503)
}

const CODE = Symbol('errorCode');

/** Tags an exception with a specific code; the message and status stay as they are. */
export function withCode<T extends HttpException>(exception: T, code: ErrorCode): T {
  (exception as T & { [CODE]?: ErrorCode })[CODE] = code;
  return exception;
}

export function codeOf(exception: HttpException): ErrorCode | undefined {
  return (exception as HttpException & { [CODE]?: ErrorCode })[CODE];
}

const BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.GONE]: ErrorCode.GONE,
  [HttpStatus.PRECONDITION_FAILED]: ErrorCode.PRECONDITION_FAILED,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.INTERNAL_ERROR,
};

/** The generic code for a status; a 400 carrying a list of messages is a validation failure. */
export function defaultCode(status: number, message?: unknown): string {
  if (status === HttpStatus.BAD_REQUEST && Array.isArray(message)) return ErrorCode.VALIDATION_FAILED;
  return BY_STATUS[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : `HTTP_${status}`);
}
