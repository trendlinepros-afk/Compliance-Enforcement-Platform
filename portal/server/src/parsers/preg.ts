/**
 * Registry.pol (PReg) parser/writer.
 *
 * File layout (all little-endian, body strings UTF-16LE):
 *   magic   4 bytes  "PReg" (0x50 0x52 0x65 0x67)
 *   version 4 bytes  DWORD, currently 1
 *   records: [key;value;type;size;data]
 *     '[' ';' ']' are UTF-16LE characters (2 bytes each)
 *     key   null-terminated UTF-16LE string
 *     value null-terminated UTF-16LE string
 *     type  DWORD (REG_* code)
 *     size  DWORD (byte length of data)
 *     data  raw bytes (size long)
 *
 * The writer emits records in exactly this canonical layout, so
 * parse(write(records)) and write(parse(bytes)) round-trip byte-perfectly for
 * files produced by Windows' RegFile API (which uses the same layout).
 */

export const REG_NONE = 0;
export const REG_SZ = 1;
export const REG_EXPAND_SZ = 2;
export const REG_BINARY = 3;
export const REG_DWORD = 4;
export const REG_MULTI_SZ = 7;
export const REG_QWORD = 11;

export interface PregRecord {
  key: string;
  valueName: string;
  type: number;
  /** Raw data bytes exactly as stored. */
  data: Buffer;
}

const MAGIC = 0x67655250; // "PReg" read as LE uint32
const PREG_VERSION = 1;

const CH_OPEN = 0x5b; // '['
const CH_CLOSE = 0x5d; // ']'
const CH_SEMI = 0x3b; // ';'

export function parsePreg(buf: Buffer): { version: number; records: PregRecord[] } {
  if (buf.length < 8) throw new Error('PReg: file too short');
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error('PReg: bad magic (expected "PReg")');
  const version = buf.readUInt32LE(4);
  const records: PregRecord[] = [];
  let off = 8;

  const readChar = (): number => {
    if (off + 2 > buf.length) throw new Error(`PReg: truncated at offset ${off}`);
    const c = buf.readUInt16LE(off);
    off += 2;
    return c;
  };
  const readSz = (): string => {
    const start = off;
    for (;;) {
      if (off + 2 > buf.length) throw new Error(`PReg: unterminated string at offset ${start}`);
      const c = buf.readUInt16LE(off);
      off += 2;
      if (c === 0) break;
    }
    return buf.subarray(start, off - 2).toString('utf16le');
  };
  const expect = (ch: number, what: string): void => {
    const c = readChar();
    if (c !== ch)
      throw new Error(`PReg: expected '${String.fromCharCode(ch)}' (${what}) at offset ${off - 2}, got 0x${c.toString(16)}`);
  };

  while (off < buf.length) {
    // Tolerate trailing NUL padding some writers append.
    if (buf.length - off < 2) break;
    if (buf.readUInt16LE(off) === 0) {
      off += 2;
      continue;
    }
    expect(CH_OPEN, 'record start');
    const key = readSz();
    expect(CH_SEMI, 'after key');
    const valueName = readSz();
    expect(CH_SEMI, 'after value name');
    if (off + 4 > buf.length) throw new Error('PReg: truncated type');
    const type = buf.readUInt32LE(off);
    off += 4;
    expect(CH_SEMI, 'after type');
    if (off + 4 > buf.length) throw new Error('PReg: truncated size');
    const size = buf.readUInt32LE(off);
    off += 4;
    expect(CH_SEMI, 'after size');
    if (off + size > buf.length) throw new Error('PReg: truncated data');
    const data = Buffer.from(buf.subarray(off, off + size));
    off += size;
    expect(CH_CLOSE, 'record end');
    records.push({ key, valueName, type, data });
  }
  return { version, records };
}

export function writePreg(records: PregRecord[], version = PREG_VERSION): Buffer {
  const chunks: Buffer[] = [];
  const header = Buffer.alloc(8);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(version, 4);
  chunks.push(header);

  const ch = (code: number): Buffer => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(code, 0);
    return b;
  };
  const sz = (s: string): Buffer => Buffer.concat([Buffer.from(s, 'utf16le'), Buffer.from([0, 0])]);
  const dword = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0, 0);
    return b;
  };

  for (const r of records) {
    chunks.push(
      ch(CH_OPEN),
      sz(r.key),
      ch(CH_SEMI),
      sz(r.valueName),
      ch(CH_SEMI),
      dword(r.type),
      ch(CH_SEMI),
      dword(r.data.length),
      ch(CH_SEMI),
      r.data,
      ch(CH_CLOSE),
    );
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

export function encodeRegValue(type: number, value: unknown): Buffer {
  switch (type) {
    case REG_DWORD: {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(Number(value) >>> 0, 0);
      return b;
    }
    case REG_QWORD: {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(BigInt(value as number | string | bigint), 0);
      return b;
    }
    case REG_SZ:
    case REG_EXPAND_SZ:
      return Buffer.concat([Buffer.from(String(value), 'utf16le'), Buffer.from([0, 0])]);
    case REG_MULTI_SZ: {
      const arr = Array.isArray(value) ? value.map(String) : String(value).split('\n');
      const body = arr.map((s) => Buffer.concat([Buffer.from(s, 'utf16le'), Buffer.from([0, 0])]));
      return Buffer.concat([...body, Buffer.from([0, 0])]);
    }
    case REG_BINARY:
      return Buffer.from(String(value).replace(/[^0-9a-fA-F]/g, ''), 'hex');
    default:
      return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf16le');
  }
}

export function decodeRegValue(type: number, data: Buffer): unknown {
  switch (type) {
    case REG_DWORD:
      return data.length >= 4 ? data.readUInt32LE(0) : 0;
    case REG_QWORD:
      return data.length >= 8 ? Number(data.readBigUInt64LE(0)) : 0;
    case REG_SZ:
    case REG_EXPAND_SZ: {
      let s = data.toString('utf16le');
      const nul = s.indexOf('\0');
      if (nul >= 0) s = s.slice(0, nul);
      return s;
    }
    case REG_MULTI_SZ: {
      const s = data.toString('utf16le');
      return s.split('\0').filter((x) => x.length > 0);
    }
    default:
      return data.toString('hex');
  }
}

export const regTypeName = (type: number): string =>
  ({
    [REG_NONE]: 'REG_NONE',
    [REG_SZ]: 'REG_SZ',
    [REG_EXPAND_SZ]: 'REG_EXPAND_SZ',
    [REG_BINARY]: 'REG_BINARY',
    [REG_DWORD]: 'REG_DWORD',
    [REG_MULTI_SZ]: 'REG_MULTI_SZ',
    [REG_QWORD]: 'REG_QWORD',
  })[type] ?? `REG_${type}`;

export const regTypeCode = (name: string): number =>
  ({
    REG_NONE: REG_NONE,
    REG_SZ: REG_SZ,
    REG_EXPAND_SZ: REG_EXPAND_SZ,
    REG_BINARY: REG_BINARY,
    REG_DWORD: REG_DWORD,
    REG_MULTI_SZ: REG_MULTI_SZ,
    REG_QWORD: REG_QWORD,
  })[name.toUpperCase()] ?? REG_SZ;
