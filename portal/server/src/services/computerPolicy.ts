import { prisma } from '../db';
import {
  buildEffectiveDocument,
  resolveEffectivePolicy,
  type CatalogSettingInfo,
  type EffectivePolicyDocument,
  type ResolvableAssignment,
} from './effectivePolicy';

/** Load everything needed and produce the flat effective policy doc for one computer. */
export async function getEffectiveDocument(computerId: string): Promise<EffectivePolicyDocument> {
  const computer = await prisma.computer.findUniqueOrThrow({
    where: { id: computerId },
    select: { id: true, tenantId: true, groupMemberships: { select: { groupId: true } } },
  });
  const assignments = await prisma.assignment.findMany({
    where: { tenantId: computer.tenantId },
    include: {
      policy: {
        select: {
          id: true,
          name: true,
          settings: { select: { settingId: true, value: true, enabled: true } },
        },
      },
    },
  });
  const resolvable: ResolvableAssignment[] = assignments.map((a) => ({
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
  }));
  const resolved = resolveEffectivePolicy(
    resolvable,
    computer.id,
    computer.groupMemberships.map((m) => m.groupId),
  );

  const settingIds = [...resolved.settings.keys()];
  const catalogRows = settingIds.length
    ? await prisma.setting.findMany({
        where: { id: { in: settingIds } },
        select: {
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
        },
      })
    : [];
  const catalog = new Map<string, CatalogSettingInfo>(catalogRows.map((r) => [r.id, r as CatalogSettingInfo]));
  return buildEffectiveDocument(resolved, catalog);
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
