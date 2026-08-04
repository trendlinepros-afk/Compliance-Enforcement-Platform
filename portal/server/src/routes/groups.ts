import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireUser } from '../lib/auth';

export const groupsRouter = Router();
groupsRouter.use(requireUser);

groupsRouter.get(
  '/tenants/:tenantId/groups',
  ah(async (req, res) => {
    const groups = await prisma.computerGroup.findMany({
      where: { tenantId: req.params.tenantId },
      orderBy: { name: 'asc' },
      include: {
        members: { include: { computer: { select: { id: true, hostname: true, status: true } } } },
        assignments: { include: { policy: { select: { id: true, name: true } } } },
      },
    });
    res.json(
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        createdAt: g.createdAt,
        members: g.members.filter((m) => m.computer.status === 'ACTIVE').map((m) => m.computer),
        assignments: g.assignments.map((a) => ({ id: a.id, priority: a.priority, policy: a.policy })),
      })),
    );
  }),
);

const groupSchema = z.object({ name: z.string().min(1).max(120), description: z.string().max(500).default('') });

groupsRouter.post(
  '/tenants/:tenantId/groups',
  ah(async (req, res) => {
    const body = groupSchema.parse(req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
    if (!tenant) throw httpError(404, 'Tenant not found');
    const existing = await prisma.computerGroup.findFirst({ where: { tenantId: tenant.id, name: body.name } });
    if (existing) throw httpError(409, 'A group with this name already exists');
    const group = await prisma.computerGroup.create({ data: { ...body, tenantId: tenant.id } });
    res.status(201).json(group);
  }),
);

groupsRouter.patch(
  '/groups/:id',
  ah(async (req, res) => {
    const body = groupSchema.partial().parse(req.body);
    const group = await prisma.computerGroup.update({ where: { id: req.params.id }, data: body }).catch(() => null);
    if (!group) throw httpError(404, 'Group not found');
    res.json(group);
  }),
);

groupsRouter.delete(
  '/groups/:id',
  ah(async (req, res) => {
    await prisma.computerGroup.delete({ where: { id: req.params.id } }).catch(() => {
      throw httpError(404, 'Group not found');
    });
    res.json({ ok: true });
  }),
);

const membersSchema = z.object({ computerIds: z.array(z.string()).min(1) });

groupsRouter.post(
  '/groups/:id/members',
  ah(async (req, res) => {
    const { computerIds } = membersSchema.parse(req.body);
    const group = await prisma.computerGroup.findUnique({ where: { id: req.params.id } });
    if (!group) throw httpError(404, 'Group not found');
    const computers = await prisma.computer.findMany({
      where: { id: { in: computerIds }, tenantId: group.tenantId },
      select: { id: true },
    });
    await prisma.groupMember.createMany({
      data: computers.map((c) => ({ groupId: group.id, computerId: c.id })),
      skipDuplicates: true,
    });
    res.json({ added: computers.length });
  }),
);

groupsRouter.delete(
  '/groups/:id/members/:computerId',
  ah(async (req, res) => {
    await prisma.groupMember
      .delete({ where: { groupId_computerId: { groupId: req.params.id, computerId: req.params.computerId } } })
      .catch(() => {
        throw httpError(404, 'Membership not found');
      });
    res.json({ ok: true });
  }),
);
