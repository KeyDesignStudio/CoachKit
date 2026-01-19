import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/errors';
import { z } from 'zod';
import { isPrismaInitError, logPrismaInitError } from '@/lib/prisma-diagnostics';

type ApiSuccess<T> = {
  data: T;
  error: null;
};

type ApiFailure = {
  data: null;
  error: {
    code: string;
    message: string;
    requestId?: string;
    httpStatus?: number;
    urlHost?: string;
    urlPath?: string;
    step?: string;
    resolvedSource?: string;
    headStatus?: number | null;
    contentType?: string | null;
    contentLength?: number | null;
    diagnostics?: Record<string, unknown>;
  };
};

export function success<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>({ data, error: null }, init);
}

export function failure(
  code: string,
  message: string,
  status = 400,
  requestId?: string,
  extras?: Partial<ApiFailure['error']>
) {
  return NextResponse.json<ApiFailure>(
    {
      data: null,
      error: {
        code,
        message,
        httpStatus: status,
        ...(requestId ? { requestId } : {}),
        ...(extras ?? {}),
      },
    },
    { status }
  );
}

export function handleError(
  error: unknown,
  options?: {
    requestId?: string;
    where?: string;
  }
) {
  if (isPrismaInitError(error)) {
    logPrismaInitError({
      requestId: options?.requestId,
      where: options?.where ?? 'handleError',
      error,
    });
    return failure('DB_UNREACHABLE', 'Database is unreachable.', 500, options?.requestId);
  }

  if (error instanceof ApiError) {
    return failure(error.code, error.message, error.status, options?.requestId, error.meta as any);
  }

  if (error instanceof z.ZodError) {
    const message = error.issues.map((issue) => issue.message).filter(Boolean).join(' ');
    return failure('VALIDATION_ERROR', message || 'Invalid request.', 400, options?.requestId);
  }

  console.error(error);
  return failure('INTERNAL_SERVER_ERROR', 'Something went wrong.', 500, options?.requestId);
}
