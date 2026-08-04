import { describe, expect, it } from 'vitest';
import {
  buildEffectiveDocument,
  canonicalJson,
  computePolicyHash,
  resolveEffectivePolicy,
  type CatalogSettingInfo,
  type ResolvableAssignment,
} from '../services/effectivePolicy';

const mkAssignment = (
  id: string,
  scope: 'TENANT' | 'GROUP' | 'COMPUTER',
  settings: { settingId: string; value: unknown; enabled?: boolean }[],
  opts: Partial<ResolvableAssignment> = {},
): ResolvableAssignment => ({
  id,
  scope,
  groupId: opts.groupId ?? null,
  computerId: opts.computerId ?? null,
  priority: opts.priority ?? 0,
  createdAt: opts.createdAt ?? '2026-01-01T00:00:00Z',
  policy: {
    id: `pol-${id}`,
    name: `Policy ${id}`,
    settings: settings.map((s) => ({ settingId: s.settingId, value: s.value, enabled: s.enabled ?? true })),
  },
});

describe('resolveEffectivePolicy', () => {
  it('applies tenant default when nothing else matches', () => {
    const r = resolveEffectivePolicy([mkAssignment('t', 'TENANT', [{ settingId: 's1', value: 1 }])], 'c1', []);
    expect(r.settings.get('s1')?.value).toBe(1);
    expect(r.settings.get('s1')?.scope).toBe('TENANT');
  });

  it('computer assignment beats group and tenant', () => {
    const r = resolveEffectivePolicy(
      [
        mkAssignment('t', 'TENANT', [{ settingId: 's1', value: 'tenant' }]),
        mkAssignment('g', 'GROUP', [{ settingId: 's1', value: 'group' }], { groupId: 'g1' }),
        mkAssignment('c', 'COMPUTER', [{ settingId: 's1', value: 'computer' }], { computerId: 'c1' }),
      ],
      'c1',
      ['g1'],
    );
    expect(r.settings.get('s1')?.value).toBe('computer');
    expect(r.settings.get('s1')?.scope).toBe('COMPUTER');
  });

  it('group assignment beats tenant', () => {
    const r = resolveEffectivePolicy(
      [
        mkAssignment('t', 'TENANT', [{ settingId: 's1', value: 'tenant' }]),
        mkAssignment('g', 'GROUP', [{ settingId: 's1', value: 'group' }], { groupId: 'g1' }),
      ],
      'c1',
      ['g1'],
    );
    expect(r.settings.get('s1')?.value).toBe('group');
  });

  it('non-member group assignments are ignored', () => {
    const r = resolveEffectivePolicy(
      [
        mkAssignment('t', 'TENANT', [{ settingId: 's1', value: 'tenant' }]),
        mkAssignment('g', 'GROUP', [{ settingId: 's1', value: 'group' }], { groupId: 'other-group' }),
      ],
      'c1',
      ['g1'],
    );
    expect(r.settings.get('s1')?.value).toBe('tenant');
  });

  it('computer assignments for other computers are ignored', () => {
    const r = resolveEffectivePolicy(
      [
        mkAssignment('t', 'TENANT', [{ settingId: 's1', value: 'tenant' }]),
        mkAssignment('c', 'COMPUTER', [{ settingId: 's1', value: 'other' }], { computerId: 'c2' }),
      ],
      'c1',
      [],
    );
    expect(r.settings.get('s1')?.value).toBe('tenant');
  });

  it('per-setting merge: specific level overrides only what it defines', () => {
    const r = resolveEffectivePolicy(
      [
        mkAssignment('t', 'TENANT', [
          { settingId: 's1', value: 'tenant1' },
          { settingId: 's2', value: 'tenant2' },
          { settingId: 's3', value: 'tenant3' },
        ]),
        mkAssignment('g', 'GROUP', [{ settingId: 's2', value: 'group2' }], { groupId: 'g1' }),
        mkAssignment('c', 'COMPUTER', [{ settingId: 's3', value: 'computer3' }], { computerId: 'c1' }),
      ],
      'c1',
      ['g1'],
    );
    expect(r.settings.get('s1')?.value).toBe('tenant1');
    expect(r.settings.get('s2')?.value).toBe('group2');
    expect(r.settings.get('s3')?.value).toBe('computer3');
  });

  it('two groups: higher priority wins', () => {
    const r = resolveEffectivePolicy(
      [
        mkAssignment('gLow', 'GROUP', [{ settingId: 's1', value: 'low' }], { groupId: 'g1', priority: 1 }),
        mkAssignment('gHigh', 'GROUP', [{ settingId: 's1', value: 'high' }], { groupId: 'g2', priority: 10 }),
      ],
      'c1',
      ['g1', 'g2'],
    );
    expect(r.settings.get('s1')?.value).toBe('high');
    expect(r.settings.get('s1')?.priority).toBe(10);
  });

  it('two groups same priority: newer assignment wins, then id (deterministic)', () => {
    const byDate = resolveEffectivePolicy(
      [
        mkAssignment('a', 'GROUP', [{ settingId: 's1', value: 'older' }], { groupId: 'g1', createdAt: '2026-01-01T00:00:00Z' }),
        mkAssignment('b', 'GROUP', [{ settingId: 's1', value: 'newer' }], { groupId: 'g2', createdAt: '2026-02-01T00:00:00Z' }),
      ],
      'c1',
      ['g1', 'g2'],
    );
    expect(byDate.settings.get('s1')?.value).toBe('newer');

    const byId = resolveEffectivePolicy(
      [
        mkAssignment('b', 'GROUP', [{ settingId: 's1', value: 'idB' }], { groupId: 'g2' }),
        mkAssignment('a', 'GROUP', [{ settingId: 's1', value: 'idA' }], { groupId: 'g1' }),
      ],
      'c1',
      ['g1', 'g2'],
    );
    expect(byId.settings.get('s1')?.value).toBe('idA'); // same tier/priority/date -> lowest id
  });

  it('group priority does not out-rank a computer assignment', () => {
    const r = resolveEffectivePolicy(
      [
        mkAssignment('g', 'GROUP', [{ settingId: 's1', value: 'group' }], { groupId: 'g1', priority: 999 }),
        mkAssignment('c', 'COMPUTER', [{ settingId: 's1', value: 'computer' }], { computerId: 'c1', priority: -5 }),
      ],
      'c1',
      ['g1'],
    );
    expect(r.settings.get('s1')?.value).toBe('computer');
  });

  it('enabled=false masks the setting from lower precedence levels', () => {
    const r = resolveEffectivePolicy(
      [
        mkAssignment('t', 'TENANT', [{ settingId: 's1', value: 'tenant' }]),
        mkAssignment('c', 'COMPUTER', [{ settingId: 's1', value: 'ignored', enabled: false }], { computerId: 'c1' }),
      ],
      'c1',
      [],
    );
    expect(r.settings.has('s1')).toBe(false);
    expect(r.masked.has('s1')).toBe(true);
  });

  it('empty assignment list yields empty policy', () => {
    const r = resolveEffectivePolicy([], 'c1', []);
    expect(r.settings.size).toBe(0);
  });

  it('multiple tenant-level assignments merge with priority', () => {
    const r = resolveEffectivePolicy(
      [
        mkAssignment('t1', 'TENANT', [{ settingId: 's1', value: 'base' }, { settingId: 's2', value: 'base2' }], { priority: 0 }),
        mkAssignment('t2', 'TENANT', [{ settingId: 's1', value: 'override' }], { priority: 5 }),
      ],
      'c1',
      [],
    );
    expect(r.settings.get('s1')?.value).toBe('override');
    expect(r.settings.get('s2')?.value).toBe('base2');
  });
});

describe('buildEffectiveDocument + hashing', () => {
  const catalog = new Map<string, CatalogSettingInfo>([
    ['s1', { id: 's1', key: 'k_reg', name: 'Reg setting', mechanism: 'REGISTRY_POL', scope: 'MACHINE', registryHive: 'HKLM', registryKey: 'Software\\X', registryValueName: 'V', registryValueType: 'REG_DWORD', dataType: 'dword' }],
    ['s2', { id: 's2', key: 'k_sec', name: 'Sec setting', mechanism: 'SECEDIT', scope: 'MACHINE', seceditArea: 'System Access', seceditKey: 'MinimumPasswordLength', dataType: 'dword' }],
    ['s3', { id: 's3', key: 'k_aud', name: 'Audit setting', mechanism: 'AUDITPOL', scope: 'MACHINE', auditSubcategory: 'Logon', auditGuid: '{0CCE9215-69AE-11D9-BED3-505054503030}', dataType: 'dword' }],
  ]);

  it('produces flat entries with mechanism-specific fields and a stable hash', () => {
    const resolved = resolveEffectivePolicy(
      [mkAssignment('t', 'TENANT', [
        { settingId: 's1', value: 1 },
        { settingId: 's2', value: 14 },
        { settingId: 's3', value: 3 },
      ])],
      'c1',
      [],
    );
    const doc = buildEffectiveDocument(resolved, catalog, () => new Date('2026-01-02T03:04:05Z'));
    expect(doc.entries).toHaveLength(3);
    expect(doc.entries.map((e) => e.settingKey)).toEqual(['k_aud', 'k_reg', 'k_sec']); // sorted
    const reg = doc.entries.find((e) => e.settingKey === 'k_reg')!;
    expect(reg.registry).toEqual({ hive: 'HKLM', key: 'Software\\X', valueName: 'V', valueType: 'REG_DWORD' });
    const sec = doc.entries.find((e) => e.settingKey === 'k_sec')!;
    expect(sec.secedit).toEqual({ area: 'System Access', key: 'MinimumPasswordLength' });
    const aud = doc.entries.find((e) => e.settingKey === 'k_aud')!;
    expect(aud.audit?.guid).toContain('0CCE9215');

    // Hash is order-independent and value-sensitive.
    const again = buildEffectiveDocument(resolved, catalog);
    expect(again.policyHash).toBe(doc.policyHash);
    const changed = resolveEffectivePolicy(
      [mkAssignment('t', 'TENANT', [
        { settingId: 's1', value: 2 },
        { settingId: 's2', value: 14 },
        { settingId: 's3', value: 3 },
      ])],
      'c1',
      [],
    );
    expect(buildEffectiveDocument(changed, catalog).policyHash).not.toBe(doc.policyHash);
  });

  it('drops settings deleted from the catalog', () => {
    const resolved = resolveEffectivePolicy(
      [mkAssignment('t', 'TENANT', [{ settingId: 'ghost', value: 1 }, { settingId: 's1', value: 1 }])],
      'c1',
      [],
    );
    const doc = buildEffectiveDocument(resolved, catalog);
    expect(doc.entries.map((e) => e.settingKey)).toEqual(['k_reg']);
  });

  it('canonicalJson sorts keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
    expect(computePolicyHash([])).toHaveLength(64);
  });
});
