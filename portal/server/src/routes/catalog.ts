import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ah, httpError } from '../lib/errors';
import { requireAdmin, requireUser } from '../lib/auth';
import { parsePolicyRules } from '../parsers/policyrules';
import { parseLgpoZip } from '../parsers/lgpo';
import { runCatalogImport } from '../services/catalogImport';

export const catalogRouter = Router();
catalogRouter.use(requireUser);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });

const settingSelect = {
  id: true,
  key: true,
  category: true,
  name: true,
  description: true,
  riskNote: true,
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
  allowedValues: true,
  defaultValue: true,
  minBuild: true,
  cisRef: true,
  isSeeded: true,
  needsDescription: true,
  controlMaps: {
    select: {
      confidence: true,
      recommendedValue: true,
      control: { select: { controlId: true, title: true, framework: { select: { key: true, name: true } } } },
    },
  },
} satisfies Prisma.SettingSelect;

catalogRouter.get(
  '/catalog',
  ah(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const category = String(req.query.category ?? '').trim();
    const mechanism = String(req.query.mechanism ?? '').trim();
    const framework = String(req.query.framework ?? '').trim();
    const needsDescription = req.query.needsDescription === '1';
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(200, Math.max(10, parseInt(String(req.query.pageSize ?? '50'), 10) || 50));

    const where: Prisma.SettingWhereInput = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { key: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
        { registryKey: { contains: q, mode: 'insensitive' } },
        { registryValueName: { contains: q, mode: 'insensitive' } },
        { seceditKey: { contains: q, mode: 'insensitive' } },
        { auditSubcategory: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = { startsWith: category };
    if (mechanism) where.mechanism = mechanism as Prisma.SettingWhereInput['mechanism'];
    if (framework) where.controlMaps = { some: { control: { framework: { key: framework } } } };
    if (needsDescription) where.needsDescription = true;

    const [total, items] = await Promise.all([
      prisma.setting.count({ where }),
      prisma.setting.findMany({
        where,
        select: settingSelect,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({ total, page, pageSize, items });
  }),
);

catalogRouter.get(
  '/catalog/categories',
  ah(async (_req, res) => {
    const rows = await prisma.setting.groupBy({ by: ['category'], _count: { _all: true }, orderBy: { category: 'asc' } });
    res.json(rows.map((r) => ({ category: r.category, count: r._count._all })));
  }),
);

catalogRouter.get(
  '/catalog/:id',
  ah(async (req, res) => {
    const setting = await prisma.setting.findUnique({ where: { id: req.params.id }, select: settingSelect });
    if (!setting) throw httpError(404, 'Setting not found');
    res.json(setting);
  }),
);

const settingBody = z.object({
  key: z
    .string()
    .min(3)
    .max(160)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, digits, underscore'),
  category: z.string().min(1).max(300),
  name: z.string().min(1).max(300),
  description: z.string().max(4000).default(''),
  riskNote: z.string().max(4000).default(''),
  mechanism: z.enum(['REGISTRY_POL', 'SECEDIT', 'AUDITPOL']),
  scope: z.enum(['MACHINE', 'USER']).default('MACHINE'),
  registryHive: z.string().max(8).nullish(),
  registryKey: z.string().max(500).nullish(),
  registryValueName: z.string().max(200).nullish(),
  registryValueType: z.string().max(20).nullish(),
  seceditArea: z.string().max(60).nullish(),
  seceditKey: z.string().max(300).nullish(),
  auditSubcategory: z.string().max(120).nullish(),
  auditGuid: z.string().max(40).nullish(),
  dataType: z.string().max(20).default('dword'),
  allowedValues: z.unknown().nullish(),
  defaultValue: z.unknown(),
  minBuild: z.number().int().nullish(),
  cisRef: z.string().max(40).nullish(),
});

catalogRouter.post(
  '/catalog',
  requireAdmin,
  ah(async (req, res) => {
    const body = settingBody.parse(req.body);
    const existing = await prisma.setting.findUnique({ where: { key: body.key } });
    if (existing) throw httpError(409, 'A setting with this key already exists');
    const setting = await prisma.setting.create({
      data: {
        ...body,
        allowedValues: body.allowedValues as Prisma.InputJsonValue,
        defaultValue: (body.defaultValue ?? null) as Prisma.InputJsonValue,
        isSeeded: false,
        needsDescription: body.description.trim() === '',
      },
      select: settingSelect,
    });
    res.status(201).json(setting);
  }),
);

catalogRouter.patch(
  '/catalog/:id',
  requireAdmin,
  ah(async (req, res) => {
    const body = settingBody.partial().parse(req.body);
    const target = await prisma.setting.findUnique({ where: { id: req.params.id } });
    if (!target) throw httpError(404, 'Setting not found');
    const setting = await prisma.setting.update({
      where: { id: target.id },
      data: {
        ...body,
        key: undefined, // keys are immutable; policies/audit reference them
        allowedValues: body.allowedValues === undefined ? undefined : (body.allowedValues as Prisma.InputJsonValue),
        defaultValue: body.defaultValue === undefined ? undefined : (body.defaultValue as Prisma.InputJsonValue),
        needsDescription:
          body.description !== undefined ? body.description.trim() === '' : undefined,
      },
      select: settingSelect,
    });
    res.json(setting);
  }),
);

catalogRouter.delete(
  '/catalog/:id',
  requireAdmin,
  ah(async (req, res) => {
    const target = await prisma.setting.findUnique({ where: { id: req.params.id } });
    if (!target) throw httpError(404, 'Setting not found');
    if (target.isSeeded) throw httpError(400, 'Seeded settings cannot be deleted (they would be recreated on deploy)');
    await prisma.setting.delete({ where: { id: target.id } });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Baseline importer
// ---------------------------------------------------------------------------

catalogRouter.post(
  '/catalog/import',
  requireAdmin,
  upload.single('file'),
  ah(async (req, res) => {
    if (!req.file) throw httpError(400, 'Upload a .PolicyRules file or an LGPO backup .zip as "file"');
    const filename = req.file.originalname.toLowerCase();
    const createPolicyName = typeof req.body.policyName === 'string' ? req.body.policyName.trim() : '';
    const tenantId = typeof req.body.tenantId === 'string' && req.body.tenantId ? req.body.tenantId : null;

    const options = createPolicyName
      ? { createPolicy: { name: createPolicyName, tenantId, description: `Imported from ${req.file.originalname}` } }
      : {};

    let report;
    if (filename.endsWith('.zip')) {
      report = await runCatalogImport(prisma, { lgpo: parseLgpoZip(req.file.buffer) }, options);
    } else if (filename.endsWith('.policyrules') || filename.endsWith('.xml')) {
      report = await runCatalogImport(prisma, { policyRules: parsePolicyRules(req.file.buffer) }, options);
    } else {
      throw httpError(400, 'Unsupported file type: expected .PolicyRules, .xml, or .zip (LGPO backup)');
    }
    res.json(report);
  }),
);
