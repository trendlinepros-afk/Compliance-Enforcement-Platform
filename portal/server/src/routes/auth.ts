import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { clearSessionCookie, issueSessionCookie, requireUser, verifyPassword } from '../lib/auth';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts; try again later' },
});

const loginSchema = z.object({ username: z.string().min(1).max(128), password: z.string().min(1).max(1024) });

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || user.disabled) throw httpError(401, 'Invalid username or password');
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw httpError(401, 'Invalid username or password');
    issueSessionCookie(res, { sub: user.id, username: user.username, role: user.role });
    res.json({ id: user.id, username: user.username, role: user.role });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireUser,
  ah(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { id: true, username: true, role: true, disabled: true },
    });
    if (!user || user.disabled) throw httpError(401, 'Not authenticated');
    res.json(user);
  }),
);
