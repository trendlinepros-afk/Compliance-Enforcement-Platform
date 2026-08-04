import { Router } from 'express';
import { prisma } from '../db';
import { ah } from '../lib/errors';
import { requireUser } from '../lib/auth';
import { config } from '../config';
import { getComplianceSummaries } from '../services/computerPolicy';

export const dashboardRouter = Router();
dashboardRouter.use(requireUser);

dashboardRouter.get(
  '/dashboard',
  ah(async (_req, res) => {
    const [tenantCount, computers, policyCount, recentDrift, latestRelease] = await Promise.all([
      prisma.tenant.count(),
      prisma.computer.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, hostname: true, lastSeenAt: true, agentVersion: true, tenant: { select: { id: true, name: true } } },
      }),
      prisma.policy.count(),
      prisma.driftEvent.findMany({
        orderBy: { remediatedAt: 'desc' },
        take: 15,
        include: {
          setting: { select: { name: true, key: true } },
          computer: { select: { id: true, hostname: true, tenant: { select: { id: true, name: true } } } },
        },
      }),
      prisma.agentRelease.findFirst({ where: { isLatest: true }, select: { version: true } }),
    ]);
    const now = Date.now();
    const online = computers.filter((c) => c.lastSeenAt && now - c.lastSeenAt.getTime() < config.onlineWindowSeconds * 1000);
    const compliance = await getComplianceSummaries(computers.map((c) => c.id));
    const pcts = [...compliance.values()].map((c) => c.percent).filter((p): p is number => p != null);
    const worst = computers
      .map((c) => ({ ...c, compliance: compliance.get(c.id) ?? null }))
      .filter((c) => c.compliance?.percent != null)
      .sort((a, b) => (a.compliance!.percent ?? 100) - (b.compliance!.percent ?? 100))
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        hostname: c.hostname,
        tenant: c.tenant,
        percent: c.compliance!.percent,
      }));
    const outdated = latestRelease
      ? computers.filter((c) => c.agentVersion && c.agentVersion !== latestRelease.version).length
      : 0;

    res.json({
      tenantCount,
      computerCount: computers.length,
      onlineCount: online.length,
      policyCount,
      avgCompliance: pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null,
      latestAgentVersion: latestRelease?.version ?? null,
      outdatedAgentCount: outdated,
      worstComputers: worst,
      recentDrift,
    });
  }),
);
