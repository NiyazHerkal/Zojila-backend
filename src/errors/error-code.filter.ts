import { Catch, HttpException, type ArgumentsHost, type HttpServer } from '@nestjs/common';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { codeOf, defaultCode } from './error-codes.js';

/**
 * Adds `code` (see ErrorCode) to every HTTP error body, including those from guards, the rate
 * limiter and validation. Everything else is Sentry's filter as before: unexpected errors are
 * still reported, and the body otherwise keeps Nest's shape (`statusCode`, `message`, `error`).
 * Socket errors are left alone.
 */
@Catch()
export class ErrorCodeFilter extends SentryGlobalFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http' && exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const body: Record<string, unknown> =
        typeof res === 'object' && res !== null ? { ...res } : { statusCode: status, message: res };
      body.code = codeOf(exception) ?? body.code ?? defaultCode(status, body.message);
      return super.catch(new HttpException(body, status, { cause: exception }), host);
    }
    return super.catch(exception, host);
  }

  /** Unexpected errors (500 and http-errors): same body as before, plus the code. */
  override handleUnknownError(exception: unknown, host: ArgumentsHost, applicationRef: HttpServer): void {
    const withCode = Object.create(applicationRef, {
      reply: {
        value: (response: unknown, body: Record<string, unknown>, status: number) =>
          applicationRef.reply(response, { ...body, code: defaultCode(status) }, status),
      },
    }) as HttpServer;
    super.handleUnknownError(exception, host, withCode);
  }
}
