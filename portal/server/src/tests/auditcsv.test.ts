import { describe, expect, it } from 'vitest';
import { auditValueFromText, auditValueToText, parseAuditCsv, splitCsvLine } from '../parsers/auditcsv';

const SAMPLE = `Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value
WIN-SRV01,System,Security State Change,{0CCE9210-69AE-11D9-BED3-505054503030},Success,,1
WIN-SRV01,System,Logon,{0CCE9215-69AE-11D9-BED3-505054503030},Success and Failure,,3
WIN-SRV01,System,Logoff,{0CCE9216-69AE-11D9-BED3-505054503030},Success,,1
WIN-SRV01,System,Account Lockout,{0cce9217-69ae-11d9-bed3-505054503030},Failure,,2
WIN-SRV01,System,Credential Validation,{0CCE923F-69AE-11D9-BED3-505054503030},No Auditing,,0
`;

describe('auditpol CSV parser', () => {
  it('parses the /r report format', () => {
    const rows = parseAuditCsv(SAMPLE);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      machine: 'WIN-SRV01',
      subcategory: 'Security State Change',
      guid: '{0CCE9210-69AE-11D9-BED3-505054503030}',
      value: 1,
    });
    expect(rows[1].value).toBe(3);
    // GUIDs normalized to uppercase
    expect(rows[3].guid).toBe('{0CCE9217-69AE-11D9-BED3-505054503030}');
    expect(rows[4].value).toBe(0);
  });

  it('derives the value from inclusion text when the numeric column is missing', () => {
    const noNumeric = `Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting
HOST,System,Logon,{0CCE9215-69AE-11D9-BED3-505054503030},Success and Failure,
HOST,System,Logoff,{0CCE9216-69AE-11D9-BED3-505054503030},Failure,
`;
    const rows = parseAuditCsv(noNumeric);
    expect(rows[0].value).toBe(3);
    expect(rows[1].value).toBe(2);
  });

  it('handles quoted fields containing commas', () => {
    const quoted = `HOST,System,"Kerberos Service Ticket Operations, extended",{0CCE9240-69AE-11D9-BED3-505054503030},Success,,1`;
    const rows = parseAuditCsv(quoted);
    expect(rows).toHaveLength(1);
    expect(rows[0].subcategory).toBe('Kerberos Service Ticket Operations, extended');
  });

  it('skips header rows, blank lines, and non-GUID rows', () => {
    const messy = `\n\nMachine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value\nnot,a,real,row,at,all,0\n${SAMPLE}`;
    expect(parseAuditCsv(messy)).toHaveLength(5);
  });

  it('decodes UTF-16LE with BOM (auditpol /backup encoding)', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SAMPLE, 'utf16le')]);
    expect(parseAuditCsv(buf)).toHaveLength(5);
  });

  it('text/value helpers agree in both directions', () => {
    expect(auditValueFromText('Success')).toBe(1);
    expect(auditValueFromText('Failure')).toBe(2);
    expect(auditValueFromText('Success and Failure')).toBe(3);
    expect(auditValueFromText('No Auditing')).toBe(0);
    expect(auditValueToText(0)).toBe('No Auditing');
    expect(auditValueToText(1)).toBe('Success');
    expect(auditValueToText(2)).toBe('Failure');
    expect(auditValueToText(3)).toBe('Success and Failure');
  });

  it('splitCsvLine handles escaped quotes', () => {
    expect(splitCsvLine('a,"b ""quoted"" c",d')).toEqual(['a', 'b "quoted" c', 'd']);
  });
});
