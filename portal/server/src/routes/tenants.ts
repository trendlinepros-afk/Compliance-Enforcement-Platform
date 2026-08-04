import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireAdmin, requireUser } from '../lib/auth';
import { randomToken } from '../lib/tokens';
import { config } from '../config';
import { getComplianceSummaries } from '../services/computerPolicy';

export const tenantsRouter = Router();
tenantsRouter.use(requireUser);

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tenant';

tenantsRouter.get(
  '/',
  ah(async (_req, res) => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { computers: true, policies: true, groups: true } } },
    });
    const allComputers = await prisma.computer.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, tenantId: true, lastSeenAt: true },
    });
    const compliance = await getComplianceSummaries(allComputers.map((c) => c.id));
    const now = Date.now();
    res.json(
      tenants.map((t) => {
        const computers = allComputers.filter((c) => c.tenantId === t.id);
        const online = computers.filter(
          (c) => c.lastSeenAt && now - c.lastSeenAt.getTime() < config.onlineWindowSeconds * 1000,
        ).length;
        const pcts = computers.map((c) => compliance.get(c.id)?.percent).filter((p): p is number => p != null);
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          enforcementPaused: t.enforcementPaused,
          createdAt: t.createdAt,
          computerCount: computers.length,
          onlineCount: online,
          policyCount: t._count.policies,
          groupCount: t._count.groups,
          avgCompliance: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null,
        };
      }),
    );
  }),
);

const createSchema = z.object({ name: z.string().min(1).max(120), slug: z.string().max(60).optional() });

tenantsRouter.post(
  '/',
  requireAdmin,
  ah(async (req, res) => {
    const body = createSchema.parse(req.body);
    const slug = body.slug ? slugify(body.slug) : slugify(body.name);
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (existing) throw httpError(409, `Slug "${slug}" is already in use`);
    const tenant = await prisma.tenant.create({
      data: { name: body.name, slug, enrollToken: randomToken(24) },
    });
    res.status(201).json(tenant);
  }),
);

tenantsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
    if (!tenant) throw httpError(404, 'Tenant not found');
    res.json({ ...tenant, publicUrl: config.publicUrl });
  }),
);

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enforcementPaused: z.boolean().optional(),
});

tenantsRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const body = patchSchema.parse(req.body);
    const tenant = await prisma.tenant.update({ where: { id: req.params.id }, data: body }).catch(() => null);
    if (!tenant) throw httpError(404, 'Tenant not found');
    res.json(tenant);
  }),
);

tenantsRouter.delete(
  '/:id',
  requireAdmin,
  ah(async (req, res) => {
    await prisma.tenant.delete({ where: { id: req.params.id } }).catch(() => {
      throw httpError(404, 'Tenant not found');
    });
    res.json({ ok: true });
  }),
);

tenantsRouter.post(
  '/:id/regenerate-token',
  requireAdmin,
  ah(async (req, res) => {
    const tenant = await prisma.tenant
      .update({ where: { id: req.params.id }, data: { enrollToken: randomToken(24) } })
      .catch(() => null);
    if (!tenant) throw httpError(404, 'Tenant not found');
    res.json({ enrollToken: tenant.enrollToken });
  }),
);
