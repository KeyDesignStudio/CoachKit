export class ApiError extends Error {
  status: number;
  code: string;
  meta?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

export function unauthorized(message = 'Authentication required.') {
  return new ApiError(401, 'UNAUTHORIZED', message);
}

export function forbidden(message = 'Forbidden.') {
  return new ApiError(403, 'FORBIDDEN', message);
}

export function notFound(message = 'Not found.') {
  return new ApiError(404, 'NOT_FOUND', message);
}
