import { describe, expect, it } from 'vitest';
import { decodeInfRegValue, generateSecInf, parseSecInf } from '../parsers/secinf';

const SAMPLE = `[Unicode]
Unicode=yes
[System Access]
MinimumPasswordAge = 1
MaximumPasswordAge = 365
MinimumPasswordLength = 14
PasswordComplexity = 1
PasswordHistorySize = 24
LockoutBadCount = 5
NewAdministratorName = "SecAdmin"
EnableGuestAccount = 0
[Privilege Rights]
SeNetworkLogonRight = *S-1-5-32-544,*S-1-5-11
SeDenyNetworkLogonRight = *S-1-5-32-546,*S-1-5-113
SeTcbPrivilege =
SeDebugPrivilege = *S-1-5-32-544
[Registry Values]
MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\LmCompatibilityLevel=4,5
MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\RestrictRemoteSAM=1,"O:BAG:BAD:(A;;RC;;;BA)"
MACHINE\\System\\CurrentControlSet\\Services\\LanmanServer\\Parameters\\NullSessionPipes=7,
MACHINE\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\ScRemoveOption=1,"1"
MACHINE\\System\\CurrentControlSet\\Control\\SecurePipeServers\\Winreg\\AllowedPaths\\Machine=7,System\\CurrentControlSet\\Control\\Print\\Printers,System\\CurrentControlSet\\Services\\Eventlog
[Event Audit]
AuditSystemEvents = 3
AuditLogonEvents = 3
[Version]
signature="$CHICAGO$"
Revision=1
`;

describe('secedit INF parser', () => {
  it('parses System Access, Privilege Rights, Registry Values, Event Audit', () => {
    const inf = parseSecInf(SAMPLE);
    expect(inf.systemAccess.MinimumPasswordLength).toBe('14');
    expect(inf.systemAccess.NewAdministratorName).toBe('SecAdmin');
    expect(inf.privilegeRights.SeNetworkLogonRight).toEqual(['*S-1-5-32-544', '*S-1-5-11']);
    expect(inf.privilegeRights.SeTcbPrivilege).toEqual([]);
    const lm = inf.registryValues['MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\LmCompatibilityLevel'];
    expect(lm.type).toBe(4);
    expect(lm.value).toBe(5);
    const sddl = inf.registryValues['MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\RestrictRemoteSAM'];
    expect(sddl.type).toBe(1);
    expect(sddl.value).toBe('O:BAG:BAD:(A;;RC;;;BA)');
    const pipes = inf.registryValues['MACHINE\\System\\CurrentControlSet\\Services\\LanmanServer\\Parameters\\NullSessionPipes'];
    expect(pipes.value).toEqual([]);
    const paths = inf.registryValues['MACHINE\\System\\CurrentControlSet\\Control\\SecurePipeServers\\Winreg\\AllowedPaths\\Machine'];
    expect(paths.value).toEqual([
      'System\\CurrentControlSet\\Control\\Print\\Printers',
      'System\\CurrentControlSet\\Services\\Eventlog',
    ]);
    expect(inf.eventAudit.AuditSystemEvents).toBe(3);
  });

  it('decodes UTF-16LE with BOM (secedit /export output encoding)', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SAMPLE, 'utf16le')]);
    const inf = parseSecInf(buf);
    expect(inf.systemAccess.MaximumPasswordAge).toBe('365');
    expect(inf.privilegeRights.SeDebugPrivilege).toEqual(['*S-1-5-32-544']);
  });

  it('decodes UTF-8 with BOM and plain ASCII', () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SAMPLE, 'utf8')]);
    expect(parseSecInf(bom).systemAccess.PasswordComplexity).toBe('1');
    expect(parseSecInf(Buffer.from(SAMPLE, 'utf8')).systemAccess.PasswordComplexity).toBe('1');
  });

  it('generates an INF that secedit-parses back identically', () => {
    const { text, buffer } = generateSecInf({
      systemAccess: { MinimumPasswordLength: 14, NewAdministratorName: 'SecAdmin' },
      privilegeRights: { SeDebugPrivilege: ['*S-1-5-32-544'], SeTcbPrivilege: [] },
      registryValues: {
        'MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\LmCompatibilityLevel': { type: 4, value: 5 },
        'MACHINE\\Software\\X\\StrVal': { type: 1, value: 'hello' },
        'MACHINE\\Software\\X\\Multi': { type: 7, value: ['a', 'b'] },
      },
      eventAudit: { AuditSystemEvents: 3 },
    });
    // UTF-16LE BOM required by secedit /configure
    expect(buffer[0]).toBe(0xff);
    expect(buffer[1]).toBe(0xfe);
    expect(text).toContain('[Unicode]');
    expect(text).toContain('[Version]');

    const back = parseSecInf(buffer);
    expect(back.systemAccess.MinimumPasswordLength).toBe('14');
    expect(back.systemAccess.NewAdministratorName).toBe('SecAdmin');
    expect(back.privilegeRights.SeDebugPrivilege).toEqual(['*S-1-5-32-544']);
    expect(back.registryValues['MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\LmCompatibilityLevel'].value).toBe(5);
    expect(back.registryValues['MACHINE\\Software\\X\\StrVal'].value).toBe('hello');
    expect(back.registryValues['MACHINE\\Software\\X\\Multi'].value).toEqual(['a', 'b']);
    expect(back.eventAudit.AuditSystemEvents).toBe(3);
  });

  it('ignores comments and unknown sections without losing them', () => {
    const inf = parseSecInf(`; comment\n[System Access]\nMinimumPasswordLength = 10\n[Service General Setting]\n"Spooler",2,""\n`);
    expect(inf.systemAccess.MinimumPasswordLength).toBe('10');
    expect(inf.other['service general setting']).toBeUndefined(); // no '=' lines are skipped
  });

  it('decodeInfRegValue handles all INF types', () => {
    expect(decodeInfRegValue(4, '900')).toBe(900);
    expect(decodeInfRegValue(1, '"quoted"')).toBe('quoted');
    expect(decodeInfRegValue(2, '%path%')).toBe('%path%');
    expect(decodeInfRegValue(7, 'a,b,c')).toEqual(['a', 'b', 'c']);
    expect(decodeInfRegValue(3, '01,02,0a')).toBe('01020a');
  });
});
