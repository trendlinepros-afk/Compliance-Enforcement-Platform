import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status: number, message: string) => new HttpError(status, message);

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/** Wrap an async route handler so rejections reach the error middleware. */
export const ah =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Multer and body-parser style errors carry a status.
  const anyErr = err as { status?: number; message?: string };
  if (anyErr && typeof anyErr.status === 'number' && anyErr.status < 500) {
    res.status(anyErr.status).json({ error: anyErr.message ?? 'Request error' });
    return;
  }
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
