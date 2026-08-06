import { prisma } from '../db';
import { getEffectiveDocumentsForTenant } from './computerPolicy';

/**
 * Staged deployment: agents audit continuously, but while a tenant has
 * requireDeploymentApproval on, enforcement is HELD until an admin reviews the
 * impact here and deploys. "Deploy" stamps each machine's approvedPolicyHash to
 * its current effective hash, which un-holds enforcement (see the heartbeat
 * gate). This module builds the review plan and performs the deploy.
 */

export interface DeploymentComputerImpact {
  computerId: string;
  hostname: string;
  currentValue: unknown;
}

export interface DeploymentSettingRow {
  settingId: string;
  key: string;
  name: string;
  category: string;
  description: string; // what it does
  riskNote: string; // what it can break
  mechanism: string;
  requiredValue: unknown;
  nonCompliantCount: number;
  computers: DeploymentComputerImpact[];
}

export interface DeploymentPlan {
  requireApproval: boolean;
  totalComputers: number;
  pendingComputers: number; // effective policy not yet approved (enforcement held)
  affectedComputers: number; // computers with >= 1 non-compliant setting
  settings: DeploymentSettingRow[];
  lastCheckedAt: string | null;
}

export interface NonCompliantRow {
  settingId: string;
  currentValue: unknown;
  requiredValue: unknown;
  checkedAt: Date;
  computerId: string;
  hostname: string;
  setting: { key: string; name: string; category: string; description: string; riskNote: string; mechanism: string };
}

/**
 * Pure rollup: group non-compliant audit rows by setting, newest-checked wins
 * for the required value, sorted by how many machines are affected. Also returns
 * the set of distinct affected machines and the latest check time.
 */
export function rollupNonCompliant(rows: NonCompliantRow[]): {
  settings: DeploymentSettingRow[];
  affectedComputers: number;
  lastCheckedAt: string | null;
} {
  const byId = new Map<string, DeploymentSettingRow>();
  const affected = new Set<string>();
  let last: string | null = null;

  for (const r of rows) {
    affected.add(r.computerId);
    const iso = r.checkedAt.toISOString();
    if (!last || iso > last) last = iso;

    let row = byId.get(r.settingId);
    if (!row) {
      row = {
        settingId: r.settingId,
        key: r.setting.key,
        name: r.setting.name,
        category: r.setting.category,
        description: r.setting.description,
        riskNote: r.setting.riskNote,
        mechanism: r.setting.mechanism,
        requiredValue: r.requiredValue,
        nonCompliantCount: 0,
        computers: [],
      };
      byId.set(r.settingId, row);
    }
    row.nonCompliantCount += 1;
    row.computers.push({ computerId: r.computerId, hostname: r.hostname, currentValue: r.currentValue });
  }

  const settings = [...byId.values()].sort(
    (a, b) => b.nonCompliantCount - a.nonCompliantCount || a.name.localeCompare(b.name),
  );
  return { settings, affectedComputers: affected.size, lastCheckedAt: last };
}

/** Count machines whose current effective policy has not been approved for enforcement. */
export function countPending(
  computers: { id: string; approvedPolicyHash: string }[],
  docByComputer: Map<string, { policyHash: string; entries: unknown[] }>,
): number {
  let pending = 0;
  for (const c of computers) {
    const doc = docByComputer.get(c.id);
    if (doc && doc.entries.length > 0 && doc.policyHash !== c.approvedPolicyHash) pending += 1;
  }
  return pending;
}

export async function getDeploymentPlan(tenantId: string): Promise<DeploymentPlan> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { requireDeploymentApproval: true },
  });

  const [computers, ncRows, docs] = await Promise.all([
    prisma.computer.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, approvedPolicyHash: true },
    }),
    prisma.auditResult.findMany({
      where: { compliant: false, computer: { tenantId, status: 'ACTIVE' } },
      select: {
        settingId: true,
        currentValue: true,
        requiredValue: true,
        checkedAt: true,
        computerId: true,
        computer: { select: { hostname: true } },
        setting: {
          select: { key: true, name: true, category: true, description: true, riskNote: true, mechanism: true },
        },
      },
    }),
    getEffectiveDocumentsForTenant(tenantId),
  ]);

  const rows: NonCompliantRow[] = ncRows.map((r) => ({
    settingId: r.settingId,
    currentValue: r.currentValue,
    requiredValue: r.requiredValue,
    checkedAt: r.checkedAt,
    computerId: r.computerId,
    hostname: r.computer.hostname,
    setting: r.setting,
  }));

  const { settings, affectedComputers, lastCheckedAt } = rollupNonCompliant(rows);
  const pendingComputers = countPending(computers, docs);

  return {
    requireApproval: tenant.requireDeploymentApproval,
    totalComputers: computers.length,
    pendingComputers,
    affectedComputers,
    settings,
    lastCheckedAt,
  };
}

/**
 * Approve the current effective policy on every active machine in the tenant and
 * nudge the non-paused ones to apply now (instead of waiting for the 30-min audit
 * timer). Paused/rolled-back machines get their hash approved but stay paused, so
 * a rollback quarantine survives a deploy.
 */
export async function deployTenant(
  tenantId: string,
  createdBy: string,
): Promise<{ approved: number; commandsQueued: number }> {
  const [computers, docs] = await Promise.all([
    prisma.computer.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { id: true, enforcementPaused: true },
    }),
    getEffectiveDocumentsForTenant(tenantId),
  ]);

  let approved = 0;
  let commandsQueued = 0;
  for (const c of computers) {
    const doc = docs.get(c.id);
    if (!doc) continue;
    await prisma.computer.update({ where: { id: c.id }, data: { approvedPolicyHash: doc.policyHash } });
    approved += 1;
    if (!c.enforcementPaused && doc.entries.length > 0) {
      await prisma.command.create({ data: { computerId: c.id, type: 'REAUDIT', createdBy } });
      commandsQueued += 1;
    }
  }
  return { approved, commandsQueued };
}
