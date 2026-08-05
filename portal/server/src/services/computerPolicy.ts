import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import {
  buildEffectiveDocument,
  resolveEffectivePolicy,
  type CatalogSettingInfo,
  type EffectivePolicyDocument,
  type ResolvableAssignment,
} from './effectivePolicy';

// Catalog fields the agent-facing effective document needs.
const catalogInfoSelect = {
  id: true,
  key: true,
  name: true,
  mechanism: true,
  scope: true,
  registryHive: true,
  registryKey: true,
  registryValueName: true,
  registryValueType: true,
  seceditArea: true,
  seceditKey: true,
  auditSubcategory: true,
  auditGuid: true,
  dataType: true,
  minBuild: true,
} satisfies Prisma.SettingSelect;

const assignmentInclude = {
  policy: {
    select: {
      id: true,
      name: true,
      settings: { select: { settingId: true, value: true, enabled: true } },
    },
  },
} satisfies Prisma.AssignmentInclude;

type AssignmentWithPolicy = Prisma.AssignmentGetPayload<{ include: typeof assignmentInclude }>;

const toResolvable = (a: AssignmentWithPolicy): ResolvableAssignment => ({
  id: a.id,
  scope: a.scope,
  groupId: a.groupId,
  computerId: a.computerId,
  priority: a.priority,
  createdAt: a.createdAt,
  policy: {
    id: a.policy.id,
    name: a.policy.name,
    settings: a.policy.settings.map((s) => ({ settingId: s.settingId, value: s.value, enabled: s.enabled })),
  },
});

/** Load everything needed and produce the flat effective policy doc for one computer. */
export async function getEffectiveDocument(computerId: string): Promise<EffectivePolicyDocument> {
  const computer = await prisma.computer.findUniqueOrThrow({
    where: { id: computerId },
    select: { id: true, tenantId: true, groupMemberships: { select: { groupId: true } } },
  });
  const assignments = await prisma.assignment.findMany({
    where: { tenantId: computer.tenantId },
    include: assignmentInclude,
  });
  const resolved = resolveEffectivePolicy(
    assignments.map(toResolvable),
    computer.id,
    computer.groupMemberships.map((m) => m.groupId),
  );

  const settingIds = [...resolved.settings.keys()];
  const catalogRows = settingIds.length
    ? await prisma.setting.findMany({ where: { id: { in: settingIds } }, select: catalogInfoSelect })
    : [];
  const catalog = new Map<string, CatalogSettingInfo>(catalogRows.map((r) => [r.id, r as CatalogSettingInfo]));
  return buildEffectiveDocument(resolved, catalog);
}

/**
 * Batched resolution for a whole tenant: loads the tenant's assignments and the
 * referenced catalog rows ONCE, then resolves each computer in memory. This
 * replaces N per-computer round-trips (each of which re-loaded the full
 * policies) with a constant ~3 queries, which matters on the Agents tab for
 * tenants with many machines.
 */
export async function getEffectiveDocumentsForTenant(tenantId: string): Promise<Map<string, EffectivePolicyDocument>> {
  const [computers, assignments] = await Promise.all([
    prisma.computer.findMany({
      where: { tenantId },
      select: { id: true, groupMemberships: { select: { groupId: true } } },
    }),
    prisma.assignment.findMany({ where: { tenantId }, include: assignmentInclude }),
  ]);
  const resolvable = assignments.map(toResolvable);

  // Every setting any assigned policy references — loaded once for the tenant.
  const allSettingIds = [...new Set(assignments.flatMap((a) => a.policy.settings.map((s) => s.settingId)))];
  const catalogRows = allSettingIds.length
    ? await prisma.setting.findMany({ where: { id: { in: allSettingIds } }, select: catalogInfoSelect })
    : [];
  const catalog = new Map<string, CatalogSettingInfo>(catalogRows.map((r) => [r.id, r as CatalogSettingInfo]));

  const result = new Map<string, EffectivePolicyDocument>();
  for (const c of computers) {
    const resolved = resolveEffectivePolicy(resolvable, c.id, c.groupMemberships.map((m) => m.groupId));
    result.set(c.id, buildEffectiveDocument(resolved, catalog));
  }
  return result;
}

/**
 * Delete stored audit results for a computer whose setting is no longer in its
 * effective policy. Handles the "all assignments removed" case (empty policy →
 * every result pruned) that the agent's own audit upload can no longer reach.
 */
export async function pruneStaleAuditResults(computerId: string): Promise<void> {
  const doc = await getEffectiveDocument(computerId);
  const effectiveKeys = new Set(doc.entries.map((e) => e.settingKey));
  const existing = await prisma.auditResult.findMany({
    where: { computerId },
    select: { id: true, setting: { select: { key: true } } },
  });
  const staleIds = existing.filter((r) => !effectiveKeys.has(r.setting.key)).map((r) => r.id);
  if (staleIds.length) await prisma.auditResult.deleteMany({ where: { id: { in: staleIds } } });
}

/** Prune stale audit results for every computer in a tenant (after an assignment change). */
export async function pruneStaleAuditResultsForTenant(tenantId: string): Promise<void> {
  const docs = await getEffectiveDocumentsForTenant(tenantId);
  for (const [computerId, doc] of docs) {
    const effectiveKeys = new Set(doc.entries.map((e) => e.settingKey));
    const existing = await prisma.auditResult.findMany({
      where: { computerId },
      select: { id: true, setting: { select: { key: true } } },
    });
    const staleIds = existing.filter((r) => !effectiveKeys.has(r.setting.key)).map((r) => r.id);
    if (staleIds.length) await prisma.auditResult.deleteMany({ where: { id: { in: staleIds } } });
  }
}

export interface ComplianceSummary {
  total: number;
  compliant: number;
  percent: number | null; // null when nothing audited yet
  lastCheckedAt: string | null;
}

export async function getComplianceSummaries(computerIds: string[]): Promise<Map<string, ComplianceSummary>> {
  const map = new Map<string, ComplianceSummary>();
  if (computerIds.length === 0) return map;
  const grouped = await prisma.auditResult.groupBy({
    by: ['computerId', 'compliant'],
    where: { computerId: { in: computerIds } },
    _count: { _all: true },
    _max: { checkedAt: true },
  });
  for (const id of computerIds) map.set(id, { total: 0, compliant: 0, percent: null, lastCheckedAt: null });
  for (const g of grouped) {
    const s = map.get(g.computerId)!;
    s.total += g._count._all;
    if (g.compliant) s.compliant += g._count._all;
    const t = g._max.checkedAt?.toISOString() ?? null;
    if (t && (!s.lastCheckedAt || t > s.lastCheckedAt)) s.lastCheckedAt = t;
  }
  for (const s of map.values()) {
    s.percent = s.total > 0 ? Math.round((s.compliant / s.total) * 1000) / 10 : null;
  }
  return map;
}
