import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireAdmin, requireUser } from '../lib/auth';
import { sha256Hex } from '../lib/tokens';

export const releasesRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024 * 1024 } });

const releaseSelect = {
  id: true,
  version: true,
  source: true,
  url: true,
  sha256: true,
  notes: true,
  isLatest: true,
  createdAt: true,
} as const;

releasesRouter.get(
  '/releases',
  requireUser,
  ah(async (_req, res) => {
    const releases = await prisma.agentRelease.findMany({ select: releaseSelect, orderBy: { createdAt: 'desc' } });
    res.json(releases);
  }),
);

const normalizeVersion = (v: string): string => v.trim().replace(/^v/i, '');

const registerSchema = z.object({
  version: z.string().min(1).max(40),
  url: z.string().url().max(1000),
  sha256: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'sha256 must be 64 hex chars'),
  notes: z.string().max(4000).default(''),
  markLatest: z.boolean().default(true),
});

releasesRouter.post(
  '/releases',
  requireAdmin,
  ah(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const version = normalizeVersion(body.version);
    const existing = await prisma.agentRelease.findUnique({ where: { version } });
    if (existing) throw httpError(409, `Release ${version} already registered`);
    const release = await prisma.$transaction(async (tx) => {
      if (body.markLatest) await tx.agentRelease.updateMany({ data: { isLatest: false } });
      return tx.agentRelease.create({
        data: {
          version,
          source: 'GITHUB_URL',
          url: body.url,
          sha256: body.sha256.toLowerCase(),
          notes: body.notes,
          isLatest: body.markLatest,
        },
        select: releaseSelect,
      });
    });
    res.status(201).json(release);
  }),
);

releasesRouter.post(
  '/releases/upload',
  requireAdmin,
  upload.single('msi'),
  ah(async (req, res) => {
    const version = normalizeVersion(String(req.body.version ?? ''));
    if (!version) throw httpError(400, 'version is required');
    if (!req.file) throw httpError(400, 'Attach the MSI as "msi"');
    const notes = String(req.body.notes ?? '');
    const markLatest = String(req.body.markLatest ?? 'true') !== 'false';
    const existing = await prisma.agentRelease.findUnique({ where: { version } });
    if (existing) throw httpError(409, `Release ${version} already registered`);
    const sha256 = sha256Hex(req.file.buffer);
    const release = await prisma.$transaction(async (tx) => {
      if (markLatest) await tx.agentRelease.updateMany({ data: { isLatest: false } });
      return tx.agentRelease.create({
        data: { version, source: 'UPLOADED', msiBlob: req.file!.buffer, sha256, notes, isLatest: markLatest },
        select: releaseSelect,
      });
    });
    res.status(201).json(release);
  }),
);

releasesRouter.patch(
  '/releases/:id',
  requireAdmin,
  ah(async (req, res) => {
    const body = z.object({ isLatest: z.literal(true).optional(), notes: z.string().max(4000).optional() }).parse(req.body);
    const target = await prisma.agentRelease.findUnique({ where: { id: req.params.id } });
    if (!target) throw httpError(404, 'Release not found');
    const release = await prisma.$transaction(async (tx) => {
      if (body.isLatest) await tx.agentRelease.updateMany({ data: { isLatest: false } });
      return tx.agentRelease.update({
        where: { id: target.id },
        data: { isLatest: body.isLatest ?? undefined, notes: body.notes },
        select: releaseSelect,
      });
    });
    res.json(release);
  }),
);

releasesRouter.delete(
  '/releases/:id',
  requireAdmin,
  ah(async (req, res) => {
    const target = await prisma.agentRelease.findUnique({ where: { id: req.params.id } });
    if (!target) throw httpError(404, 'Release not found');
    if (target.isLatest) throw httpError(400, 'Cannot delete the latest release; mark another release latest first');
    await prisma.agentRelease.delete({ where: { id: target.id } });
    res.json({ ok: true });
  }),
);
