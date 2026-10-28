import { BadRequestException, Logger, type ArgumentsHost, type HttpServer } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCodeFilter } from './error-code.filter.js';
import { codeOf, defaultCode, ErrorCode, withCode } from './error-codes.js';

describe('error codes', () => {
  it('maps statuses to generic codes', () => {
    expect(defaultCode(400)).toBe('BAD_REQUEST');
    expect(defaultCode(400, ['name must be a string'])).toBe('VALIDATION_FAILED');
    expect(defaultCode(404)).toBe('NOT_FOUND');
    expect(defaultCode(429)).toBe('RATE_LIMITED');
    expect(defaultCode(418)).toBe('HTTP_418');
    expect(defaultCode(502)).toBe('INTERNAL_ERROR');
  });

  it('tags an exception without changing its message', () => {
    const e = withCode(new BadRequestException('Invalid or expired code'), ErrorCode.INVALID_CODE);
    expect(codeOf(e)).toBe('INVALID_CODE');
    expect(e.getResponse()).toMatchObject({ message: 'Invalid or expired code' });
    expect(codeOf(new BadRequestException('x'))).toBeUndefined();
  });

  it('adds INTERNAL_ERROR to the body of an unexpected error', () => {
    const reply = vi.fn();
    const adapter = { reply, isHeadersSent: () => false, end: vi.fn() } as unknown as HttpServer;
    const host = { getType: () => 'http', getArgByIndex: () => ({}) } as unknown as ArgumentsHost;
    const filter = new ErrorCodeFilter(adapter);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); // the expected 'boom'
    filter.handleUnknownError(new Error('boom'), host, adapter);
    expect(reply).toHaveBeenCalledWith(
      {},
      { statusCode: 500, message: 'Internal server error', code: 'INTERNAL_ERROR' },
      500,
    );
  });
});
