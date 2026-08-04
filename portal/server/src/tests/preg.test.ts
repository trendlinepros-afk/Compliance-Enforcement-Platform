import { describe, expect, it } from 'vitest';
import {
  REG_BINARY,
  REG_DWORD,
  REG_EXPAND_SZ,
  REG_MULTI_SZ,
  REG_QWORD,
  REG_SZ,
  decodeRegValue,
  encodeRegValue,
  parsePreg,
  writePreg,
  type PregRecord,
} from '../parsers/preg';

/** Hand-build a PReg file byte-by-byte (independent of the writer). */
function handBuild(records: { key: string; value: string; type: number; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [Buffer.from('PReg', 'ascii')];
  const v = Buffer.alloc(4);
  v.writeUInt32LE(1, 0);
  parts.push(v);
  const ch = (c: string) => Buffer.from(c, 'utf16le');
  for (const r of records) {
    parts.push(ch('['));
    parts.push(Buffer.from(r.key, 'utf16le'), Buffer.from([0, 0]));
    parts.push(ch(';'));
    parts.push(Buffer.from(r.value, 'utf16le'), Buffer.from([0, 0]));
    parts.push(ch(';'));
    const t = Buffer.alloc(4);
    t.writeUInt32LE(r.type, 0);
    parts.push(t, ch(';'));
    const s = Buffer.alloc(4);
    s.writeUInt32LE(r.data.length, 0);
    parts.push(s, ch(';'));
    parts.push(r.data);
    parts.push(ch(']'));
  }
  return Buffer.concat(parts);
}

const dword = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
};

describe('PReg parser/writer', () => {
  it('parses a hand-built real-world-shaped file', () => {
    const file = handBuild([
      {
        key: 'Software\\Policies\\Microsoft\\Windows\\WinRM\\Service',
        value: 'AllowBasic',
        type: REG_DWORD,
        data: dword(0),
      },
      {
        key: 'Software\\Policies\\Microsoft\\Windows\\System',
        value: 'ShellSmartScreenLevel',
        type: REG_SZ,
        data: Buffer.concat([Buffer.from('Block', 'utf16le'), Buffer.from([0, 0])]),
      },
    ]);
    const { version, records } = parsePreg(file);
    expect(version).toBe(1);
    expect(records).toHaveLength(2);
    expect(records[0].key).toBe('Software\\Policies\\Microsoft\\Windows\\WinRM\\Service');
    expect(records[0].valueName).toBe('AllowBasic');
    expect(decodeRegValue(records[0].type, records[0].data)).toBe(0);
    expect(decodeRegValue(records[1].type, records[1].data)).toBe('Block');
  });

  it('round-trips byte-perfectly: write(parse(file)) === file', () => {
    const file = handBuild([
      { key: 'Software\\Policies\\A', value: 'D1', type: REG_DWORD, data: dword(0xdeadbeef) },
      { key: 'Software\\Policies\\A', value: 'S1', type: REG_SZ, data: Buffer.concat([Buffer.from('héllo wörld', 'utf16le'), Buffer.from([0, 0])]) },
      { key: 'Software\\Policies\\B', value: 'M1', type: REG_MULTI_SZ, data: encodeRegValue(REG_MULTI_SZ, ['a', 'b', 'c']) },
      { key: 'Software\\Policies\\B', value: 'B1', type: REG_BINARY, data: Buffer.from([1, 2, 3, 4, 5]) },
      { key: 'Software\\Policies\\C', value: '**DeleteValues', type: REG_SZ, data: encodeRegValue(REG_SZ, 'X;Y') },
      { key: 'Software\\Policies\\C', value: '', type: REG_SZ, data: encodeRegValue(REG_SZ, '') },
    ]);
    const parsed = parsePreg(file);
    expect(writePreg(parsed.records, parsed.version).equals(file)).toBe(true);
  });

  it('round-trips parse(write(records)) with data intact', () => {
    const records: PregRecord[] = [
      { key: 'Software\\X', valueName: 'Q', type: REG_QWORD, data: encodeRegValue(REG_QWORD, 1234567890123) },
      { key: 'Software\\X', valueName: 'E', type: REG_EXPAND_SZ, data: encodeRegValue(REG_EXPAND_SZ, '%SystemRoot%\\foo') },
    ];
    const { records: back } = parsePreg(writePreg(records));
    expect(back).toHaveLength(2);
    expect(decodeRegValue(back[0].type, back[0].data)).toBe(1234567890123);
    expect(decodeRegValue(back[1].type, back[1].data)).toBe('%SystemRoot%\\foo');
  });

  it('handles data containing bracket/semicolon UTF-16 characters (size-driven parsing)', () => {
    const tricky = encodeRegValue(REG_SZ, '[;];[');
    const file = writePreg([{ key: 'Software\\T', valueName: 'V', type: REG_SZ, data: tricky }]);
    const { records } = parsePreg(file);
    expect(decodeRegValue(records[0].type, records[0].data)).toBe('[;];[');
  });

  it('tolerates trailing NUL padding', () => {
    const base = writePreg([{ key: 'Software\\P', valueName: 'V', type: REG_DWORD, data: dword(1) }]);
    const padded = Buffer.concat([base, Buffer.from([0, 0, 0, 0])]);
    expect(parsePreg(padded).records).toHaveLength(1);
  });

  it('rejects bad magic and truncated files', () => {
    expect(() => parsePreg(Buffer.from('NOPE1234'))).toThrow(/magic/);
    expect(() => parsePreg(Buffer.from([0x50]))).toThrow(/short/);
    const good = writePreg([{ key: 'K', valueName: 'V', type: REG_DWORD, data: dword(1) }]);
    expect(() => parsePreg(good.subarray(0, good.length - 3))).toThrow();
  });

  it('empty file (header only) parses to zero records', () => {
    expect(parsePreg(writePreg([])).records).toHaveLength(0);
  });

  it('encode/decode helpers cover all types', () => {
    expect(decodeRegValue(REG_DWORD, encodeRegValue(REG_DWORD, 4294967295))).toBe(4294967295);
    expect(decodeRegValue(REG_MULTI_SZ, encodeRegValue(REG_MULTI_SZ, ['x', 'y']))).toEqual(['x', 'y']);
    expect(decodeRegValue(REG_MULTI_SZ, encodeRegValue(REG_MULTI_SZ, []))).toEqual([]);
    expect(decodeRegValue(REG_BINARY, encodeRegValue(REG_BINARY, '0a0b0c'))).toBe('0a0b0c');
  });
});
