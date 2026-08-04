import type { PrismaClient } from '@prisma/client';

export interface SeedPolicyMeta {
  seedKey: string;
  name: string;
  description: string;
  /** framework key the settings derive from; 'cis_full' means every seeded CIS setting. */
  frameworkKey: string | null;
  /** restrict to CMMC level ('L1' matches controlIds containing '.L1-'). */
  cmmcLevel?: 'L1' | 'L2';
}

export const seedPolicyMetas: SeedPolicyMeta[] = [
  {
    seedKey: 'cis_full',
    name: 'CIS Windows Hardening Baseline (Full)',
    description:
      'The complete CIS-aligned baseline shared by Windows 10/11 and Server 2016-2025: account policies, user rights, security options, advanced audit policy, and the administrative-template security surface.',
    frameworkKey: null,
  },
  {
    seedKey: 'cmmc_l1',
    name: 'CMMC 2.0 Level 1',
    description: 'Settings mapped to CMMC 2.0 Level 1 practices (FAR 52.204-21 basic safeguarding).',
    frameworkKey: 'cmmc',
    cmmcLevel: 'L1',
  },
  {
    seedKey: 'cmmc_l2',
    name: 'CMMC 2.0 Level 2',
    description: 'Settings mapped to CMMC 2.0 Level 1 + Level 2 practices (NIST SP 800-171 aligned).',
    frameworkKey: 'cmmc',
    cmmcLevel: 'L2',
  },
  {
    seedKey: 'nist_800_171',
    name: 'NIST SP 800-171 r2',
    description: 'Settings mapped to NIST SP 800-171 r2 requirements for protecting CUI.',
    frameworkKey: 'nist_800_171',
  },
  {
    seedKey: 'nist_800_53',
    name: 'NIST SP 800-53 r5 (Moderate)',
    description: 'Settings mapped to NIST SP 800-53 r5 Moderate-baseline controls.',
    frameworkKey: 'nist_800_53',
  },
  {
    seedKey: 'hipaa',
    name: 'HIPAA Security Rule',
    description: 'Settings mapped to HIPAA Security Rule administrative, physical, and technical safeguards.',
    frameworkKey: 'hipaa',
  },
  {
    seedKey: 'soc2',
    name: 'SOC 2 (TSC CC-series)',
    description: 'Settings mapped to SOC 2 Trust Services Criteria common criteria.',
    frameworkKey: 'soc2',
  },
];

export interface SeededPolicyDefinition {
  name: string;
  description: string;
  settings: { settingId: string; value: unknown }[];
}

/**
 * Compute a seeded policy definition from current catalog state. Per-framework
 * recommended values (on the control mapping) override the setting default.
 */
export async function getSeededPolicyDefinition(
  prisma: PrismaClient,
  seedKey: string,
): Promise<SeededPolicyDefinition | null> {
  const meta = seedPolicyMetas.find((m) => m.seedKey === seedKey);
  if (!meta) return null;

  if (meta.frameworkKey === null) {
    const settings = await prisma.setting.findMany({
      where: { isSeeded: true, cisRef: { not: null } },
      select: { id: true, defaultValue: true },
    });
    return {
      name: meta.name,
      description: meta.description,
      settings: settings.map((s) => ({ settingId: s.id, value: s.defaultValue })),
    };
  }

  const maps = await prisma.settingControlMap.findMany({
    where: {
      control: {
        framework: { key: meta.frameworkKey },
        ...(meta.cmmcLevel === 'L1' ? { controlId: { contains: '.L1-' } } : {}),
      },
    },
    select: { settingId: true, recommendedValue: true, setting: { select: { defaultValue: true } } },
  });
  const bySetting = new Map<string, unknown>();
  for (const m of maps) {
    const existing = bySetting.get(m.settingId);
    // Prefer an explicit per-framework recommended value over the default.
    if (m.recommendedValue !== null && m.recommendedValue !== undefined) {
      bySetting.set(m.settingId, m.recommendedValue);
    } else if (existing === undefined) {
      bySetting.set(m.settingId, m.setting.defaultValue);
    }
  }
  return {
    name: meta.name,
    description: meta.description,
    settings: [...bySetting.entries()].map(([settingId, value]) => ({ settingId, value })),
  };
}
