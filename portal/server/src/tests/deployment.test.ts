import { describe, expect, it } from 'vitest';
import { rollupNonCompliant, countPending, type NonCompliantRow } from '../services/deployment';

const setting = (over: Partial<NonCompliantRow['setting']> & { key: string }): NonCompliantRow['setting'] => ({
  key: over.key,
  name: over.name ?? over.key,
  category: over.category ?? 'Account Policies',
  description: over.description ?? '',
  riskNote: over.riskNote ?? '',
  mechanism: over.mechanism ?? 'REGISTRY_POL',
});

const row = (o: {
  settingKey: string;
  computerId: string;
  hostname: string;
  current?: unknown;
  required?: unknown;
  checkedAt?: string;
}): NonCompliantRow => ({
  settingId: o.settingKey, // use key as id for test simplicity
  currentValue: o.current ?? 0,
  requiredValue: o.required ?? 1,
  checkedAt: new Date(o.checkedAt ?? '2026-08-06T00:00:00Z'),
  computerId: o.computerId,
  hostname: o.hostname,
  setting: setting({ key: o.settingKey, name: o.settingKey.toUpperCase() }),
});

describe('rollupNonCompliant', () => {
  it('groups by setting, counts machines, sorts by impact', () => {
    const { settings, affectedComputers } = rollupNonCompliant([
      row({ settingKey: 'screensaver', computerId: 'c1', hostname: 'PC1' }),
      row({ settingKey: 'smbv1', computerId: 'c1', hostname: 'PC1' }),
      row({ settingKey: 'smbv1', computerId: 'c2', hostname: 'PC2' }),
      row({ settingKey: 'smbv1', computerId: 'c3', hostname: 'PC3' }),
    ]);
    expect(settings.map((s) => s.key)).toEqual(['smbv1', 'screensaver']); // most-affected first
    expect(settings[0].nonCompliantCount).toBe(3);
    expect(settings[0].computers.map((c) => c.hostname)).toEqual(['PC1', 'PC2', 'PC3']);
    expect(settings[1].nonCompliantCount).toBe(1);
    expect(affectedComputers).toBe(3); // c1, c2, c3 distinct
  });

  it('carries the risk note and required value through', () => {
    const [s] = rollupNonCompliant([
      {
        ...row({ settingKey: 'macro', computerId: 'c1', hostname: 'PC1', required: 2, current: 0 }),
        setting: setting({ key: 'macro', name: 'Block macros', riskNote: 'Finance macros may break' }),
      },
    ]).settings;
    expect(s.riskNote).toBe('Finance macros may break');
    expect(s.requiredValue).toBe(2);
    expect(s.computers[0].currentValue).toBe(0);
  });

  it('reports the latest check time and empty plan for no rows', () => {
    expect(rollupNonCompliant([]).settings).toEqual([]);
    expect(rollupNonCompliant([]).lastCheckedAt).toBeNull();
    const { lastCheckedAt } = rollupNonCompliant([
      row({ settingKey: 'a', computerId: 'c1', hostname: 'PC1', checkedAt: '2026-08-01T00:00:00Z' }),
      row({ settingKey: 'b', computerId: 'c1', hostname: 'PC1', checkedAt: '2026-08-06T09:00:00Z' }),
    ]);
    expect(lastCheckedAt).toBe('2026-08-06T09:00:00.000Z');
  });
});

describe('countPending', () => {
  const docs = new Map<string, { policyHash: string; entries: unknown[] }>([
    ['c1', { policyHash: 'H1', entries: [{}] }],
    ['c2', { policyHash: 'H2', entries: [{}] }],
    ['c3', { policyHash: 'EMPTY', entries: [] }], // no policy → never pending
  ]);

  it('counts machines whose effective hash is not yet approved', () => {
    const pending = countPending(
      [
        { id: 'c1', approvedPolicyHash: '' }, // never approved -> pending
        { id: 'c2', approvedPolicyHash: 'H2' }, // approved, up to date -> not pending
        { id: 'c3', approvedPolicyHash: '' }, // empty policy -> not pending
      ],
      docs,
    );
    expect(pending).toBe(1);
  });

  it('treats a stale approval (hash drift) as pending again', () => {
    const pending = countPending([{ id: 'c1', approvedPolicyHash: 'OLD' }], docs);
    expect(pending).toBe(1);
  });
});
