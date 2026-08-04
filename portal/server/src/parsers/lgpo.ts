/**
 * LGPO backup folder importer. Accepts a zip of an LGPO.exe /b backup (or any
 * GPO backup layout) and extracts:
 *   - Machine + User registry.pol (PReg)
 *   - GptTmpl.inf (SecEdit security template)
 *   - audit.csv (advanced audit policy)
 *
 * Files are located case-insensitively anywhere in the tree, so both
 * `{GUID}\DomainSysvol\GPO\Machine\registry.pol` and flat layouts work.
 */

import AdmZip from 'adm-zip';
import { parsePreg, decodeRegValue, regTypeName } from './preg';
import { parseSecInf, type SecInf } from './secinf';
import { parseAuditCsv, type AuditPolRow } from './auditcsv';
import type { ImportedRegistryPolicy } from './policyrules';

export interface LgpoImport {
  registry: ImportedRegistryPolicy[];
  secedit: SecInf | null;
  audit: AuditPolRow[];
  filesFound: string[];
}

const isUserPath = (p: string): boolean => /(^|[\\/])user[\\/]/i.test(p) || /gpousers?/i.test(p);

export function parseLgpoZip(zipBuf: Buffer): LgpoImport {
  const zip = new AdmZip(zipBuf);
  const result: LgpoImport = { registry: [], secedit: null, audit: [], filesFound: [] };

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    const base = name.split(/[\\/]/).pop()?.toLowerCase() ?? '';
    try {
      if (base === 'registry.pol') {
        const scope: 'MACHINE' | 'USER' = isUserPath(name) ? 'USER' : 'MACHINE';
        const { records } = parsePreg(entry.getData());
        for (const r of records) {
          result.registry.push({
            scope,
            key: r.key,
            valueName: r.valueName,
            regType: regTypeName(r.type),
            value: decodeRegValue(r.type, r.data),
          });
        }
        result.filesFound.push(name);
      } else if (base === 'gpttmpl.inf') {
        result.secedit = parseSecInf(entry.getData());
        result.filesFound.push(name);
      } else if (base === 'audit.csv' || (base.endsWith('.csv') && /audit/i.test(name))) {
        const rows = parseAuditCsv(entry.getData());
        if (rows.length > 0) {
          result.audit.push(...rows);
          result.filesFound.push(name);
        }
      }
    } catch (err) {
      throw new Error(`LGPO import: failed to parse ${name}: ${(err as Error).message}`);
    }
  }
  if (result.filesFound.length === 0) {
    throw new Error('LGPO import: no registry.pol, GptTmpl.inf, or audit CSV found in the archive');
  }
  return result;
}
