import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireUser } from '../lib/auth';

export const assignmentsRouter = Router();
assignmentsRouter.use(requireUser);

assignmentsRouter.get(
  '/tenants/:tenantId/assignments',
  ah(async (req, res) => {
    const assignments = await prisma.assignment.findMany({
      where: { tenantId: req.params.tenantId },
      include: {
        policy: { select: { id: true, name: true, type: true } },
        group: { select: { id: true, name: true } },
        computer: { select: { id: true, hostname: true } },
      },
      orderBy: [{ scope: 'asc' }, { priority: 'desc' }],
    });
    res.json(assignments);
  }),
);

const createSchema = z
  .object({
    policyId: z.string(),
    scope: z.enum(['TENANT', 'GROUP', 'COMPUTER']),
    groupId: z.string().optional(),
    computerId: z.string().optional(),
    priority: z.number().int().min(-1000).max(1000).default(0),
  })
  .refine((v) => (v.scope === 'GROUP' ? !!v.groupId : true), { message: 'groupId required for GROUP scope' })
  .refine((v) => (v.scope === 'COMPUTER' ? !!v.computerId : true), { message: 'computerId required for COMPUTER scope' });

assignmentsRouter.post(
  '/tenants/:tenantId/assignments',
  ah(async (req, res) => {
    const body = createSchema.parse(req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
    if (!tenant) throw httpError(404, 'Tenant not found');
    const policy = await prisma.policy.findUnique({ where: { id: body.policyId } });
    if (!policy) throw httpError(404, 'Policy not found');
    if (policy.type === 'SUB' && policy.tenantId !== tenant.id) {
      throw httpError(400, 'Sub-policy belongs to a different tenant');
    }
    if (body.scope === 'GROUP') {
      const group = await prisma.computerGroup.findFirst({ where: { id: body.groupId!, tenantId: tenant.id } });
      if (!group) throw httpError(404, 'Group not found in this tenant');
    }
    if (body.scope === 'COMPUTER') {
      const computer = await prisma.computer.findFirst({ where: { id: body.computerId!, tenantId: tenant.id } });
      if (!computer) throw httpError(404, 'Computer not found in this tenant');
    }
    const duplicate = await prisma.assignment.findFirst({
      where: {
        tenantId: tenant.id,
        policyId: policy.id,
        scope: body.scope,
        groupId: body.scope === 'GROUP' ? body.groupId : null,
        computerId: body.scope === 'COMPUTER' ? body.computerId : null,
      },
    });
    if (duplicate) throw httpError(409, 'This assignment already exists');
    const assignment = await prisma.assignment.create({
      data: {
        tenantId: tenant.id,
        policyId: policy.id,
        scope: body.scope,
        groupId: body.scope === 'GROUP' ? body.groupId : null,
        computerId: body.scope === 'COMPUTER' ? body.computerId : null,
        priority: body.priority,
      },
      include: {
        policy: { select: { id: true, name: true, type: true } },
        group: { select: { id: true, name: true } },
        computer: { select: { id: true, hostname: true } },
      },
    });
    res.status(201).json(assignment);
  }),
);

assignmentsRouter.patch(
  '/assignments/:id',
  ah(async (req, res) => {
    const body = z.object({ priority: z.number().int().min(-1000).max(1000) }).parse(req.body);
    const assignment = await prisma.assignment
      .update({ where: { id: req.params.id }, data: { priority: body.priority } })
      .catch(() => null);
    if (!assignment) throw httpError(404, 'Assignment not found');
    res.json(assignment);
  }),
);

assignmentsRouter.delete(
  '/assignments/:id',
  ah(async (req, res) => {
    await prisma.assignment.delete({ where: { id: req.params.id } }).catch(() => {
      throw httpError(404, 'Assignment not found');
    });
    res.json({ ok: true });
  }),
);
