import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { parseLgpoZip } from '../parsers/lgpo';
import { writePreg, encodeRegValue, REG_DWORD, REG_SZ } from '../parsers/preg';
import { parsePolicyRules } from '../parsers/policyrules';
import { runCatalogImport } from '../services/catalogImport';

const RUN_TAG = `CustomApp${Date.now()}`;

function buildLgpoZip(): Buffer {
  const zip = new AdmZip();
  const machinePol = writePreg([
    { key: 'Software\\Policies\\Microsoft\\Windows\\WinRM\\Service', valueName: 'AllowBasic', type: REG_DWORD, data: encodeRegValue(REG_DWORD, 0) },
    { key: `Software\\Policies\\Microsoft\\${RUN_TAG}`, valueName: 'Hardening', type: REG_SZ, data: encodeRegValue(REG_SZ, 'on') },
    { key: `Software\\Policies\\Microsoft\\${RUN_TAG}`, valueName: '**DeleteValues', type: REG_SZ, data: encodeRegValue(REG_SZ, 'A;B') },
  ]);
  const userPol = writePreg([
    { key: 'software\\policies\\microsoft\\office\\16.0\\excel\\security', valueName: 'vbawarnings', type: REG_DWORD, data: encodeRegValue(REG_DWORD, 3) },
  ]);
  const gptTmpl = [
    '[Unicode]', 'Unicode=yes',
    '[System Access]', 'MinimumPasswordLength = 14',
    '[Privilege Rights]', 'SeDebugPrivilege = *S-1-5-32-544',
    '[Registry Values]', 'MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\NoLMHash=4,1',
    '[Version]', 'signature="$CHICAGO$"', 'Revision=1',
  ].join('\r\n');
  const auditCsv = [
    'Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value',
    'HOST,System,Logon,{0CCE9215-69AE-11D9-BED3-505054503030},Success and Failure,,3',
    'HOST,System,Removable Storage,{0CCE9245-69AE-11D9-BED3-505054503030},Success and Failure,,3',
  ].join('\r\n');

  zip.addFile('{12345678-1234-1234-1234-123456789012}/DomainSysvol/GPO/Machine/registry.pol', machinePol);
  zip.addFile('{12345678-1234-1234-1234-123456789012}/DomainSysvol/GPO/User/registry.pol', userPol);
  zip.addFile(
    '{12345678-1234-1234-1234-123456789012}/DomainSysvol/GPO/Machine/microsoft/windows nt/SecEdit/GptTmpl.inf',
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(gptTmpl, 'utf16le')]),
  );
  zip.addFile('{12345678-1234-1234-1234-123456789012}/DomainSysvol/GPO/Machine/microsoft/windows nt/Audit/audit.csv', Buffer.from(auditCsv, 'utf8'));
  return zip.toBuffer();
}

describe('LGPO backup zip parser', () => {
  it('extracts machine + user registry.pol, GptTmpl.inf, and audit.csv from a nested layout', () => {
    const out = parseLgpoZip(buildLgpoZip());
    expect(out.filesFound).toHaveLength(4);

    const machine = out.registry.filter((r) => r.scope === 'MACHINE');
    const user = out.registry.filter((r) => r.scope === 'USER');
    expect(machine.some((r) => r.valueName === '**DeleteValues')).toBe(true); // preserved by the parser
    expect(machine.map((r) => r.valueName)).toContain('AllowBasic');
    expect(machine.find((r) => r.valueName === 'AllowBasic')!.value).toBe(0);
    expect(user).toHaveLength(1);
    expect(user[0].value).toBe(3);

    expect(out.secedit?.systemAccess.MinimumPasswordLength).toBe('14');
    expect(out.secedit?.privilegeRights.SeDebugPrivilege).toEqual(['*S-1-5-32-544']);
    expect(out.secedit?.registryValues['MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\NoLMHash'].value).toBe(1);
    expect(out.audit).toHaveLength(2);
    expect(out.audit[0].guid).toBe('{0CCE9215-69AE-11D9-BED3-505054503030}');
  });

  it('throws a clear error for archives with no policy files', () => {
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('nothing here'));
    expect(() => parseLgpoZip(zip.toBuffer())).toThrow(/no registry.pol/i);
  });
});

// DB-backed importer test — runs when TEST_DATABASE_URL points at a migrated,
// seeded database (local dev + CI service container).
const dbUrl = process.env.TEST_DATABASE_URL ?? '';

describe.skipIf(!dbUrl)('runCatalogImport (database)', () => {
  it('matches seeded settings, creates unknown ones flagged needsDescription, and builds a policy', async () => {
    process.env.DATABASE_URL = dbUrl;
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    try {
      const lgpo = parseLgpoZip(buildLgpoZip());
      const report = await runCatalogImport(prisma, { lgpo }, { createPolicy: { name: `Imported Test ${Date.now()}` } });

      // AllowBasic (WinRM), vbawarnings, MinimumPasswordLength, SeDebugPrivilege,
      // NoLMHash, Logon + Removable Storage audit all exist in the seeded catalog.
      expect(report.matchedExisting).toBeGreaterThanOrEqual(7);
      // Software\Policies\Microsoft\CustomApp\Hardening is not in the catalog.
      expect(report.createdSettings).toBeGreaterThanOrEqual(1);
      expect(report.policyId).toBeTruthy();
      expect(report.policyValueCount).toBeGreaterThanOrEqual(8);

      const created = await prisma.setting.findFirst({
        where: { registryKey: `Software\\Policies\\Microsoft\\${RUN_TAG}`, registryValueName: 'Hardening' },
      });
      expect(created).not.toBeNull();
      expect(created!.needsDescription).toBe(true);
      expect(created!.isSeeded).toBe(false);

      // Re-import: idempotent (no new settings), matches increase.
      const report2 = await runCatalogImport(prisma, { lgpo });
      expect(report2.createdSettings).toBe(0);
      expect(report2.matchedExisting).toBe(report.matchedExisting + report.createdSettings);

      // PolicyRules path against the same DB.
      const pr = parsePolicyRules(`<PolicyRules>
        <ComputerConfig key="SOFTWARE\\Policies\\Microsoft\\Windows\\WinRM\\Service" valueName="AllowUnencryptedTraffic"><Value>0</Value><RegType>REG_DWORD</RegType></ComputerConfig>
        <SecurityTemplate Section="System Access"><LineItem>LockoutBadCount = 5</LineItem></SecurityTemplate>
      </PolicyRules>`);
      const report3 = await runCatalogImport(prisma, { policyRules: pr });
      expect(report3.matchedExisting).toBe(2);
      expect(report3.createdSettings).toBe(0);

      if (report.policyId) await prisma.policy.delete({ where: { id: report.policyId } });
      if (created) await prisma.setting.delete({ where: { id: created.id } });
    } finally {
      await prisma.$disconnect();
    }
  });
});
