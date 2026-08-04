/**
 * Microsoft Security Compliance Toolkit PolicyAnalyzer `.PolicyRules` parser.
 *
 * PolicyRules files are XML. Observed shapes vary slightly between SCT
 * releases and GPO2PolicyRules output, so this parser is deliberately
 * tolerant. It supports:
 *
 *   <PolicyRules>
 *     <ComputerConfig key="Software\..." valueName="Foo"><Value>1</Value><RegType>REG_DWORD</RegType></ComputerConfig>
 *     <ComputerConfig key="..." valueName="..."><Value type="REG_DWORD" value="1"/></ComputerConfig>
 *     <UserConfig .../>
 *     <SecurityTemplate Section="System Access"><LineItem>MinimumPasswordLength = 14</LineItem>...</SecurityTemplate>
 *     <SecurityTemplate Section="Registry Values"><LineItem>MACHINE\...=4,1</LineItem></SecurityTemplate>
 *     <AuditSubcategory subcategoryGuid="{...}" subcategoryName="..." inclusionSetting="Success and Failure"/>
 *     <AuditSubcategory><SubcategoryGuid>{...}</SubcategoryGuid><InclusionSetting>Success</InclusionSetting></AuditSubcategory>
 *   </PolicyRules>
 *
 * Attribute/element name matching is case-insensitive.
 */

import { XMLParser } from 'fast-xml-parser';
import { auditValueFromText } from './auditcsv';
import { decodeInfRegValue } from './secinf';

export interface ImportedRegistryPolicy {
  scope: 'MACHINE' | 'USER';
  key: string;
  valueName: string;
  regType: string; // REG_DWORD etc.
  value: unknown;
}

export interface ImportedSeceditLine {
  section: string; // "System Access" | "Privilege Rights" | "Registry Values" | "Event Audit" | ...
  key: string;
  rawValue: string;
  value: unknown;
}

export interface ImportedAuditRule {
  guid: string;
  subcategory: string;
  value: number; // 0..3
}

export interface PolicyRulesImport {
  registry: ImportedRegistryPolicy[];
  secedit: ImportedSeceditLine[];
  audit: ImportedAuditRule[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (_name, _jpath, _isLeaf, isAttribute) => !isAttribute,
});

type XmlNode = Record<string, unknown>;

function lcKeys(node: XmlNode): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [k, v] of Object.entries(node)) m.set(k.toLowerCase(), v);
  return m;
}

function attr(node: XmlNode, ...names: string[]): string | undefined {
  const m = lcKeys(node);
  for (const n of names) {
    const v = m.get(`@${n.toLowerCase()}`);
    if (v !== undefined && v !== null) return String(v);
  }
  return undefined;
}

function childText(node: XmlNode, ...names: string[]): string | undefined {
  const m = lcKeys(node);
  for (const n of names) {
    const v = m.get(n.toLowerCase());
    if (v === undefined || v === null) continue;
    const first = Array.isArray(v) ? v[0] : v;
    if (first === undefined || first === null) continue;
    if (typeof first === 'object') {
      const inner = (first as XmlNode)['#text'];
      if (inner !== undefined && inner !== null) return String(inner);
      continue;
    }
    return String(first);
  }
  return undefined;
}

function asArray(v: unknown): XmlNode[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((x) => x !== null && typeof x === 'object') as XmlNode[];
}

function coerceRegValue(regType: string, raw: string): unknown {
  const t = regType.toUpperCase();
  if (t === 'REG_DWORD' || t === 'REG_QWORD') {
    const n = raw.trim().toLowerCase().startsWith('0x') ? parseInt(raw.trim(), 16) : parseInt(raw.trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  if (t === 'REG_MULTI_SZ') return raw.split(/\r?\n|\0/).filter((s) => s.length > 0);
  return raw;
}

function parseRegConfigNode(node: XmlNode, scope: 'MACHINE' | 'USER', out: ImportedRegistryPolicy[]): void {
  const key = attr(node, 'key') ?? childText(node, 'key');
  const valueName = attr(node, 'valueName', 'value_name') ?? childText(node, 'valueName', 'value_name') ?? '';
  if (!key) return;

  // Value can be: <Value>1</Value> + <RegType>REG_DWORD</RegType>,
  // or <Value type="REG_DWORD" value="1"/>, or attributes on the config node.
  let regType = attr(node, 'regtype', 'type') ?? childText(node, 'regtype') ?? '';
  let rawValue = attr(node, 'value') ?? '';

  const m = lcKeys(node);
  const valueNodes = asArray(m.get('value'));
  if (valueNodes.length > 0) {
    const vn = valueNodes[0];
    regType = attr(vn, 'type', 'regtype') ?? childText(node, 'regtype') ?? regType;
    const inner = (vn as XmlNode)['#text'];
    rawValue = attr(vn, 'value') ?? (inner !== undefined && inner !== null ? String(inner) : rawValue);
  } else {
    const plain = childText(node, 'value');
    if (plain !== undefined) rawValue = plain;
  }
  if (!regType) regType = /^\d+$/.test(rawValue.trim()) ? 'REG_DWORD' : 'REG_SZ';

  out.push({
    scope,
    key: key.replace(/^\\+/, ''),
    valueName,
    regType: regType.toUpperCase(),
    value: coerceRegValue(regType, rawValue),
  });
}

function parseSecTemplateNode(node: XmlNode, out: ImportedSeceditLine[]): void {
  const section = attr(node, 'section') ?? childText(node, 'section') ?? '';
  if (!section) return;
  const m = lcKeys(node);
  const items = asArray(m.get('lineitem'));
  const texts: string[] = [];
  for (const item of items) {
    const inner = (item as XmlNode)['#text'];
    if (inner !== undefined && inner !== null) texts.push(String(inner));
  }
  // LineItem may also parse as plain strings when it has no attributes.
  const rawItems = m.get('lineitem');
  if (Array.isArray(rawItems)) {
    for (const it of rawItems) if (typeof it === 'string') texts.push(it);
  } else if (typeof rawItems === 'string') texts.push(rawItems);

  for (const line of texts) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();
    let value: unknown = rawValue;
    if (/^registry values$/i.test(section)) {
      const comma = rawValue.indexOf(',');
      const type = parseInt(comma >= 0 ? rawValue.slice(0, comma) : rawValue, 10);
      value = decodeInfRegValue(Number.isNaN(type) ? 1 : type, comma >= 0 ? rawValue.slice(comma + 1) : '');
    } else if (/^privilege rights$/i.test(section)) {
      value = rawValue === '' ? [] : rawValue.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (/^-?\d+$/.test(rawValue)) {
      value = parseInt(rawValue, 10);
    } else {
      value = rawValue.replace(/^"|"$/g, '');
    }
    out.push({ section, key, rawValue, value });
  }
}

function parseAuditNode(node: XmlNode, out: ImportedAuditRule[]): void {
  const guid = (attr(node, 'subcategoryGuid', 'guid') ?? childText(node, 'subcategoryGuid', 'guid') ?? '').toUpperCase();
  if (!/^\{[0-9A-F-]{36}\}$/.test(guid)) return;
  const name = attr(node, 'subcategoryName', 'name', 'subcategory') ?? childText(node, 'subcategoryName', 'subcategory') ?? '';
  const inclusion =
    attr(node, 'inclusionSetting', 'setting', 'value') ?? childText(node, 'inclusionSetting', 'setting', 'value') ?? '';
  const value = /^\d+$/.test(inclusion.trim()) ? parseInt(inclusion, 10) & 3 : auditValueFromText(inclusion);
  out.push({ guid, subcategory: name, value });
}

export function parsePolicyRules(input: Buffer | string): PolicyRulesImport {
  const text = typeof input === 'string' ? input : decodeXmlBuffer(input);
  let doc: XmlNode;
  try {
    doc = parser.parse(text) as XmlNode;
  } catch (err) {
    throw new Error(`PolicyRules: XML parse failed: ${(err as Error).message}`);
  }
  const rootEntry = Object.entries(doc).find(([k]) => k.toLowerCase() === 'policyrules');
  if (!rootEntry) throw new Error('PolicyRules: missing <PolicyRules> root element');
  const roots = asArray(rootEntry[1]);
  const result: PolicyRulesImport = { registry: [], secedit: [], audit: [] };

  for (const root of roots) {
    for (const [name, value] of Object.entries(root)) {
      const lname = name.toLowerCase();
      if (lname === 'computerconfig') for (const n of asArray(value)) parseRegConfigNode(n, 'MACHINE', result.registry);
      else if (lname === 'userconfig') for (const n of asArray(value)) parseRegConfigNode(n, 'USER', result.registry);
      else if (lname === 'securitytemplate') for (const n of asArray(value)) parseSecTemplateNode(n, result.secedit);
      else if (lname === 'auditsubcategory' || lname === 'auditsubcategoryname' || lname === 'auditrule')
        for (const n of asArray(value)) parseAuditNode(n, result.audit);
    }
  }
  return result;
}

function decodeXmlBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}
