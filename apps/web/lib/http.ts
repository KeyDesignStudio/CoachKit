import { NextResponse } from 'next/server';
import { ApiError } from '@/lib/errors';
import { z } from 'zod';

type ApiSuccess<T> = {
  data: T;
  error: null;
};

type ApiFailure = {
  data: null;
  error: {
    code: string;
    message: string;
  };
};

export function success<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>({ data, error: null }, init);
}

export function failure(code: string, message: string, status = 400) {
  return NextResponse.json<ApiFailure>({ data: null, error: { code, message } }, { status });
}

export function handleError(error: unknown) {
  if (error instanceof ApiError) {
    return failure(error.code, error.message, error.status);
  }

  if (error instanceof z.ZodError) {
    const message = error.issues.map((issue) => issue.message).filter(Boolean).join(' ');
    return failure('VALIDATION_ERROR', message || 'Invalid request.', 400);
  }

  console.error(error);
  return failure('INTERNAL_SERVER_ERROR', 'Something went wrong.', 500);
}
