/**
 * `auditpol /get /category:* /r` and `auditpol /backup` CSV parser.
 *
 * Columns (backup format is the same shape):
 *   Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value
 *
 * Setting Value bitmask: 0 = No Auditing, 1 = Success, 2 = Failure, 3 = Success and Failure.
 * Some locales/exports omit the numeric column; the Inclusion Setting text is
 * then used to derive the value.
 */

export interface AuditPolRow {
  machine: string;
  target: string;
  subcategory: string;
  guid: string;
  inclusion: string;
  exclusion: string;
  /** 0..3 bitmask (Success=1, Failure=2). */
  value: number;
}

export function auditValueFromText(text: string): number {
  const t = text.trim().toLowerCase();
  if (!t || t === 'no auditing') return 0;
  const success = t.includes('success');
  const failure = t.includes('failure');
  return (success ? 1 : 0) | (failure ? 2 : 0);
}

export function auditValueToText(value: number): string {
  switch (value & 3) {
    case 1:
      return 'Success';
    case 2:
      return 'Failure';
    case 3:
      return 'Success and Failure';
    default:
      return 'No Auditing';
  }
}

/** Minimal CSV line splitter with quote support. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseAuditCsv(input: Buffer | string): AuditPolRow[] {
  let text = typeof input === 'string' ? input : decodeCsvBuffer(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: AuditPolRow[] = [];
  for (const line of lines) {
    const cols = splitCsvLine(line).map((c) => c.trim());
    if (cols.length < 4) continue;
    // Skip header row.
    if (/^machine name$/i.test(cols[0]) || /^subcategory$/i.test(cols[2] ?? '')) continue;
    const guid = (cols[3] ?? '').toUpperCase();
    if (!/^\{[0-9A-F-]{36}\}$/.test(guid)) continue;
    const inclusion = cols[4] ?? '';
    const rawValue = cols[6] ?? '';
    const parsed = parseInt(rawValue, 10);
    rows.push({
      machine: cols[0] ?? '',
      target: cols[1] ?? '',
      subcategory: cols[2] ?? '',
      guid,
      inclusion,
      exclusion: cols[5] ?? '',
      value: Number.isNaN(parsed) ? auditValueFromText(inclusion) : parsed & 3,
    });
  }
  return rows;
}

function decodeCsvBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf.includes(0)) return buf.toString('utf16le');
  return buf.toString('utf8');
}
