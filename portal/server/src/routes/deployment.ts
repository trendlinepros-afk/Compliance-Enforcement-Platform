import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireUser, requireAdmin } from '../lib/auth';
import { getDeploymentPlan, deployTenant } from '../services/deployment';

export const deploymentRouter = Router();
deploymentRouter.use(requireUser);

async function assertTenant(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw httpError(404, 'Tenant not found');
}

// The review plan: per-setting non-compliance across the fleet + risk notes.
deploymentRouter.get(
  '/tenants/:tenantId/deployment',
  ah(async (req, res) => {
    await assertTenant(req.params.tenantId);
    res.json(await getDeploymentPlan(req.params.tenantId));
  }),
);

// Confirm & deploy: approve the current effective policy on every machine and
// nudge the non-paused ones to apply now.
deploymentRouter.post(
  '/tenants/:tenantId/deployment/deploy',
  ah(async (req, res) => {
    await assertTenant(req.params.tenantId);
    const result = await deployTenant(req.params.tenantId, req.user!.username);
    res.json(result);
  }),
);

// Toggle the staged-deployment gate for a tenant (disabling it makes changes
// apply immediately again). Admin-only, since it removes a safety gate.
deploymentRouter.patch(
  '/tenants/:tenantId/deployment/settings',
  requireAdmin,
  ah(async (req, res) => {
    const body = z.object({ requireApproval: z.boolean() }).parse(req.body);
    const tenant = await prisma.tenant
      .update({ where: { id: req.params.tenantId }, data: { requireDeploymentApproval: body.requireApproval } })
      .catch(() => null);
    if (!tenant) throw httpError(404, 'Tenant not found');
    res.json({ requireApproval: tenant.requireDeploymentApproval });
  }),
);
