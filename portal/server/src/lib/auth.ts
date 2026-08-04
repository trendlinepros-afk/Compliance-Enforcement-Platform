import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../db';
import { httpError } from './errors';
import { hashDeviceToken } from './tokens';

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP recommended argon2id profile)
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (password: string) => argon2.hash(password, ARGON2_OPTS);
export const verifyPassword = (hash: string, password: string) =>
  argon2.verify(hash, password).catch(() => false);

export interface JwtPayload {
  sub: string;
  username: string;
  role: 'ADMIN' | 'TECH';
}

const COOKIE_NAME = 'cep_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export function issueSessionCookie(res: Response, payload: JwtPayload): void {
  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: SESSION_TTL_SECONDS });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https://'),
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: JwtPayload;
    computerId?: string;
  }
}

/** Require a logged-in portal user (any role). */
export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return next(httpError(401, 'Not authenticated'));
  try {
    req.user = jwt.verify(raw, config.jwtSecret) as JwtPayload;
    next();
  } catch {
    next(httpError(401, 'Session expired'));
  }
}

/** Require an ADMIN portal user. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireUser(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.user?.role !== 'ADMIN') return next(httpError(403, 'Admin role required'));
    next();
  });
}

/** Require a valid device token (agent endpoints). Sets req.computerId. */
export async function requireDevice(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw httpError(401, 'Device token required');
    const computer = await prisma.computer.findUnique({
      where: { deviceTokenHash: hashDeviceToken(match[1].trim()) },
      select: { id: true, status: true },
    });
    if (!computer) throw httpError(401, 'Invalid device token');
    if (computer.status === 'DECOMMISSIONED') throw httpError(401, 'Device decommissioned');
    req.computerId = computer.id;
    next();
  } catch (err) {
    next(err);
  }
}
