import { HttpException } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { codeOf, defaultCode, ErrorCode } from '../errors/error-codes.js';

/**
 * What every inbound socket event answers through its acknowledgement callback:
 * `socket.emit('chat:send', payload, (res) => …)` → `{ ok: true, data }` or
 * `{ ok: false, error: { status, message, code } }` (status and code are the ones the REST API uses).
 */
export type WsAck<T> = { ok: true; data: T } | { ok: false; error: { status: number; message: string; code: string } };

class WsValidationError extends Error {}

/**
 * Validates a socket payload against a class-validator DTO (the global ValidationPipe only
 * covers HTTP routes here). Adapted from the nestbeacon-api `validateWsPayload` helper.
 */
export async function validateWsPayload<T extends object>(dto: ClassConstructor<T>, payload: unknown): Promise<T> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new WsValidationError('Payload must be a JSON object');
  }
  const instance = plainToInstance(dto, payload);
  const errors = await validate(instance, { whitelist: true, forbidUnknownValues: true });
  if (errors.length) {
    let first = errors[0];
    while (!first.constraints && first.children?.length) first = first.children[0]; // nested objects
    const message = first.constraints
      ? Object.values(first.constraints)[0]
      : `${first.property} is invalid`;
    throw new WsValidationError(message);
  }
  return instance;
}

/** Runs a socket handler and turns its result or error into a WsAck. */
export async function wsAck<T>(fn: () => Promise<T>, onUnexpected: (err: Error) => void): Promise<WsAck<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof WsValidationError) return { ok: false, error: { status: 400, message: err.message, code: ErrorCode.VALIDATION_FAILED } };
    if (err instanceof HttpException) {
      const res = err.getResponse();
      const message =
        typeof res === 'object' && res && 'message' in res
          ? ([] as string[]).concat((res as { message: string | string[] }).message).join('; ')
          : err.message;
      const status = err.getStatus();
      return { ok: false, error: { status, message, code: codeOf(err) ?? defaultCode(status) } };
    }
    onUnexpected(err as Error);
    return { ok: false, error: { status: 500, message: 'Something went wrong', code: defaultCode(500) } };
  }
}
