import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireUser } from '../lib/auth';
import { config } from '../config';
import { getComplianceSummaries, getEffectiveDocument, getEffectiveDocumentsForTenant } from '../services/computerPolicy';

export const computersRouter = Router();
computersRouter.use(requireUser);

const isOnline = (lastSeenAt: Date | null): boolean =>
  !!lastSeenAt && Date.now() - lastSeenAt.getTime() < config.onlineWindowSeconds * 1000;

computersRouter.get(
  '/tenants/:tenantId/computers',
  ah(async (req, res) => {
    const includeDecommissioned = req.query.all === '1';
    const computers = await prisma.computer.findMany({
      where: { tenantId: req.params.tenantId, ...(includeDecommissioned ? {} : { status: 'ACTIVE' }) },
      orderBy: { hostname: 'asc' },
      include: {
        groupMemberships: { include: { group: { select: { id: true, name: true } } } },
        snapshots: { select: { id: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const compliance = await getComplianceSummaries(computers.map((c) => c.id));
    const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId }, select: { enforcementPaused: true } });

    // Resolve every computer's effective policy in one batch (constant queries)
    // instead of N per-computer round-trips.
    const docs = await getEffectiveDocumentsForTenant(req.params.tenantId);
    const docById = new Map(
      [...docs.entries()].map(([id, doc]) => [
        id,
        {
          policyNames: [...new Set(doc.entries.map((e) => e.sourcePolicyName))],
          settingCount: doc.entries.length,
          policyHash: doc.policyHash,
        },
      ]),
    );

    res.json(
      computers.map((c) => ({
        id: c.id,
        hostname: c.hostname,
        ipAddresses: c.ipAddresses,
        osName: c.osName,
        osVersion: c.osVersion,
        osBuild: c.osBuild,
        agentVersion: c.agentVersion,
        lastSeenAt: c.lastSeenAt,
        online: isOnline(c.lastSeenAt),
        status: c.status,
        enforcementPaused: c.enforcementPaused,
        tenantEnforcementPaused: tenant?.enforcementPaused ?? false,
        groups: c.groupMemberships.map((m) => m.group),
        latestSnapshot: c.snapshots[0] ?? null,
        compliance: compliance.get(c.id) ?? null,
        effectivePolicyNames: docById.get(c.id)?.policyNames ?? [],
        effectiveSettingCount: docById.get(c.id)?.settingCount ?? 0,
        policyUpToDate: c.reportedPolicyHash !== '' && c.reportedPolicyHash === docById.get(c.id)?.policyHash,
      })),
    );
  }),
);

computersRouter.get(
  '/computers/:id',
  ah(async (req, res) => {
    const c = await prisma.computer.findUnique({
      where: { id: req.params.id },
      include: {
        tenant: { select: { id: true, name: true, enforcementPaused: true, requireDeploymentApproval: true } },
        groupMemberships: { include: { group: { select: { id: true, name: true } } } },
      },
    });
    if (!c) throw httpError(404, 'Computer not found');
    const [compliance, doc] = await Promise.all([getComplianceSummaries([c.id]), getEffectiveDocument(c.id)]);

    const rolledBack = c.groupMemberships.some((m) => m.group.name === 'Roll Back');
    const deploymentHeld =
      c.tenant.requireDeploymentApproval && doc.entries.length > 0 && doc.policyHash !== c.approvedPolicyHash;
    // Single, human-meaningful enforcement state for the header badge.
    const enforcementState = rolledBack
      ? 'ROLLED_BACK'
      : c.tenant.enforcementPaused
        ? 'TENANT_PAUSED'
        : c.enforcementPaused
          ? 'PAUSED'
          : deploymentHeld
            ? 'PENDING_DEPLOYMENT'
            : 'ACTIVE';

    res.json({
      id: c.id,
      tenant: c.tenant,
      hostname: c.hostname,
      ipAddresses: c.ipAddresses,
      osName: c.osName,
      osVersion: c.osVersion,
      osBuild: c.osBuild,
      agentVersion: c.agentVersion,
      lastSeenAt: c.lastSeenAt,
      online: isOnline(c.lastSeenAt),
      status: c.status,
      enforcementPaused: c.enforcementPaused,
      enforcementState,
      reportedPolicyHash: c.reportedPolicyHash,
      policyUpToDate: c.reportedPolicyHash !== '' && c.reportedPolicyHash === doc.policyHash,
      effectiveSettingCount: doc.entries.length,
      effectivePolicyNames: [...new Set(doc.entries.map((e) => e.sourcePolicyName))],
      firstEnforcedAt: c.firstEnforcedAt,
      createdAt: c.createdAt,
      groups: c.groupMemberships.map((m) => m.group),
      compliance: compliance.get(c.id) ?? null,
      metrics: c.metrics ?? null,
      metricsAt: c.metricsAt,
      latestSnapshotId: null,
    });
  }),
);

computersRouter.get(
  '/computers/:id/effective-policy',
  ah(async (req, res) => {
    const computer = await prisma.computer.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!computer) throw httpError(404, 'Computer not found');
    res.json(await getEffectiveDocument(computer.id));
  }),
);

computersRouter.get(
  '/computers/:id/audit',
  ah(async (req, res) => {
    const results = await prisma.auditResult.findMany({
      where: { computerId: req.params.id, ...(req.query.noncompliant === '1' ? { compliant: false } : {}) },
      include: {
        setting: {
          select: { id: true, key: true, name: true, category: true, description: true, riskNote: true, mechanism: true },
        },
      },
      orderBy: [{ compliant: 'asc' }, { setting: { category: 'asc' } }],
    });
    res.json(
      results.map((r) => ({
        settingId: r.settingId,
        setting: r.setting,
        currentValue: r.currentValue,
        requiredValue: r.requiredValue,
        compliant: r.compliant,
        checkedAt: r.checkedAt,
      })),
    );
  }),
);

computersRouter.get(
  '/computers/:id/drift',
  ah(async (req, res) => {
    const events = await prisma.driftEvent.findMany({
      where: { computerId: req.params.id },
      include: { setting: { select: { key: true, name: true, category: true } } },
      orderBy: { remediatedAt: 'desc' },
      take: 500,
    });
    res.json(events);
  }),
);

computersRouter.get(
  '/tenants/:tenantId/drift',
  ah(async (req, res) => {
    const events = await prisma.driftEvent.findMany({
      where: { computer: { tenantId: req.params.tenantId } },
      include: {
        setting: { select: { key: true, name: true, category: true } },
        computer: { select: { id: true, hostname: true } },
      },
      orderBy: { remediatedAt: 'desc' },
      take: 1000,
    });
    res.json(events);
  }),
);

computersRouter.get(
  '/tenants/:tenantId/compliance',
  ah(async (req, res) => {
    const computers = await prisma.computer.findMany({
      where: { tenantId: req.params.tenantId, status: 'ACTIVE' },
      select: { id: true, hostname: true, lastSeenAt: true },
      orderBy: { hostname: 'asc' },
    });
    const compliance = await getComplianceSummaries(computers.map((c) => c.id));
    const rows = computers.map((c) => ({
      id: c.id,
      hostname: c.hostname,
      online: isOnline(c.lastSeenAt),
      compliance: compliance.get(c.id) ?? null,
    }));
    const pcts = rows.map((r) => r.compliance?.percent).filter((p): p is number => p != null);
    res.json({
      avgCompliance: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null,
      computers: rows.sort((a, b) => (a.compliance?.percent ?? 101) - (b.compliance?.percent ?? 101)),
    });
  }),
);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const commandSchema = z.object({
  type: z.enum(['APPLY_POLICY', 'REAUDIT', 'UPDATE_NOW', 'UNINSTALL', 'ROLLBACK', 'PAUSE_ENFORCEMENT', 'RESUME_ENFORCEMENT']),
  payload: z.record(z.unknown()).optional(),
});

// A rolled-back machine no longer follows the tenant's default policy, so it is
// pulled into a dedicated "Roll Back" group for visibility. The group carries no
// assignments — it is a quarantine label; the enforcement stop is the pause.
const ROLLBACK_GROUP = 'Roll Back';

async function quarantineToRollbackGroup(tenantId: string, computerId: string): Promise<void> {
  const group = await prisma.computerGroup.upsert({
    where: { tenantId_name: { tenantId, name: ROLLBACK_GROUP } },
    update: {},
    create: {
      tenantId,
      name: ROLLBACK_GROUP,
      description:
        'Machines whose changes were rolled back. Enforcement is paused and they no longer follow the default policy until you resume them.',
    },
  });
  await prisma.groupMember.upsert({
    where: { groupId_computerId: { groupId: group.id, computerId } },
    update: {},
    create: { groupId: group.id, computerId },
  });
}

async function releaseFromRollbackGroup(tenantId: string, computerId: string): Promise<void> {
  const group = await prisma.computerGroup.findUnique({ where: { tenantId_name: { tenantId, name: ROLLBACK_GROUP } } });
  if (group) await prisma.groupMember.deleteMany({ where: { groupId: group.id, computerId } });
}

async function enqueueCommand(
  computerId: string,
  type: z.infer<typeof commandSchema>['type'],
  payload: Record<string, unknown> | undefined,
  createdBy: string,
) {
  const computer = await prisma.computer.findUnique({ where: { id: computerId } });
  if (!computer) throw httpError(404, 'Computer not found');
  if (computer.status === 'DECOMMISSIONED') throw httpError(400, `${computer.hostname} is decommissioned`);

  if (type === 'UNINSTALL') {
    const mode = payload?.mode;
    if (mode !== 'revert' && mode !== 'leave') throw httpError(400, 'UNINSTALL requires payload.mode = "revert" | "leave"');
  }
  if (type === 'ROLLBACK') {
    const snapshot = await prisma.snapshot.findFirst({
      where: { computerId, ...(payload?.snapshotId ? { id: String(payload.snapshotId) } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, sha256: true },
    });
    if (!snapshot) throw httpError(400, 'No snapshot available for this computer');
    payload = { ...payload, snapshotId: snapshot.id, snapshotSha256: snapshot.sha256 };
    // Quarantine now: pause enforcement (so nothing re-applies before/while the
    // agent restores) and move the machine into the "Roll Back" group.
    await prisma.computer.update({ where: { id: computerId }, data: { enforcementPaused: true } });
    await quarantineToRollbackGroup(computer.tenantId, computerId);
  }
  // Pause/resume reflect immediately server-side; command informs the agent.
  if (type === 'PAUSE_ENFORCEMENT') {
    await prisma.computer.update({ where: { id: computerId }, data: { enforcementPaused: true } });
  }
  if (type === 'RESUME_ENFORCEMENT') {
    await prisma.computer.update({ where: { id: computerId }, data: { enforcementPaused: false } });
    // Resuming un-quarantines: back to following the default policy.
    await releaseFromRollbackGroup(computer.tenantId, computerId);
  }
  return prisma.command.create({
    data: { computerId, type, payload: payload as object | undefined, createdBy },
  });
}

computersRouter.post(
  '/computers/:id/commands',
  ah(async (req, res) => {
    const body = commandSchema.parse(req.body);
    const cmd = await enqueueCommand(req.params.id, body.type, body.payload, req.user!.username);
    res.status(201).json(cmd);
  }),
);

const bulkSchema = commandSchema.extend({ computerIds: z.array(z.string()).min(1).max(500) });

computersRouter.post(
  '/computers/bulk-commands',
  ah(async (req, res) => {
    const body = bulkSchema.parse(req.body);
    const results: { computerId: string; ok: boolean; error?: string }[] = [];
    for (const computerId of body.computerIds) {
      try {
        await enqueueCommand(computerId, body.type, body.payload, req.user!.username);
        results.push({ computerId, ok: true });
      } catch (err) {
        results.push({ computerId, ok: false, error: (err as Error).message });
      }
    }
    res.json({ results });
  }),
);

computersRouter.get(
  '/computers/:id/commands',
  ah(async (req, res) => {
    const commands = await prisma.command.findMany({
      where: { computerId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(commands);
  }),
);

computersRouter.patch(
  '/computers/:id',
  ah(async (req, res) => {
    const body = z.object({ enforcementPaused: z.boolean().optional() }).parse(req.body);
    const computer = await prisma.computer.update({ where: { id: req.params.id }, data: body }).catch(() => null);
    if (!computer) throw httpError(404, 'Computer not found');
    res.json(computer);
  }),
);

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

computersRouter.get(
  '/computers/:id/snapshots',
  ah(async (req, res) => {
    const snapshots = await prisma.snapshot.findMany({
      where: { computerId: req.params.id },
      select: { id: true, sizeBytes: true, sha256: true, note: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(snapshots);
  }),
);

computersRouter.get(
  '/tenants/:tenantId/snapshots',
  ah(async (req, res) => {
    const snapshots = await prisma.snapshot.findMany({
      where: { computer: { tenantId: req.params.tenantId } },
      select: {
        id: true,
        sizeBytes: true,
        sha256: true,
        note: true,
        createdAt: true,
        computer: { select: { id: true, hostname: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(snapshots);
  }),
);

computersRouter.get(
  '/snapshots/:id/download',
  ah(async (req, res) => {
    const snapshot = await prisma.snapshot.findUnique({
      where: { id: req.params.id },
      include: { computer: { select: { hostname: true } } },
    });
    if (!snapshot) throw httpError(404, 'Snapshot not found');
    const stamp = snapshot.createdAt.toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="snapshot-${snapshot.computer.hostname}-${stamp}.zip"`);
    res.send(Buffer.from(snapshot.blob));
  }),
);
