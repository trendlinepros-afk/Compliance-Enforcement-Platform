import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireUser } from '../lib/auth';
import { getSeededPolicyDefinition } from '../seed/globalPolicies';

export const policiesRouter = Router();
policiesRouter.use(requireUser);

const policyListSelect = {
  id: true,
  type: true,
  tenantId: true,
  name: true,
  description: true,
  isSeeded: true,
  seedKey: true,
  clonedFromId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { settings: true, assignments: true } },
} satisfies Prisma.PolicySelect;

policiesRouter.get(
  '/policies/global',
  ah(async (_req, res) => {
    res.json(await prisma.policy.findMany({ where: { type: 'GLOBAL' }, select: policyListSelect, orderBy: { name: 'asc' } }));
  }),
);

policiesRouter.get(
  '/tenants/:tenantId/policies',
  ah(async (req, res) => {
    res.json(
      await prisma.policy.findMany({
        where: { tenantId: req.params.tenantId, type: 'SUB' },
        select: policyListSelect,
        orderBy: { name: 'asc' },
      }),
    );
  }),
);

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  tenantId: z.string().optional(), // present -> SUB policy
});

policiesRouter.post(
  '/policies',
  ah(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (body.tenantId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } });
      if (!tenant) throw httpError(404, 'Tenant not found');
    }
    const policy = await prisma.policy.create({
      data: {
        type: body.tenantId ? 'SUB' : 'GLOBAL',
        tenantId: body.tenantId ?? null,
        name: body.name,
        description: body.description,
      },
    });
    res.status(201).json(policy);
  }),
);

policiesRouter.get(
  '/policies/:id',
  ah(async (req, res) => {
    const policy = await prisma.policy.findUnique({
      where: { id: req.params.id },
      include: {
        settings: {
          include: {
            setting: {
              select: {
                id: true,
                key: true,
                category: true,
                name: true,
                description: true,
                riskNote: true,
                mechanism: true,
                dataType: true,
                allowedValues: true,
                defaultValue: true,
                minBuild: true,
                registryHive: true,
                registryKey: true,
                registryValueName: true,
                registryValueType: true,
                seceditArea: true,
                seceditKey: true,
                auditSubcategory: true,
                auditGuid: true,
                controlMaps: {
                  select: {
                    confidence: true,
                    recommendedValue: true,
                    control: { select: { controlId: true, title: true, framework: { select: { key: true, name: true } } } },
                  },
                },
              },
            },
          },
        },
        assignments: {
          include: {
            tenant: { select: { id: true, name: true } },
            group: { select: { id: true, name: true } },
            computer: { select: { id: true, hostname: true } },
          },
        },
      },
    });
    if (!policy) throw httpError(404, 'Policy not found');
    res.json(policy);
  }),
);

const patchSchema = z.object({ name: z.string().min(1).max(160).optional(), description: z.string().max(2000).optional() });

policiesRouter.patch(
  '/policies/:id',
  ah(async (req, res) => {
    const body = patchSchema.parse(req.body);
    const policy = await prisma.policy.update({ where: { id: req.params.id }, data: body }).catch(() => null);
    if (!policy) throw httpError(404, 'Policy not found');
    res.json(policy);
  }),
);

policiesRouter.delete(
  '/policies/:id',
  ah(async (req, res) => {
    const policy = await prisma.policy.findUnique({ where: { id: req.params.id } });
    if (!policy) throw httpError(404, 'Policy not found');
    await prisma.policy.delete({ where: { id: policy.id } });
    res.json({ ok: true });
  }),
);

// Bulk replace/merge policy settings.
const settingsSchema = z.object({
  mode: z.enum(['replace', 'merge']).default('merge'),
  settings: z.array(
    z.object({
      settingId: z.string(),
      value: z.unknown(),
      enabled: z.boolean().default(true),
    }),
  ),
  removeSettingIds: z.array(z.string()).default([]),
});

policiesRouter.put(
  '/policies/:id/settings',
  ah(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    const policy = await prisma.policy.findUnique({ where: { id: req.params.id } });
    if (!policy) throw httpError(404, 'Policy not found');

    const validSettings = await prisma.setting.findMany({
      where: { id: { in: body.settings.map((s) => s.settingId) } },
      select: { id: true },
    });
    const validIds = new Set(validSettings.map((s) => s.id));
    const rows = body.settings.filter((s) => validIds.has(s.settingId));

    await prisma.$transaction(async (tx) => {
      if (body.mode === 'replace') {
        await tx.policySetting.deleteMany({ where: { policyId: policy.id } });
      } else if (body.removeSettingIds.length) {
        await tx.policySetting.deleteMany({ where: { policyId: policy.id, settingId: { in: body.removeSettingIds } } });
      }
      for (const row of rows) {
        await tx.policySetting.upsert({
          where: { policyId_settingId: { policyId: policy.id, settingId: row.settingId } },
          update: { value: row.value as Prisma.InputJsonValue, enabled: row.enabled },
          create: {
            policyId: policy.id,
            settingId: row.settingId,
            value: row.value as Prisma.InputJsonValue,
            enabled: row.enabled,
          },
        });
      }
      await tx.policy.update({ where: { id: policy.id }, data: { updatedAt: new Date() } });
    });
    const count = await prisma.policySetting.count({ where: { policyId: policy.id } });
    res.json({ ok: true, settingCount: count });
  }),
);

policiesRouter.post(
  '/policies/:id/clone',
  ah(async (req, res) => {
    const body = z
      .object({ tenantId: z.string(), name: z.string().min(1).max(160).optional() })
      .parse(req.body);
    const source = await prisma.policy.findUnique({ where: { id: req.params.id }, include: { settings: true } });
    if (!source) throw httpError(404, 'Policy not found');
    const tenant = await prisma.tenant.findUnique({ where: { id: body.tenantId } });
    if (!tenant) throw httpError(404, 'Tenant not found');
    const clone = await prisma.policy.create({
      data: {
        type: 'SUB',
        tenantId: tenant.id,
        name: body.name ?? `${source.name} (${tenant.name})`,
        description: source.description,
        clonedFromId: source.id,
        settings: {
          create: source.settings.map((s) => ({
            settingId: s.settingId,
            value: s.value as Prisma.InputJsonValue,
            enabled: s.enabled,
          })),
        },
      },
      select: policyListSelect,
    });
    res.status(201).json(clone);
  }),
);

// Reset a seeded global policy back to its seed definition.
policiesRouter.post(
  '/policies/:id/reset-to-seed',
  ah(async (req, res) => {
    const policy = await prisma.policy.findUnique({ where: { id: req.params.id } });
    if (!policy) throw httpError(404, 'Policy not found');
    if (!policy.isSeeded || !policy.seedKey) throw httpError(400, 'Policy is not a seeded standard');
    const def = await getSeededPolicyDefinition(prisma, policy.seedKey);
    if (!def) throw httpError(400, `No seed definition found for ${policy.seedKey}`);
    await prisma.$transaction(async (tx) => {
      await tx.policySetting.deleteMany({ where: { policyId: policy.id } });
      await tx.policy.update({
        where: { id: policy.id },
        data: {
          name: def.name,
          description: def.description,
          settings: {
            create: def.settings.map((s) => ({
              settingId: s.settingId,
              value: s.value as Prisma.InputJsonValue,
              enabled: true,
            })),
          },
        },
      });
    });
    res.json({ ok: true, settingCount: def.settings.length });
  }),
);
