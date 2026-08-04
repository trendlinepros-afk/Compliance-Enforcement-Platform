import crypto from 'crypto';

/**
 * Effective policy resolution.
 *
 * Precedence (most specific wins, per setting):
 *   1. COMPUTER assignment  (tier 3)
 *   2. GROUP assignment     (tier 2) — between two groups containing the same
 *      computer, the assignment with the higher `priority` integer wins;
 *      ties break to the newer assignment, then assignment id (deterministic).
 *   3. TENANT assignment    (tier 1) — same priority/tie rules if several exist.
 *
 * Merge is per setting: a more specific assignment overrides only the settings
 * it defines; everything else falls through to the next level.
 *
 * A policy row with enabled=false is an explicit mask: it removes the setting
 * from the effective policy even if a lower-precedence assignment defines it.
 */

export type AssignmentScope = 'TENANT' | 'GROUP' | 'COMPUTER';

export interface ResolvablePolicySetting {
  settingId: string;
  value: unknown;
  enabled: boolean;
}

export interface ResolvableAssignment {
  id: string;
  scope: AssignmentScope;
  groupId?: string | null;
  computerId?: string | null;
  priority: number;
  createdAt: Date | string;
  policy: {
    id: string;
    name: string;
    settings: ResolvablePolicySetting[];
  };
}

export interface EffectiveSettingSource {
  settingId: string;
  value: unknown;
  policyId: string;
  policyName: string;
  scope: AssignmentScope;
  assignmentId: string;
  priority: number;
}

export interface ResolvedPolicy {
  /** settingId -> winning value + provenance. Masked (enabled=false) settings are absent. */
  settings: Map<string, EffectiveSettingSource>;
  /** settingIds that were explicitly masked by an enabled=false row. */
  masked: Set<string>;
}

const TIER: Record<AssignmentScope, number> = { COMPUTER: 3, GROUP: 2, TENANT: 1 };

function orderAssignments(a: ResolvableAssignment, b: ResolvableAssignment): number {
  const tier = TIER[b.scope] - TIER[a.scope];
  if (tier !== 0) return tier;
  if (b.priority !== a.priority) return b.priority - a.priority;
  const at = new Date(a.createdAt).getTime();
  const bt = new Date(b.createdAt).getTime();
  if (bt !== at) return bt - at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pure resolution: given every assignment in the tenant plus the computer's
 * group memberships, produce the winning value per setting.
 */
export function resolveEffectivePolicy(
  assignments: ResolvableAssignment[],
  computerId: string,
  groupIds: string[],
): ResolvedPolicy {
  const groupSet = new Set(groupIds);
  const applicable = assignments.filter((a) => {
    if (a.scope === 'TENANT') return true;
    if (a.scope === 'GROUP') return a.groupId != null && groupSet.has(a.groupId);
    if (a.scope === 'COMPUTER') return a.computerId === computerId;
    return false;
  });
  applicable.sort(orderAssignments);

  const settings = new Map<string, EffectiveSettingSource>();
  const masked = new Set<string>();
  const decided = new Set<string>();

  for (const assignment of applicable) {
    for (const ps of assignment.policy.settings) {
      if (decided.has(ps.settingId)) continue;
      decided.add(ps.settingId);
      if (!ps.enabled) {
        masked.add(ps.settingId);
        continue;
      }
      settings.set(ps.settingId, {
        settingId: ps.settingId,
        value: ps.value,
        policyId: assignment.policy.id,
        policyName: assignment.policy.name,
        scope: assignment.scope,
        assignmentId: assignment.id,
        priority: assignment.priority,
      });
    }
  }
  return { settings, masked };
}

// ---------------------------------------------------------------------------
// Agent-facing effective policy document
// ---------------------------------------------------------------------------

export interface CatalogSettingInfo {
  id: string;
  key: string;
  name: string;
  mechanism: 'REGISTRY_POL' | 'SECEDIT' | 'AUDITPOL';
  scope: 'MACHINE' | 'USER';
  registryHive?: string | null;
  registryKey?: string | null;
  registryValueName?: string | null;
  registryValueType?: string | null;
  seceditArea?: string | null;
  seceditKey?: string | null;
  auditSubcategory?: string | null;
  auditGuid?: string | null;
  dataType: string;
  minBuild?: number | null;
}

export interface EffectivePolicyEntry {
  settingKey: string;
  settingName: string;
  mechanism: 'REGISTRY_POL' | 'SECEDIT' | 'AUDITPOL';
  scope: 'MACHINE' | 'USER';
  registry?: { hive: string; key: string; valueName: string; valueType: string };
  secedit?: { area: string; key: string };
  audit?: { subcategory: string; guid: string };
  dataType: string;
  minBuild?: number;
  desiredValue: unknown;
  sourcePolicyId: string;
  sourcePolicyName: string;
  sourceScope: AssignmentScope;
}

export interface EffectivePolicyDocument {
  policyHash: string;
  generatedAt: string;
  entries: EffectivePolicyEntry[];
}

/** Canonical JSON: object keys sorted so hashing is stable across serializers. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function computePolicyHash(entries: EffectivePolicyEntry[]): string {
  const minimal = entries
    .map((e) => ({ k: e.settingKey, v: e.desiredValue }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return crypto.createHash('sha256').update(canonicalJson(minimal)).digest('hex');
}

/**
 * Join resolved settings with catalog metadata to produce the flat document the
 * agent consumes (setting key, mechanism, desired value) plus a stable hash.
 */
export function buildEffectiveDocument(
  resolved: ResolvedPolicy,
  catalog: Map<string, CatalogSettingInfo>,
  now: () => Date = () => new Date(),
): EffectivePolicyDocument {
  const entries: EffectivePolicyEntry[] = [];
  for (const [settingId, src] of resolved.settings) {
    const info = catalog.get(settingId);
    if (!info) continue; // setting deleted from catalog after policy was authored
    const entry: EffectivePolicyEntry = {
      settingKey: info.key,
      settingName: info.name,
      mechanism: info.mechanism,
      scope: info.scope,
      dataType: info.dataType,
      desiredValue: src.value,
      sourcePolicyId: src.policyId,
      sourcePolicyName: src.policyName,
      sourceScope: src.scope,
    };
    if (info.minBuild != null) entry.minBuild = info.minBuild;
    if (info.mechanism === 'REGISTRY_POL') {
      entry.registry = {
        hive: info.registryHive ?? 'HKLM',
        key: info.registryKey ?? '',
        valueName: info.registryValueName ?? '',
        valueType: info.registryValueType ?? 'REG_DWORD',
      };
    } else if (info.mechanism === 'SECEDIT') {
      entry.secedit = { area: info.seceditArea ?? '', key: info.seceditKey ?? '' };
    } else if (info.mechanism === 'AUDITPOL') {
      entry.audit = { subcategory: info.auditSubcategory ?? '', guid: info.auditGuid ?? '' };
    }
    entries.push(entry);
  }
  entries.sort((a, b) => (a.settingKey < b.settingKey ? -1 : a.settingKey > b.settingKey ? 1 : 0));
  return {
    policyHash: computePolicyHash(entries),
    generatedAt: now().toISOString(),
    entries,
  };
}
