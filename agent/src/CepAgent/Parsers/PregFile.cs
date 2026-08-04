using System.Text;

namespace CepAgent.Parsers;

/// <summary>
/// Registry.pol (PReg) reader/writer. Byte-perfect round-trip for files
/// produced by Windows' RegFile APIs.
///
/// Layout (little-endian, strings UTF-16LE):
///   magic   4 bytes  "PReg"
///   version 4 bytes  DWORD (currently 1)
///   records [key;value;type;size;data]
///     '[' ';' ']' are UTF-16LE characters (2 bytes each)
///     key, value  null-terminated UTF-16LE
///     type        DWORD
///     size        DWORD (byte length of data)
///     data        size bytes
/// </summary>
public static class PregFile
{
    private const uint Magic = 0x67655250; // "PReg" as LE uint32
    public const uint DefaultVersion = 1;

    private const ushort ChOpen = (ushort)'[';
    private const ushort ChClose = (ushort)']';
    private const ushort ChSemi = (ushort)';';

    public static (uint Version, List<PregRecord> Records) Parse(byte[] buf)
    {
        if (buf.Length < 8) throw new InvalidDataException("PReg: file too short");
        if (BitConverter.ToUInt32(buf, 0) != Magic) throw new InvalidDataException("PReg: bad magic (expected \"PReg\")");
        uint version = BitConverter.ToUInt32(buf, 4);
        var records = new List<PregRecord>();
        int off = 8;

        ushort ReadChar()
        {
            if (off + 2 > buf.Length) throw new InvalidDataException($"PReg: truncated at offset {off}");
            ushort c = BitConverter.ToUInt16(buf, off);
            off += 2;
            return c;
        }

        string ReadSz()
        {
            int start = off;
            while (true)
            {
                if (off + 2 > buf.Length) throw new InvalidDataException($"PReg: unterminated string at offset {start}");
                ushort c = BitConverter.ToUInt16(buf, off);
                off += 2;
                if (c == 0) break;
            }
            return Encoding.Unicode.GetString(buf, start, off - 2 - start);
        }

        void Expect(ushort ch, string what)
        {
            ushort c = ReadChar();
            if (c != ch) throw new InvalidDataException($"PReg: expected '{(char)ch}' ({what}) at offset {off - 2}, got 0x{c:x}");
        }

        while (off < buf.Length)
        {
            if (buf.Length - off < 2) break;
            // Tolerate trailing NUL padding.
            if (BitConverter.ToUInt16(buf, off) == 0)
            {
                off += 2;
                continue;
            }
            Expect(ChOpen, "record start");
            string key = ReadSz();
            Expect(ChSemi, "after key");
            string valueName = ReadSz();
            Expect(ChSemi, "after value name");
            if (off + 4 > buf.Length) throw new InvalidDataException("PReg: truncated type");
            uint type = BitConverter.ToUInt32(buf, off);
            off += 4;
            Expect(ChSemi, "after type");
            if (off + 4 > buf.Length) throw new InvalidDataException("PReg: truncated size");
            uint size = BitConverter.ToUInt32(buf, off);
            off += 4;
            Expect(ChSemi, "after size");
            if (off + (int)size > buf.Length) throw new InvalidDataException("PReg: truncated data");
            var data = new byte[size];
            Array.Copy(buf, off, data, 0, (int)size);
            off += (int)size;
            Expect(ChClose, "record end");
            records.Add(new PregRecord(key, valueName, type, data));
        }
        return (version, records);
    }

    public static byte[] Write(IEnumerable<PregRecord> records, uint version = DefaultVersion)
    {
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write(Magic);
        w.Write(version);

        void Ch(ushort c) => w.Write(c);
        void Sz(string s)
        {
            w.Write(Encoding.Unicode.GetBytes(s));
            w.Write((ushort)0);
        }

        foreach (var r in records)
        {
            Ch(ChOpen);
            Sz(r.Key);
            Ch(ChSemi);
            Sz(r.ValueName);
            Ch(ChSemi);
            w.Write(r.Type);
            Ch(ChSemi);
            w.Write((uint)r.Data.Length);
            Ch(ChSemi);
            w.Write(r.Data);
            Ch(ChClose);
        }
        w.Flush();
        return ms.ToArray();
    }
}
