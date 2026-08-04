/**
 * Baseline importer: takes parsed PolicyRules / LGPO backup content and
 * upserts settings-catalog entries, optionally creating a policy that captures
 * the imported values. Entries created here (no hand-written description) are
 * flagged needsDescription so they surface in catalog admin.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { PolicyRulesImport, ImportedRegistryPolicy } from '../parsers/policyrules';
import type { LgpoImport } from '../parsers/lgpo';
import type { AuditPolRow } from '../parsers/auditcsv';

export interface ImportReport {
  matchedExisting: number;
  createdSettings: number;
  policyId?: string;
  policyName?: string;
  policyValueCount?: number;
  skipped: { reason: string; item: string }[];
}

interface NormalizedItem {
  matchKind: 'registry' | 'secedit' | 'audit';
  matchKey: string; // normalized lookup key
  value: unknown;
  create: Prisma.SettingCreateInput | null; // null when the item is not importable
  display: string;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\//g, '\\');

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);

function registryItem(r: ImportedRegistryPolicy): NormalizedItem | null {
  if (!r.key) return null;
  // **Del. / **DeleteValues etc. are deletion directives, not settings.
  if (r.valueName.startsWith('**')) return null;
  const hive = r.scope === 'USER' ? 'HKCU' : 'HKLM';
  const matchKey = `${hive}|${norm(r.key)}|${norm(r.valueName)}`;
  const topCategory = r.key.split('\\').slice(0, 3).join(' > ') || 'Registry';
  return {
    matchKind: 'registry',
    matchKey,
    value: r.value,
    display: `${hive}\\${r.key}\\${r.valueName}`,
    create: {
      key: `imp_reg_${slug(`${hive}_${r.key}_${r.valueName}`)}`,
      category: `Imported > ${topCategory}`,
      name: r.valueName || r.key.split('\\').pop() || r.key,
      description: '',
      riskNote: '',
      mechanism: 'REGISTRY_POL',
      scope: r.scope,
      registryHive: hive,
      registryKey: r.key,
      registryValueName: r.valueName,
      registryValueType: r.regType,
      dataType: r.regType === 'REG_DWORD' || r.regType === 'REG_QWORD' ? 'dword' : r.regType === 'REG_MULTI_SZ' ? 'multi' : 'string',
      defaultValue: (r.value ?? null) as Prisma.InputJsonValue,
      needsDescription: true,
    },
  };
}

function seceditItem(section: string, key: string, value: unknown): NormalizedItem | null {
  const area = canonicalSecArea(section);
  if (!area) return null;
  const matchKey = `${norm(area)}|${norm(key)}`;
  const dataType = Array.isArray(value) ? 'multi' : typeof value === 'number' ? 'dword' : 'string';
  return {
    matchKind: 'secedit',
    matchKey,
    value,
    display: `[${area}] ${key}`,
    create: {
      key: `imp_sec_${slug(`${area}_${key}`)}`,
      category: `Imported > Security Template > ${area}`,
      name: key.startsWith('MACHINE\\') ? key.split('\\').pop() ?? key : key,
      description: '',
      riskNote: '',
      mechanism: 'SECEDIT',
      scope: 'MACHINE',
      seceditArea: area,
      seceditKey: key,
      dataType,
      defaultValue: (value ?? null) as Prisma.InputJsonValue,
      needsDescription: true,
    },
  };
}

function auditItem(guid: string, subcategory: string, value: number): NormalizedItem {
  return {
    matchKind: 'audit',
    matchKey: guid.toUpperCase(),
    value,
    display: `Audit: ${subcategory || guid}`,
    create: {
      key: `imp_aud_${slug(subcategory || guid)}`,
      category: 'Imported > Advanced Audit Policy',
      name: subcategory ? `Audit ${subcategory}` : `Audit ${guid}`,
      description: '',
      riskNote: '',
      mechanism: 'AUDITPOL',
      scope: 'MACHINE',
      auditSubcategory: subcategory || guid,
      auditGuid: guid.toUpperCase(),
      dataType: 'dword',
      allowedValues: [
        { value: 0, label: 'No Auditing' },
        { value: 1, label: 'Success' },
        { value: 2, label: 'Failure' },
        { value: 3, label: 'Success and Failure' },
      ] as unknown as Prisma.InputJsonValue,
      defaultValue: value as unknown as Prisma.InputJsonValue,
      needsDescription: true,
    },
  };
}

function canonicalSecArea(section: string): string | null {
  const s = section.trim().toLowerCase();
  if (s === 'system access') return 'System Access';
  if (s === 'privilege rights') return 'Privilege Rights';
  if (s === 'registry values') return 'Registry Values';
  if (s === 'event audit') return 'Event Audit';
  return null; // other sections (Service General Setting, File Security, ...) are out of scope
}

function collectFromPolicyRules(imp: PolicyRulesImport): NormalizedItem[] {
  const items: NormalizedItem[] = [];
  for (const r of imp.registry) {
    const it = registryItem(r);
    if (it) items.push(it);
  }
  for (const s of imp.secedit) {
    const it = seceditItem(s.section, s.key, s.value);
    if (it) items.push(it);
  }
  for (const a of imp.audit) items.push(auditItem(a.guid, a.subcategory, a.value));
  return items;
}

function collectFromLgpo(imp: LgpoImport): NormalizedItem[] {
  const items: NormalizedItem[] = [];
  for (const r of imp.registry) {
    const it = registryItem(r);
    if (it) items.push(it);
  }
  if (imp.secedit) {
    for (const [k, v] of Object.entries(imp.secedit.systemAccess)) {
      const it = seceditItem('System Access', k, /^-?\d+$/.test(v) ? parseInt(v, 10) : v);
      if (it) items.push(it);
    }
    for (const [k, v] of Object.entries(imp.secedit.privilegeRights)) {
      const it = seceditItem('Privilege Rights', k, v);
      if (it) items.push(it);
    }
    for (const [k, v] of Object.entries(imp.secedit.registryValues)) {
      const it = seceditItem('Registry Values', k, v.value);
      if (it) items.push(it);
    }
    for (const [k, v] of Object.entries(imp.secedit.eventAudit)) {
      const it = seceditItem('Event Audit', k, v);
      if (it) items.push(it);
    }
  }
  for (const a of dedupeAudit(imp.audit)) items.push(auditItem(a.guid, a.subcategory, a.value));
  return items;
}

function dedupeAudit(rows: AuditPolRow[]): AuditPolRow[] {
  const byGuid = new Map<string, AuditPolRow>();
  for (const r of rows) byGuid.set(r.guid, r);
  return [...byGuid.values()];
}

export interface RunImportOptions {
  createPolicy?: { name: string; tenantId?: string | null; description?: string };
}

export async function runCatalogImport(
  prisma: PrismaClient,
  source: { policyRules?: PolicyRulesImport; lgpo?: LgpoImport },
  options: RunImportOptions = {},
): Promise<ImportReport> {
  const items: NormalizedItem[] = [
    ...(source.policyRules ? collectFromPolicyRules(source.policyRules) : []),
    ...(source.lgpo ? collectFromLgpo(source.lgpo) : []),
  ];

  const report: ImportReport = { matchedExisting: 0, createdSettings: 0, skipped: [] };

  // Build lookup indexes over the existing catalog once.
  const existing = await prisma.setting.findMany({
    select: {
      id: true,
      key: true,
      mechanism: true,
      registryHive: true,
      registryKey: true,
      registryValueName: true,
      seceditArea: true,
      seceditKey: true,
      auditGuid: true,
    },
  });
  const regIndex = new Map<string, string>();
  const secIndex = new Map<string, string>();
  const audIndex = new Map<string, string>();
  for (const s of existing) {
    if (s.mechanism === 'REGISTRY_POL' && s.registryKey) {
      regIndex.set(`${s.registryHive ?? 'HKLM'}|${norm(s.registryKey)}|${norm(s.registryValueName ?? '')}`, s.id);
    } else if (s.mechanism === 'SECEDIT' && s.seceditArea && s.seceditKey) {
      secIndex.set(`${norm(s.seceditArea)}|${norm(s.seceditKey)}`, s.id);
    } else if (s.mechanism === 'AUDITPOL' && s.auditGuid) {
      audIndex.set(s.auditGuid.toUpperCase(), s.id);
    }
  }
  const indexFor = (kind: NormalizedItem['matchKind']) =>
    kind === 'registry' ? regIndex : kind === 'secedit' ? secIndex : audIndex;

  const policyValues = new Map<string, unknown>(); // settingId -> value (last write wins)
  const seenCreateKeys = new Set<string>();

  for (const item of items) {
    if (!item.create) continue;
    const index = indexFor(item.matchKind);
    let settingId = index.get(item.matchKey);
    if (settingId) {
      report.matchedExisting++;
    } else {
      // Ensure generated key is unique within this run and against the DB.
      let key = item.create.key;
      let n = 2;
      while (seenCreateKeys.has(key)) key = `${item.create.key}_${n++}`;
      seenCreateKeys.add(key);
      try {
        const created = await prisma.setting.upsert({
          where: { key },
          update: { defaultValue: item.create.defaultValue as Prisma.InputJsonValue },
          create: { ...item.create, key },
        });
        settingId = created.id;
        index.set(item.matchKey, settingId);
        report.createdSettings++;
      } catch (err) {
        report.skipped.push({ reason: (err as Error).message, item: item.display });
        continue;
      }
    }
    policyValues.set(settingId, item.value);
  }

  if (options.createPolicy && policyValues.size > 0) {
    const { name, tenantId, description } = options.createPolicy;
    const policy = await prisma.policy.create({
      data: {
        type: tenantId ? 'SUB' : 'GLOBAL',
        tenantId: tenantId ?? null,
        name,
        description: description ?? 'Imported baseline',
        settings: {
          create: [...policyValues.entries()].map(([settingId, value]) => ({
            settingId,
            value: (value ?? null) as Prisma.InputJsonValue,
            enabled: true,
          })),
        },
      },
    });
    report.policyId = policy.id;
    report.policyName = policy.name;
    report.policyValueCount = policyValues.size;
  }

  return report;
}
