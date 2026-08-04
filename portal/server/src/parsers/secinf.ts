/**
 * Security template (GptTmpl.inf / `secedit /export` output) parser + generator.
 *
 * Sections of interest:
 *   [System Access]     Password/lockout policy: Key = Value
 *   [Privilege Rights]  User rights: SeXxxRight = *S-1-5-32-544,Name,...
 *   [Registry Values]   Security options: MACHINE\path\value=Type,Data
 *   [Event Audit]       Legacy audit categories: AuditXxx = 0..3
 *
 * Files are typically UTF-16LE with BOM; UTF-8/ANSI also accepted.
 */

export interface SecInf {
  systemAccess: Record<string, string>;
  privilegeRights: Record<string, string[]>;
  registryValues: Record<string, { type: number; raw: string; value: unknown }>;
  eventAudit: Record<string, number>;
  /** Any other sections preserved verbatim (lines). */
  other: Record<string, string[]>;
}

export function decodeInfBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16BE: swap bytes
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  // Heuristic: NUL bytes present -> UTF-16LE without BOM
  if (buf.includes(0)) return buf.toString('utf16le');
  return buf.toString('utf8');
}

export function parseSecInf(input: Buffer | string): SecInf {
  const text = typeof input === 'string' ? input : decodeInfBuffer(input);
  const out: SecInf = { systemAccess: {}, privilegeRights: {}, registryValues: {}, eventAudit: {}, other: {} };
  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const secMatch = /^\[(.+)\]$/.exec(line);
    if (secMatch) {
      section = secMatch[1].trim().toLowerCase();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    switch (section) {
      case 'system access':
        out.systemAccess[key] = stripQuotes(val);
        break;
      case 'privilege rights':
        out.privilegeRights[key] = val === '' ? [] : val.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      case 'registry values': {
        const comma = val.indexOf(',');
        const type = parseInt(comma >= 0 ? val.slice(0, comma) : val, 10);
        const raw = comma >= 0 ? val.slice(comma + 1) : '';
        out.registryValues[key] = { type: Number.isNaN(type) ? 1 : type, raw, value: decodeInfRegValue(type, raw) };
        break;
      }
      case 'event audit': {
        const n = parseInt(val, 10);
        out.eventAudit[key] = Number.isNaN(n) ? 0 : n;
        break;
      }
      case 'unicode':
      case 'version':
        break;
      default: {
        const bucket = (out.other[section] ??= []);
        bucket.push(line);
      }
    }
  }
  return out;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

/** INF registry value types: 1=REG_SZ 2=REG_EXPAND_SZ 3=REG_BINARY 4=REG_DWORD 7=REG_MULTI_SZ */
export function decodeInfRegValue(type: number, raw: string): unknown {
  switch (type) {
    case 4:
      return parseInt(stripQuotes(raw), 10);
    case 1:
    case 2:
      return stripQuotes(raw);
    case 7:
      // Values separated by commas; individual items may be quoted.
      return raw === '' ? [] : raw.split(',').map((s) => stripQuotes(s.trim())).filter((s) => s.length > 0);
    case 3:
      return raw.replace(/[,\s]/g, '');
    default:
      return stripQuotes(raw);
  }
}

export function encodeInfRegValue(type: number, value: unknown): string {
  switch (type) {
    case 4:
      return `4,${Number(value)}`;
    case 1:
      return `1,"${String(value)}"`;
    case 2:
      return `2,"${String(value)}"`;
    case 7: {
      const arr = Array.isArray(value) ? value.map(String) : String(value).split('\n');
      return `7,${arr.join(',')}`;
    }
    case 3:
      return `3,${String(value)}`;
    default:
      return `${type},${String(value)}`;
  }
}

export interface SecInfBuild {
  systemAccess?: Record<string, string | number>;
  privilegeRights?: Record<string, string[]>;
  registryValues?: Record<string, { type: number; value: unknown }>;
  eventAudit?: Record<string, number>;
}

/**
 * Generate a security template INF (as used by `secedit /configure`).
 * Only sections with content are emitted. Returns a UTF-16LE buffer with BOM,
 * which is what secedit expects.
 */
export function generateSecInf(build: SecInfBuild): { text: string; buffer: Buffer } {
  const lines: string[] = ['[Unicode]', 'Unicode=yes'];
  const areas: string[] = [];

  if (build.systemAccess && Object.keys(build.systemAccess).length) {
    lines.push('[System Access]');
    for (const [k, v] of Object.entries(build.systemAccess)) {
      lines.push(typeof v === 'number' ? `${k} = ${v}` : `${k} = ${formatSystemAccessValue(v)}`);
    }
    areas.push('SECURITYPOLICY');
  }
  if (build.privilegeRights && Object.keys(build.privilegeRights).length) {
    lines.push('[Privilege Rights]');
    for (const [k, v] of Object.entries(build.privilegeRights)) lines.push(`${k} = ${v.join(',')}`);
  }
  if (build.registryValues && Object.keys(build.registryValues).length) {
    lines.push('[Registry Values]');
    for (const [k, v] of Object.entries(build.registryValues)) lines.push(`${k}=${encodeInfRegValue(v.type, v.value)}`);
  }
  if (build.eventAudit && Object.keys(build.eventAudit).length) {
    lines.push('[Event Audit]');
    for (const [k, v] of Object.entries(build.eventAudit)) lines.push(`${k} = ${v}`);
  }
  lines.push('[Version]', 'signature="$CHICAGO$"', 'Revision=1', '');
  const text = lines.join('\r\n');
  const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  return { text, buffer };
}

function formatSystemAccessValue(v: string): string {
  // Numeric and boolean-ish values are bare; strings (e.g. NewAdministratorName) are quoted.
  if (/^-?\d+$/.test(v)) return v;
  return `"${v}"`;
}
