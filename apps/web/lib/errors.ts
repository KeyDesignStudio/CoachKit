export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
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
