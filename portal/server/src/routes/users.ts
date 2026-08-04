import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { hashPassword, requireAdmin } from '../lib/auth';

export const usersRouter = Router();
usersRouter.use(requireAdmin);

const userSelect = { id: true, username: true, role: true, disabled: true, createdAt: true } as const;

usersRouter.get(
  '/',
  ah(async (_req, res) => {
    res.json(await prisma.user.findMany({ select: userSelect, orderBy: { username: 'asc' } }));
  }),
);

const createSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, dash, underscore only'),
  password: z.string().min(10).max(1024),
  role: z.enum(['ADMIN', 'TECH']).default('TECH'),
});

usersRouter.post(
  '/',
  ah(async (req, res) => {
    const body = createSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { username: body.username } });
    if (existing) throw httpError(409, 'Username already exists');
    const user = await prisma.user.create({
      data: { username: body.username, passwordHash: await hashPassword(body.password), role: body.role },
      select: userSelect,
    });
    res.status(201).json(user);
  }),
);

const patchSchema = z.object({
  role: z.enum(['ADMIN', 'TECH']).optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(10).max(1024).optional(),
});

usersRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const body = patchSchema.parse(req.body);
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw httpError(404, 'User not found');
    if (target.id === req.user!.sub && (body.disabled === true || (body.role && body.role !== 'ADMIN'))) {
      throw httpError(400, 'You cannot disable or demote your own account');
    }
    const user = await prisma.user.update({
      where: { id: target.id },
      data: {
        role: body.role,
        disabled: body.disabled,
        passwordHash: body.password ? await hashPassword(body.password) : undefined,
      },
      select: userSelect,
    });
    res.json(user);
  }),
);
