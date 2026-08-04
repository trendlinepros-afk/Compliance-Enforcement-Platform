using System.Text;
using CepAgent.Parsers;
using Xunit;

namespace CepAgent.Tests;

public class PregTests
{
    /// <summary>Hand-build a PReg file byte-by-byte, independent of the writer.</summary>
    private static byte[] HandBuild(params (string Key, string Value, RegType Type, byte[] Data)[] records)
    {
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write(Encoding.ASCII.GetBytes("PReg"));
        w.Write((uint)1);
        foreach (var r in records)
        {
            w.Write((ushort)'[');
            w.Write(Encoding.Unicode.GetBytes(r.Key));
            w.Write((ushort)0);
            w.Write((ushort)';');
            w.Write(Encoding.Unicode.GetBytes(r.Value));
            w.Write((ushort)0);
            w.Write((ushort)';');
            w.Write((uint)r.Type);
            w.Write((ushort)';');
            w.Write((uint)r.Data.Length);
            w.Write((ushort)';');
            w.Write(r.Data);
            w.Write((ushort)']');
        }
        w.Flush();
        return ms.ToArray();
    }

    private static byte[] Dword(uint n) => BitConverter.GetBytes(n);
    private static byte[] Sz(string s) => Encoding.Unicode.GetBytes(s + "\0");

    [Fact]
    public void Parses_hand_built_file()
    {
        var file = HandBuild(
            ("Software\\Policies\\Microsoft\\Windows\\WinRM\\Service", "AllowBasic", RegType.Dword, Dword(0)),
            ("Software\\Policies\\Microsoft\\Windows\\System", "ShellSmartScreenLevel", RegType.Sz, Sz("Block")));
        var (version, records) = PregFile.Parse(file);
        Assert.Equal(1u, version);
        Assert.Equal(2, records.Count);
        Assert.Equal("AllowBasic", records[0].ValueName);
        Assert.Equal(0u, (uint)records[0].Decode());
        Assert.Equal("Block", records[1].Decode());
    }

    [Fact]
    public void Roundtrips_byte_perfectly_write_parse()
    {
        var file = HandBuild(
            ("Software\\Policies\\A", "D1", RegType.Dword, Dword(0xDEADBEEF)),
            ("Software\\Policies\\A", "S1", RegType.Sz, Sz("héllo wörld")),
            ("Software\\Policies\\B", "M1", RegType.MultiSz, PregRecord.EncodeValue(RegType.MultiSz, new[] { "a", "b", "c" })),
            ("Software\\Policies\\B", "B1", RegType.Binary, new byte[] { 1, 2, 3, 4, 5 }),
            ("Software\\Policies\\C", "**DeleteValues", RegType.Sz, Sz("X;Y")),
            ("Software\\Policies\\C", "", RegType.Sz, Sz("")));
        var parsed = PregFile.Parse(file);
        var written = PregFile.Write(parsed.Records, parsed.Version);
        Assert.Equal(file, written);
    }

    [Fact]
    public void Roundtrips_parse_write_with_values_intact()
    {
        var records = new List<PregRecord>
        {
            new("Software\\X", "Q", (uint)RegType.Qword, PregRecord.EncodeValue(RegType.Qword, 1234567890123L)),
            new("Software\\X", "E", (uint)RegType.ExpandSz, PregRecord.EncodeValue(RegType.ExpandSz, "%SystemRoot%\\foo")),
        };
        var (_, back) = PregFile.Parse(PregFile.Write(records));
        Assert.Equal(2, back.Count);
        Assert.Equal(1234567890123UL, (ulong)back[0].Decode());
        Assert.Equal("%SystemRoot%\\foo", back[1].Decode());
    }

    [Fact]
    public void Handles_bracket_and_semicolon_in_data()
    {
        // Data containing '[', ';', ']' as UTF-16 chars must parse by size, not delimiter.
        var tricky = PregRecord.EncodeValue(RegType.Sz, "[;];[");
        var file = PregFile.Write(new[] { new PregRecord("Software\\T", "V", (uint)RegType.Sz, tricky) });
        var (_, records) = PregFile.Parse(file);
        Assert.Equal("[;];[", records[0].Decode());
    }

    [Fact]
    public void Tolerates_trailing_nul_padding()
    {
        var baseFile = PregFile.Write(new[] { new PregRecord("Software\\P", "V", (uint)RegType.Dword, Dword(1)) });
        var padded = baseFile.Concat(new byte[] { 0, 0, 0, 0 }).ToArray();
        Assert.Single(PregFile.Parse(padded).Records);
    }

    [Fact]
    public void Rejects_bad_magic_and_truncation()
    {
        Assert.Throws<InvalidDataException>(() => PregFile.Parse(Encoding.ASCII.GetBytes("NOPE1234")));
        Assert.Throws<InvalidDataException>(() => PregFile.Parse(new byte[] { 0x50 }));
        var good = PregFile.Write(new[] { new PregRecord("K", "V", (uint)RegType.Dword, Dword(1)) });
        Assert.ThrowsAny<InvalidDataException>(() => PregFile.Parse(good[..^3]));
    }

    [Fact]
    public void Empty_file_parses_to_zero_records()
    {
        Assert.Empty(PregFile.Parse(PregFile.Write(Array.Empty<PregRecord>())).Records);
    }

    [Fact]
    public void Encode_decode_all_types()
    {
        Assert.Equal(4294967295u, (uint)new PregRecord("k", "v", (uint)RegType.Dword, PregRecord.EncodeValue(RegType.Dword, 4294967295u)).Decode());
        Assert.Equal(new[] { "x", "y" }, (string[])new PregRecord("k", "v", (uint)RegType.MultiSz, PregRecord.EncodeValue(RegType.MultiSz, new[] { "x", "y" })).Decode());
        Assert.Empty((string[])new PregRecord("k", "v", (uint)RegType.MultiSz, PregRecord.EncodeValue(RegType.MultiSz, Array.Empty<string>())).Decode());
    }
}
