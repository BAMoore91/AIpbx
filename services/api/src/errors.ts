/** Application error carrying an HTTP status and a stable error code. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Unauthorized') =>
  new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Forbidden') =>
  new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found') =>
  new AppError(404, 'not_found', msg);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);
