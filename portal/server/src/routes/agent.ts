import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireDevice, requireUser } from '../lib/auth';
import { hashDeviceToken, msiFetchHeaders, randomToken, sha256Hex } from '../lib/tokens';
import { config } from '../config';
import { getEffectiveDocument, pruneStaleAuditResults } from '../services/computerPolicy';

export const agentRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024 * 1024 } });

const enrollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many enrollment attempts' },
});

// Device-authenticated endpoints: generous but bounded (heartbeat 5min + audit 30min
// leaves plenty of headroom; a runaway agent is still capped).
const deviceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 900,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.computerId ?? req.ip ?? 'unknown',
  message: { error: 'Rate limit exceeded' },
});

// ---------------------------------------------------------------------------
// Enrollment: exchange the tenant enrollment token for a per-device token.
// ---------------------------------------------------------------------------

const enrollSchema = z.object({
  enrollToken: z.string().min(8).max(200),
  hostname: z.string().min(1).max(255),
  ipAddresses: z.array(z.string().max(45)).max(32).default([]),
  osName: z.string().max(200).default(''),
  osVersion: z.string().max(100).default(''),
  osBuild: z.string().max(100).default(''),
  agentVersion: z.string().max(40).default(''),
});

agentRouter.post(
  '/agent/enroll',
  enrollLimiter,
  ah(async (req, res) => {
    const body = enrollSchema.parse(req.body);
    const tenant = await prisma.tenant.findUnique({ where: { enrollToken: body.enrollToken } });
    if (!tenant) throw httpError(401, 'Invalid enrollment token');

    const deviceToken = randomToken(32);
    const deviceTokenHash = hashDeviceToken(deviceToken);

    // Re-enrollment (reinstall) on the same hostname reuses the computer record
    // so history (snapshots, drift, audit) stays attached.
    const existing = await prisma.computer.findFirst({
      where: { tenantId: tenant.id, hostname: { equals: body.hostname, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
    });

    const data = {
      hostname: body.hostname,
      ipAddresses: body.ipAddresses,
      osName: body.osName,
      osVersion: body.osVersion,
      osBuild: body.osBuild,
      agentVersion: body.agentVersion,
      lastSeenAt: new Date(),
      deviceTokenHash,
      status: 'ACTIVE' as const,
      // A fresh install is a clean slate: clear any paused/decommissioned state
      // and stale first-enforcement/policy markers left on the reused row, so
      // the reinstalled agent snapshots and enforces from scratch instead of
      // silently never writing because the previous uninstall/rollback paused it.
      enforcementPaused: false,
      firstEnforcedAt: null,
      reportedPolicyHash: '',
    };
    const computer = existing
      ? await prisma.computer.update({ where: { id: existing.id }, data })
      : await prisma.computer.create({ data: { ...data, tenantId: tenant.id } });

    res.status(201).json({
      deviceToken,
      computerId: computer.id,
      tenantName: tenant.name,
      heartbeatSeconds: config.heartbeatSeconds,
    });
  }),
);

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

const heartbeatSchema = z.object({
  hostname: z.string().min(1).max(255),
  ipAddresses: z.array(z.string().max(45)).max(32).default([]),
  osName: z.string().max(200).default(''),
  osVersion: z.string().max(100).default(''),
  osBuild: z.string().max(100).default(''),
  agentVersion: z.string().max(40).default(''),
  enforcementPaused: z.boolean().default(false),
  policyHash: z.string().max(80).default(''),
});

agentRouter.post(
  '/agent/heartbeat',
  requireDevice,
  deviceLimiter,
  ah(async (req, res) => {
    const body = heartbeatSchema.parse(req.body);
    const computer = await prisma.computer.update({
      where: { id: req.computerId! },
      data: {
        hostname: body.hostname,
        ipAddresses: body.ipAddresses,
        osName: body.osName,
        osVersion: body.osVersion,
        osBuild: body.osBuild,
        agentVersion: body.agentVersion,
        lastSeenAt: new Date(),
        reportedPolicyHash: body.policyHash,
      },
      include: { tenant: { select: { enforcementPaused: true } } },
    });

    const pending = await prisma.command.findMany({
      where: { computerId: computer.id, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (pending.length) {
      await prisma.command.updateMany({
        where: { id: { in: pending.map((c) => c.id) } },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
    }

    const doc = await getEffectiveDocument(computer.id);
    res.json({
      commands: pending.map((c) => ({ id: c.id, type: c.type, payload: c.payload ?? {} })),
      policyChanged: doc.policyHash !== body.policyHash,
      policyHash: doc.policyHash,
      enforcementPaused: computer.enforcementPaused || computer.tenant.enforcementPaused,
      heartbeatSeconds: config.heartbeatSeconds,
    });
  }),
);

agentRouter.get(
  '/agent/policy',
  requireDevice,
  deviceLimiter,
  ah(async (req, res) => {
    res.json(await getEffectiveDocument(req.computerId!));
  }),
);

// ---------------------------------------------------------------------------
// Audit results + drift events (batched; agent queues offline)
// ---------------------------------------------------------------------------

const auditBatchSchema = z.object({
  checkedAt: z.string().datetime(),
  results: z
    .array(
      z.object({
        settingKey: z.string().max(160),
        currentValue: z.unknown(),
        requiredValue: z.unknown(),
        compliant: z.boolean(),
        checkedAt: z.string().datetime().optional(),
      }),
    )
    .max(5000),
});

agentRouter.post(
  '/agent/audit',
  requireDevice,
  deviceLimiter,
  ah(async (req, res) => {
    const body = auditBatchSchema.parse(req.body);
    const keys = [...new Set(body.results.map((r) => r.settingKey))];
    const settings = await prisma.setting.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
    const idByKey = new Map(settings.map((s) => [s.key, s.id]));
    let stored = 0;
    // Settings no longer in the catalog are dropped from results (stale agent doc).
    const staleKeys = new Set(keys.filter((k) => !idByKey.has(k)));
    const rows = body.results.filter((r) => idByKey.has(r.settingKey));

    await prisma.$transaction(
      rows.map((r) =>
        prisma.auditResult.upsert({
          where: { computerId_settingId: { computerId: req.computerId!, settingId: idByKey.get(r.settingKey)! } },
          update: {
            currentValue: (r.currentValue ?? null) as Prisma.InputJsonValue,
            requiredValue: (r.requiredValue ?? null) as Prisma.InputJsonValue,
            compliant: r.compliant,
            checkedAt: new Date(r.checkedAt ?? body.checkedAt),
          },
          create: {
            computerId: req.computerId!,
            settingId: idByKey.get(r.settingKey)!,
            currentValue: (r.currentValue ?? null) as Prisma.InputJsonValue,
            requiredValue: (r.requiredValue ?? null) as Prisma.InputJsonValue,
            compliant: r.compliant,
            checkedAt: new Date(r.checkedAt ?? body.checkedAt),
          },
        }),
      ),
    );
    stored = rows.length;

    // Prune stored audit results for settings that have left this computer's
    // effective policy entirely, so the compliance rollup reflects only the
    // currently-assigned settings. Runs even when the effective policy is now
    // empty (all assignments removed) — then every result is stale and pruned.
    await pruneStaleAuditResults(req.computerId!);
    res.json({ stored, staleKeys: [...staleKeys] });
  }),
);

const driftBatchSchema = z.object({
  events: z
    .array(
      z.object({
        settingKey: z.string().max(160),
        beforeValue: z.unknown(),
        afterValue: z.unknown(),
        remediatedAt: z.string().datetime(),
      }),
    )
    .max(5000),
});

agentRouter.post(
  '/agent/drift',
  requireDevice,
  deviceLimiter,
  ah(async (req, res) => {
    const body = driftBatchSchema.parse(req.body);
    const keys = [...new Set(body.events.map((r) => r.settingKey))];
    const settings = await prisma.setting.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
    const idByKey = new Map(settings.map((s) => [s.key, s.id]));
    const rows = body.events.filter((e) => idByKey.has(e.settingKey));
    if (rows.length) {
      await prisma.driftEvent.createMany({
        data: rows.map((e) => ({
          computerId: req.computerId!,
          settingId: idByKey.get(e.settingKey)!,
          beforeValue: (e.beforeValue ?? null) as Prisma.InputJsonValue,
          afterValue: (e.afterValue ?? null) as Prisma.InputJsonValue,
          remediatedAt: new Date(e.remediatedAt),
        })),
      });
    }
    res.json({ stored: rows.length });
  }),
);

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

agentRouter.post(
  '/agent/snapshot',
  requireDevice,
  deviceLimiter,
  upload.single('snapshot'),
  ah(async (req, res) => {
    if (!req.file || req.file.buffer.length === 0) throw httpError(400, 'Attach the snapshot zip as "snapshot"');
    const note = typeof req.body.note === 'string' ? req.body.note.slice(0, 500) : '';
    const snapshot = await prisma.snapshot.create({
      data: {
        computerId: req.computerId!,
        blob: req.file.buffer,
        sizeBytes: req.file.buffer.length,
        sha256: sha256Hex(req.file.buffer),
        note,
      },
      select: { id: true, sha256: true, sizeBytes: true, createdAt: true },
    });
    // Stamp the first-enforcement time once (the snapshot precedes the first
    // enforcement). updateMany with the null guard makes later snapshots no-ops.
    await prisma.computer.updateMany({
      where: { id: req.computerId!, firstEnforcedAt: null },
      data: { firstEnforcedAt: new Date() },
    });
    res.status(201).json(snapshot);
  }),
);

agentRouter.get(
  '/agent/snapshots/:id',
  requireDevice,
  deviceLimiter,
  ah(async (req, res) => {
    const snapshot = await prisma.snapshot.findFirst({
      where: { id: req.params.id, computerId: req.computerId! },
    });
    if (!snapshot) throw httpError(404, 'Snapshot not found');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('X-Snapshot-Sha256', snapshot.sha256);
    res.send(Buffer.from(snapshot.blob));
  }),
);

// ---------------------------------------------------------------------------
// Command acks
// ---------------------------------------------------------------------------

const ackSchema = z.object({ status: z.enum(['acked', 'failed']), error: z.string().max(4000).default('') });

agentRouter.post(
  '/agent/commands/:id/ack',
  requireDevice,
  deviceLimiter,
  ah(async (req, res) => {
    const body = ackSchema.parse(req.body);
    const command = await prisma.command.findFirst({ where: { id: req.params.id, computerId: req.computerId! } });
    if (!command) throw httpError(404, 'Command not found');
    await prisma.command.update({
      where: { id: command.id },
      data: { status: body.status === 'acked' ? 'ACKED' : 'FAILED', error: body.error, ackedAt: new Date() },
    });

    if (body.status === 'acked') {
      if (command.type === 'ROLLBACK') {
        // Rollback always pauses enforcement, otherwise the drift loop would
        // immediately re-apply the policy and defeat the rollback.
        await prisma.computer.update({ where: { id: req.computerId! }, data: { enforcementPaused: true } });
      } else if (command.type === 'UNINSTALL') {
        // Revoke the device token and decommission the record.
        await prisma.computer.update({
          where: { id: req.computerId! },
          data: { status: 'DECOMMISSIONED', deviceTokenHash: null, enforcementPaused: true },
        });
      } else if (command.type === 'PAUSE_ENFORCEMENT') {
        await prisma.computer.update({ where: { id: req.computerId! }, data: { enforcementPaused: true } });
      } else if (command.type === 'RESUME_ENFORCEMENT') {
        await prisma.computer.update({ where: { id: req.computerId! }, data: { enforcementPaused: false } });
      }
    }
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Agent updates
// ---------------------------------------------------------------------------

agentRouter.get(
  '/agent/update/check',
  requireDevice,
  deviceLimiter,
  ah(async (_req, res) => {
    const latest = await prisma.agentRelease.findFirst({ where: { isLatest: true } });
    if (!latest) return res.json({ available: false });
    res.json({
      available: true,
      version: latest.version,
      sha256: latest.sha256,
      url: `${config.publicUrl}/api/agent/msi/${encodeURIComponent(latest.version)}`,
      notes: latest.notes,
    });
  }),
);

/**
 * MSI download proxy. Accessible with any of:
 *  - a portal session cookie (deploy panel download button)
 *  - a device token           (agent auto-update)
 *  - a tenant enrollment token via ?enrollToken= (install one-liner)
 * Agents and install scripts only ever reference the portal URL.
 */
agentRouter.get(
  '/agent/msi/:version',
  ah(async (req, res, next) => {
    const enrollToken = typeof req.query.enrollToken === 'string' ? req.query.enrollToken : '';
    let authorized = false;
    if (enrollToken) {
      authorized = !!(await prisma.tenant.findUnique({ where: { enrollToken } }));
    }
    if (!authorized) {
      const header = req.headers.authorization ?? '';
      const m = /^Bearer\s+(.+)$/i.exec(header);
      if (m) {
        const computer = await prisma.computer.findUnique({ where: { deviceTokenHash: hashDeviceToken(m[1].trim()) } });
        authorized = !!computer && computer.status === 'ACTIVE';
      }
    }
    if (!authorized) {
      // Fall back to portal user auth.
      await new Promise<void>((resolve, reject) => requireUser(req, res, (err?: unknown) => (err ? reject(err) : resolve())))
        .then(() => {
          authorized = true;
        })
        .catch(() => {});
    }
    if (!authorized) return next(httpError(401, 'Not authorized to download the agent MSI'));

    const versionParam = req.params.version.replace(/\.msi$/i, '');
    const release =
      versionParam === 'latest'
        ? await prisma.agentRelease.findFirst({ where: { isLatest: true } })
        : await prisma.agentRelease.findUnique({ where: { version: versionParam.replace(/^v/i, '') } });
    if (!release) throw httpError(404, 'Release not found');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="cep-agent-${release.version}.msi"`);
    res.setHeader('X-Msi-Sha256', release.sha256);

    if (release.source === 'UPLOADED' && release.msiBlob) {
      res.send(Buffer.from(release.msiBlob));
      return;
    }
    if (release.source === 'GITHUB_URL' && release.url) {
      const upstream = await fetch(release.url, { redirect: 'follow', headers: msiFetchHeaders() });
      if (!upstream.ok || !upstream.body) {
        throw httpError(502, `Upstream download failed (${upstream.status})`);
      }
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      }
      res.end();
      return;
    }
    throw httpError(500, 'Release has no content');
  }),
);
