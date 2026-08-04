/**
 * Idempotent seed — runs on every boot (safe to re-run on deploy).
 *
 *  1. Admin user from ADMIN_USER / ADMIN_PASSWORD env (created if missing).
 *  2. Frameworks + control dictionaries.
 *  3. Settings catalog (seed-owned technical fields always refreshed;
 *     description/riskNote only filled when empty so operator edits survive).
 *  4. Setting-to-control mappings with confidence + per-framework recommended values.
 *  5. Seeded global policies (created once; "reset to seed" restores them later).
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { allCatalogEntries } from './catalog';
import {
  cmmcPracticeId,
  frameworkSeeds,
  hipaaControls,
  n171Controls,
  n53Controls,
  soc2Controls,
} from './frameworks';
import { getSeededPolicyDefinition, seedPolicyMetas } from './globalPolicies';
import type { SeedEntry } from './types';

const parseRef = (ref: string): { id: string; conf: 'HIGH' | 'MEDIUM' | 'LOW' } => {
  if (ref.endsWith('!')) return { id: ref.slice(0, -1), conf: 'HIGH' };
  if (ref.endsWith('?')) return { id: ref.slice(0, -1), conf: 'LOW' };
  return { id: ref, conf: 'MEDIUM' };
};

// Postgres jsonb re-orders object keys, so compare canonically (sorted keys).
import { canonicalJson } from '../services/effectivePolicy';
const jsonEq = (a: unknown, b: unknown): boolean => canonicalJson(a ?? null) === canonicalJson(b ?? null);

function settingDataFromEntry(e: SeedEntry): Omit<Prisma.SettingCreateInput, 'key'> {
  const mech = e.mech === 'registry_pol' ? 'REGISTRY_POL' : e.mech === 'secedit' ? 'SECEDIT' : 'AUDITPOL';
  return {
    category: e.category,
    name: e.name,
    description: e.desc,
    riskNote: e.risk,
    mechanism: mech,
    scope: e.scope ?? 'MACHINE',
    registryHive: e.reg?.[0] ?? null,
    registryKey: e.reg?.[1] ?? null,
    registryValueName: e.reg?.[2] ?? null,
    registryValueType: e.reg?.[3] ?? null,
    seceditArea: e.sec?.[0] ?? null,
    seceditKey: e.sec?.[1] ?? null,
    auditSubcategory: e.audit?.[0] ?? null,
    auditGuid: e.audit?.[1] ?? null,
    dataType: e.type ?? 'dword',
    allowedValues: (e.allowed ?? null) as unknown as Prisma.InputJsonValue,
    defaultValue: (e.value ?? null) as Prisma.InputJsonValue,
    minBuild: e.minBuild ?? null,
    cisRef: e.cis ?? null,
    isSeeded: true,
    needsDescription: false,
  };
}

export async function runSeed(prisma: PrismaClient): Promise<void> {
  const started = Date.now();

  // ----- 1. Admin user ---------------------------------------------------
  const adminUser = process.env.ADMIN_USER ?? 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';
  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUser } });
  if (!existingAdmin) {
    if (!adminPassword) {
      console.warn(`[seed] ADMIN_PASSWORD not set and user "${adminUser}" does not exist — no admin will be created`);
    } else {
      const { hashPassword } = await import('../lib/auth');
      await prisma.user.create({
        data: { username: adminUser, passwordHash: await hashPassword(adminPassword), role: 'ADMIN' },
      });
      console.log(`[seed] created admin user "${adminUser}"`);
    }
  }

  // ----- 2. Frameworks + controls ---------------------------------------
  const frameworkIds = new Map<string, string>();
  for (const f of frameworkSeeds) {
    const row = await prisma.framework.upsert({
      where: { key: f.key },
      update: { name: f.name, version: f.version, description: f.description },
      create: { key: f.key, name: f.name, version: f.version, description: f.description },
    });
    frameworkIds.set(f.key, row.id);
  }

  const existingControls = await prisma.frameworkControl.findMany({
    select: { id: true, frameworkId: true, controlId: true, title: true },
  });
  const controlIdByKey = new Map<string, string>(); // `${frameworkKey}|${controlId}` -> row id
  const fkeyById = new Map([...frameworkIds.entries()].map(([k, id]) => [id, k]));
  for (const c of existingControls) {
    const fkey = fkeyById.get(c.frameworkId);
    if (fkey) controlIdByKey.set(`${fkey}|${c.controlId}`, c.id);
  }

  const ensureControl = async (frameworkKey: string, controlId: string, title: string): Promise<string> => {
    const mapKey = `${frameworkKey}|${controlId}`;
    const known = controlIdByKey.get(mapKey);
    if (known) return known;
    const frameworkId = frameworkIds.get(frameworkKey);
    if (!frameworkId) throw new Error(`[seed] unknown framework key ${frameworkKey}`);
    const row = await prisma.frameworkControl.upsert({
      where: { frameworkId_controlId: { frameworkId, controlId } },
      update: { title },
      create: { frameworkId, controlId, title },
    });
    controlIdByKey.set(mapKey, row.id);
    return row.id;
  };

  const dictControls: [string, Record<string, string>][] = [
    ['nist_800_171', n171Controls],
    ['nist_800_53', n53Controls],
    ['hipaa', hipaaControls],
    ['soc2', soc2Controls],
  ];
  for (const [fkey, dict] of dictControls) {
    for (const [id, title] of Object.entries(dict)) await ensureControl(fkey, id, title);
  }
  // CMMC practices derive from the 800-171 dictionary.
  for (const [id, title] of Object.entries(n171Controls)) {
    await ensureControl('cmmc', cmmcPracticeId(id), title);
  }

  // ----- 3 + 4. Settings + mappings -------------------------------------
  if (allCatalogEntries.length < 300) {
    console.warn(`[seed] catalog has only ${allCatalogEntries.length} entries — expected several hundred`);
  }

  const existingSettings = await prisma.setting.findMany();
  const settingByKey = new Map(existingSettings.map((s) => [s.key, s]));
  const existingMaps = await prisma.settingControlMap.findMany({
    select: { settingId: true, controlId: true, confidence: true, recommendedValue: true },
  });
  const mapIndex = new Map(existingMaps.map((m) => [`${m.settingId}|${m.controlId}`, m]));

  let createdSettings = 0;
  let updatedSettings = 0;
  let mappings = 0;

  for (const entry of allCatalogEntries) {
    const data = settingDataFromEntry(entry);
    const existing = settingByKey.get(entry.key);
    let settingId: string;
    if (!existing) {
      const row = await prisma.setting.create({ data: { key: entry.key, ...data } });
      settingId = row.id;
      createdSettings++;
    } else {
      settingId = existing.id;
      // Seed owns technical identity; operator-edited prose is preserved.
      const update: Prisma.SettingUpdateInput = {};
      const fields: (keyof typeof data)[] = [
        'category', 'name', 'mechanism', 'scope', 'registryHive', 'registryKey', 'registryValueName',
        'registryValueType', 'seceditArea', 'seceditKey', 'auditSubcategory', 'auditGuid', 'dataType',
        'minBuild', 'cisRef',
      ];
      for (const f of fields) {
        if (!jsonEq((existing as Record<string, unknown>)[f], data[f])) (update as Record<string, unknown>)[f] = data[f];
      }
      if (!jsonEq(existing.allowedValues, data.allowedValues)) update.allowedValues = data.allowedValues as Prisma.InputJsonValue;
      if (!jsonEq(existing.defaultValue, data.defaultValue)) update.defaultValue = data.defaultValue as Prisma.InputJsonValue;
      if (!existing.description.trim() && entry.desc) update.description = entry.desc;
      if (!existing.riskNote.trim() && entry.risk) update.riskNote = entry.risk;
      if (!existing.isSeeded) update.isSeeded = true;
      if (existing.needsDescription) update.needsDescription = false;
      if (Object.keys(update).length > 0) {
        await prisma.setting.update({ where: { id: settingId }, data: update });
        updatedSettings++;
      }
    }

    // Framework mappings.
    const refs: { fkey: string; id: string; conf: 'HIGH' | 'MEDIUM' | 'LOW'; title: string }[] = [];
    if (entry.cis) refs.push({ fkey: 'cis', id: entry.cis, conf: 'HIGH', title: entry.name });
    const m = entry.maps ?? {};
    for (const raw of m.n171 ?? []) {
      const { id, conf } = parseRef(raw);
      const title = n171Controls[id];
      if (!title) throw new Error(`[seed] ${entry.key}: unknown 800-171 id ${id}`);
      refs.push({ fkey: 'nist_800_171', id, conf, title });
      if (!m.noCmmc) refs.push({ fkey: 'cmmc', id: cmmcPracticeId(id), conf, title });
    }
    for (const raw of m.cmmcExtra ?? []) {
      const { id, conf } = parseRef(raw);
      refs.push({ fkey: 'cmmc', id, conf, title: id });
    }
    for (const raw of m.n53 ?? []) {
      const { id, conf } = parseRef(raw);
      const title = n53Controls[id];
      if (!title) throw new Error(`[seed] ${entry.key}: unknown 800-53 id ${id}`);
      refs.push({ fkey: 'nist_800_53', id, conf, title });
    }
    for (const raw of m.hipaa ?? []) {
      const { id, conf } = parseRef(raw);
      const title = hipaaControls[id];
      if (!title) throw new Error(`[seed] ${entry.key}: unknown HIPAA cite ${id}`);
      refs.push({ fkey: 'hipaa', id, conf, title });
    }
    for (const raw of m.soc2 ?? []) {
      const { id, conf } = parseRef(raw);
      const title = soc2Controls[id];
      if (!title) throw new Error(`[seed] ${entry.key}: unknown SOC 2 id ${id}`);
      refs.push({ fkey: 'soc2', id, conf, title });
    }

    for (const ref of refs) {
      const controlRowId = await ensureControl(ref.fkey, ref.id, ref.title);
      // Per-framework recommended value: seedKey-level override map uses framework keys;
      // cmmc levels share the 'cmmc' key.
      const rec = entry.recommended?.[ref.fkey] ?? null;
      const cached = mapIndex.get(`${settingId}|${controlRowId}`);
      if (!cached) {
        await prisma.settingControlMap.create({
          data: {
            settingId,
            controlId: controlRowId,
            confidence: ref.conf,
            recommendedValue: (rec ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
        mapIndex.set(`${settingId}|${controlRowId}`, {
          settingId,
          controlId: controlRowId,
          confidence: ref.conf,
          recommendedValue: rec as Prisma.JsonValue,
        });
        mappings++;
      } else if (cached.confidence !== ref.conf || !jsonEq(cached.recommendedValue, rec)) {
        await prisma.settingControlMap.update({
          where: { settingId_controlId: { settingId, controlId: controlRowId } },
          data: { confidence: ref.conf, recommendedValue: (rec ?? null) as Prisma.InputJsonValue },
        });
      }
    }
  }

  // ----- 5. Seeded global policies --------------------------------------
  let createdPolicies = 0;
  for (const meta of seedPolicyMetas) {
    const existing = await prisma.policy.findUnique({ where: { seedKey: meta.seedKey } });
    if (existing) continue; // operator may have customized; reset-to-seed restores
    const def = await getSeededPolicyDefinition(prisma, meta.seedKey);
    if (!def || def.settings.length === 0) continue;
    await prisma.policy.create({
      data: {
        type: 'GLOBAL',
        name: def.name,
        description: def.description,
        isSeeded: true,
        seedKey: meta.seedKey,
        settings: {
          create: def.settings.map((s) => ({
            settingId: s.settingId,
            value: (s.value ?? null) as Prisma.InputJsonValue,
            enabled: true,
          })),
        },
      },
    });
    createdPolicies++;
  }

  console.log(
    `[seed] done in ${Date.now() - started}ms — settings: ${createdSettings} created / ${updatedSettings} updated of ${allCatalogEntries.length}; mappings added: ${mappings}; policies created: ${createdPolicies}`,
  );
}

// Allow `npm run seed` standalone.
if (require.main === module) {
  (async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
      await runSeed(prisma);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
