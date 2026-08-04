/**
 * Seed data model for the settings catalog.
 *
 * Framework mapping shorthand: control ids may carry a confidence suffix —
 *   "AC-2!"  high confidence (direct technical implementation of the control)
 *   "AC-2"   medium confidence (supports the control)
 *   "AC-2?"  low confidence (partial / contextual)
 *
 * CMMC 2.0 practices are auto-derived from the NIST 800-171 mapping
 * (3.1.1 -> AC.L2-3.1.1, upgraded to AC.L1-3.1.1 for FAR-derived L1 practices)
 * unless `noCmmc` is set or `cmmcExtra` adds practices explicitly.
 */

export type Conf = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SeedMaps {
  /** NIST SP 800-171 r2 requirement ids, e.g. "3.1.1". */
  n171?: string[];
  /** NIST SP 800-53 r5 control ids, e.g. "AC-7". */
  n53?: string[];
  /** HIPAA Security Rule cites, e.g. "164.312(a)(1)". */
  hipaa?: string[];
  /** SOC 2 TSC ids, e.g. "CC6.1". */
  soc2?: string[];
  /** Additional CMMC practice ids beyond the auto-derived ones. */
  cmmcExtra?: string[];
  /** Suppress the automatic CMMC derivation from n171. */
  noCmmc?: boolean;
}

export interface AllowedValue {
  value: unknown;
  label: string;
}

export interface SeedEntry {
  key: string;
  cis?: string;
  category: string;
  name: string;
  desc: string;
  risk: string;
  mech: 'registry_pol' | 'secedit' | 'auditpol';
  scope?: 'MACHINE' | 'USER';
  reg?: [hive: string, key: string, valueName: string, valueType: string];
  sec?: [area: string, key: string];
  audit?: [subcategory: string, guid: string];
  /** dataType: dword | string | multi | qword | binary. Defaults per helper. */
  type?: string;
  /** Recommended baseline (CIS-aligned) value. */
  value: unknown;
  allowed?: AllowedValue[];
  minBuild?: number;
  maps?: SeedMaps;
  /** Per-framework recommended value overrides, keyed by framework key. */
  recommended?: Record<string, unknown>;
}

export const EN_DIS: AllowedValue[] = [
  { value: 1, label: 'Enabled' },
  { value: 0, label: 'Disabled' },
];

export const DIS_EN: AllowedValue[] = [
  { value: 0, label: 'Enabled (0)' },
  { value: 1, label: 'Disabled (1)' },
];

export const AUDIT_VALUES: AllowedValue[] = [
  { value: 0, label: 'No Auditing' },
  { value: 1, label: 'Success' },
  { value: 2, label: 'Failure' },
  { value: 3, label: 'Success and Failure' },
];

// Well-known SID shorthand used in user rights assignments.
export const SID = {
  ADMINISTRATORS: '*S-1-5-32-544',
  USERS: '*S-1-5-32-545',
  GUESTS: '*S-1-5-32-546',
  BACKUP_OPERATORS: '*S-1-5-32-551',
  REMOTE_DESKTOP_USERS: '*S-1-5-32-555',
  PERFLOG_USERS: '*S-1-5-32-559',
  EVERYONE: '*S-1-1-0',
  AUTHENTICATED_USERS: '*S-1-5-11',
  LOCAL_SERVICE: '*S-1-5-19',
  NETWORK_SERVICE: '*S-1-5-20',
  SERVICE: '*S-1-5-6',
  LOCAL_ACCOUNT: '*S-1-5-113',
  WINDOW_MANAGER: '*S-1-5-90-0',
  GUEST: '*S-1-5-32-546',
  NT_VIRTUAL_MACHINES: '*S-1-5-83-0',
} as const;

// ---------------------------------------------------------------------------
// Entry helper factories (each seed file closes over its category)
// ---------------------------------------------------------------------------

type Opts = Partial<Pick<SeedEntry, 'allowed' | 'minBuild' | 'maps' | 'recommended' | 'type' | 'scope' | 'cis'>>;

/** [System Access] secedit entry. */
export const sysAccess =
  (category: string) =>
  (key: string, cis: string, name: string, secKey: string, value: number | string, desc: string, risk: string, opts: Opts = {}): SeedEntry => ({
    key,
    cis,
    category,
    name,
    desc,
    risk,
    mech: 'secedit',
    sec: ['System Access', secKey],
    type: typeof value === 'number' ? 'dword' : 'string',
    value,
    ...opts,
  });

/** [Privilege Rights] secedit entry (user rights assignment). */
export const userRight =
  (category: string) =>
  (key: string, cis: string, name: string, privilege: string, value: string[], desc: string, risk: string, opts: Opts = {}): SeedEntry => ({
    key,
    cis,
    category,
    name,
    desc,
    risk,
    mech: 'secedit',
    sec: ['Privilege Rights', privilege],
    type: 'multi',
    value,
    ...opts,
  });

/** [Registry Values] secedit entry (security options + MSS + raw HKLM values). */
export const regValue =
  (category: string) =>
  (
    key: string,
    cis: string,
    name: string,
    machinePath: string,
    infType: 1 | 2 | 3 | 4 | 7,
    value: unknown,
    desc: string,
    risk: string,
    opts: Opts = {},
  ): SeedEntry => ({
    key,
    cis,
    category,
    name,
    desc,
    risk,
    mech: 'secedit',
    sec: ['Registry Values', `MACHINE\\${machinePath}`],
    type: infType === 4 ? 'dword' : infType === 7 ? 'multi' : infType === 3 ? 'binary' : infType === 2 ? 'expand' : 'string',
    value,
    ...opts,
  });

/** Advanced audit policy entry. */
export const auditSub =
  (category: string) =>
  (key: string, cis: string, name: string, guid: string, value: number, desc: string, risk: string, opts: Opts = {}): SeedEntry => ({
    key,
    cis,
    category,
    name: `Audit ${name}`,
    desc,
    risk,
    mech: 'auditpol',
    audit: [name, guid],
    type: 'dword',
    value,
    allowed: AUDIT_VALUES,
    ...opts,
  });

/** Administrative template (Registry.pol) entry. */
export const adminTemplate =
  (category: string) =>
  (
    key: string,
    cis: string,
    name: string,
    reg: [key: string, valueName: string, valueType: string],
    value: unknown,
    desc: string,
    risk: string,
    opts: Opts = {},
  ): SeedEntry => ({
    key,
    cis,
    category,
    name,
    desc,
    risk,
    mech: 'registry_pol',
    scope: opts.scope ?? 'MACHINE',
    reg: [opts.scope === 'USER' ? 'HKCU' : 'HKLM', reg[0], reg[1], reg[2]],
    type:
      opts.type ??
      (reg[2] === 'REG_DWORD' ? 'dword' : reg[2] === 'REG_MULTI_SZ' ? 'multi' : reg[2] === 'REG_QWORD' ? 'qword' : 'string'),
    value,
    ...opts,
  });
