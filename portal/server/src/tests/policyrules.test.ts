import { describe, expect, it } from 'vitest';
import { parsePolicyRules } from '../parsers/policyrules';

const SHAPE_A = `<?xml version="1.0" encoding="utf-8"?>
<PolicyRules>
  <ComputerConfig key="Software\\Policies\\Microsoft\\Windows\\EventLog\\Security" valueName="MaxSize">
    <Value>196608</Value>
    <RegType>REG_DWORD</RegType>
  </ComputerConfig>
  <ComputerConfig key="Software\\Policies\\Microsoft\\Windows\\System" valueName="ShellSmartScreenLevel">
    <Value>Block</Value>
    <RegType>REG_SZ</RegType>
  </ComputerConfig>
  <UserConfig key="software\\policies\\microsoft\\office\\16.0\\excel\\security" valueName="vbawarnings">
    <Value>3</Value>
    <RegType>REG_DWORD</RegType>
  </UserConfig>
  <SecurityTemplate Section="System Access">
    <LineItem>MinimumPasswordLength = 14</LineItem>
    <LineItem>LockoutBadCount = 5</LineItem>
  </SecurityTemplate>
  <SecurityTemplate Section="Privilege Rights">
    <LineItem>SeDenyNetworkLogonRight = *S-1-5-32-546,*S-1-5-113</LineItem>
  </SecurityTemplate>
  <SecurityTemplate Section="Registry Values">
    <LineItem>MACHINE\\System\\CurrentControlSet\\Control\\Lsa\\LmCompatibilityLevel=4,5</LineItem>
  </SecurityTemplate>
  <AuditSubcategory subcategoryGuid="{0CCE9215-69AE-11D9-BED3-505054503030}" subcategoryName="Logon" inclusionSetting="Success and Failure" />
</PolicyRules>`;

const SHAPE_B = `<?xml version="1.0"?>
<PolicyRules>
  <ComputerConfig key="Software\\Policies\\Test" valueName="Flag">
    <Value type="REG_DWORD" value="1"/>
  </ComputerConfig>
  <AuditSubcategory>
    <SubcategoryGuid>{0CCE9228-69AE-11D9-BED3-505054503030}</SubcategoryGuid>
    <SubcategoryName>Sensitive Privilege Use</SubcategoryName>
    <InclusionSetting>Failure</InclusionSetting>
  </AuditSubcategory>
</PolicyRules>`;

describe('PolicyRules parser', () => {
  it('parses registry, security template, and audit rules (shape A)', () => {
    const out = parsePolicyRules(SHAPE_A);
    expect(out.registry).toHaveLength(3);
    const maxSize = out.registry.find((r) => r.valueName === 'MaxSize')!;
    expect(maxSize.scope).toBe('MACHINE');
    expect(maxSize.regType).toBe('REG_DWORD');
    expect(maxSize.value).toBe(196608);
    const smartscreen = out.registry.find((r) => r.valueName === 'ShellSmartScreenLevel')!;
    expect(smartscreen.value).toBe('Block');
    const vba = out.registry.find((r) => r.valueName === 'vbawarnings')!;
    expect(vba.scope).toBe('USER');
    expect(vba.value).toBe(3);

    expect(out.secedit).toHaveLength(4);
    const minLen = out.secedit.find((s) => s.key === 'MinimumPasswordLength')!;
    expect(minLen.section).toBe('System Access');
    expect(minLen.value).toBe(14);
    const deny = out.secedit.find((s) => s.key === 'SeDenyNetworkLogonRight')!;
    expect(deny.value).toEqual(['*S-1-5-32-546', '*S-1-5-113']);
    const lm = out.secedit.find((s) => s.key.endsWith('LmCompatibilityLevel'))!;
    expect(lm.value).toBe(5);

    expect(out.audit).toHaveLength(1);
    expect(out.audit[0]).toMatchObject({ guid: '{0CCE9215-69AE-11D9-BED3-505054503030}', subcategory: 'Logon', value: 3 });
  });

  it('parses attribute-style values and element-style audit rules (shape B)', () => {
    const out = parsePolicyRules(SHAPE_B);
    expect(out.registry).toHaveLength(1);
    expect(out.registry[0].value).toBe(1);
    expect(out.registry[0].regType).toBe('REG_DWORD');
    expect(out.audit).toHaveLength(1);
    expect(out.audit[0]).toMatchObject({ guid: '{0CCE9228-69AE-11D9-BED3-505054503030}', value: 2 });
  });

  it('handles UTF-16 encoded buffers', () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SHAPE_B, 'utf16le')]);
    expect(parsePolicyRules(buf).registry).toHaveLength(1);
  });

  it('infers REG types when missing and parses hex dwords', () => {
    const xml = `<PolicyRules>
      <ComputerConfig key="Software\\P" valueName="N"><Value>42</Value></ComputerConfig>
      <ComputerConfig key="Software\\P" valueName="H"><Value type="REG_DWORD" value="0x10"/></ComputerConfig>
      <ComputerConfig key="Software\\P" valueName="S"><Value>hello</Value></ComputerConfig>
    </PolicyRules>`;
    const out = parsePolicyRules(xml);
    expect(out.registry.find((r) => r.valueName === 'N')!.value).toBe(42);
    expect(out.registry.find((r) => r.valueName === 'H')!.value).toBe(16);
    expect(out.registry.find((r) => r.valueName === 'S')!.regType).toBe('REG_SZ');
  });

  it('rejects non-PolicyRules XML and garbage', () => {
    expect(() => parsePolicyRules('<NotPolicyRules/>')).toThrow(/PolicyRules/);
    expect(() => parsePolicyRules('this is not xml <<<')).toThrow();
  });
});
