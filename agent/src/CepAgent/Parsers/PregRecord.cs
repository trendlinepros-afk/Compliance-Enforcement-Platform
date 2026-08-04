using System.Text;

namespace CepAgent.Parsers;

public enum RegType : uint
{
    None = 0,
    Sz = 1,
    ExpandSz = 2,
    Binary = 3,
    Dword = 4,
    MultiSz = 7,
    Qword = 11,
}

public sealed record PregRecord(string Key, string ValueName, uint Type, byte[] Data)
{
    public RegType RegType => (RegType)Type;

    /// <summary>Decode the raw data to a CLR value matching the registry type.</summary>
    public object Decode()
    {
        return (RegType)Type switch
        {
            RegType.Dword => Data.Length >= 4 ? BitConverter.ToUInt32(Data, 0) : 0u,
            RegType.Qword => Data.Length >= 8 ? BitConverter.ToUInt64(Data, 0) : 0ul,
            RegType.Sz or RegType.ExpandSz => DecodeSz(Data),
            RegType.MultiSz => DecodeMultiSz(Data),
            _ => Convert.ToHexString(Data),
        };
    }

    private static string DecodeSz(byte[] data)
    {
        string s = Encoding.Unicode.GetString(data);
        int nul = s.IndexOf('\0');
        return nul >= 0 ? s[..nul] : s;
    }

    private static string[] DecodeMultiSz(byte[] data)
    {
        string s = Encoding.Unicode.GetString(data);
        return s.Split('\0', StringSplitOptions.RemoveEmptyEntries);
    }

    public static byte[] EncodeValue(RegType type, object value)
    {
        switch (type)
        {
            case RegType.Dword:
                return BitConverter.GetBytes(Convert.ToUInt32(ToScalar(value)));
            case RegType.Qword:
                return BitConverter.GetBytes(Convert.ToUInt64(ToScalar(value)));
            case RegType.Sz:
            case RegType.ExpandSz:
            {
                var bytes = Encoding.Unicode.GetBytes(value?.ToString() ?? string.Empty);
                return Append(bytes, new byte[] { 0, 0 });
            }
            case RegType.MultiSz:
            {
                var items = value as IEnumerable<string> ?? (value?.ToString() ?? string.Empty).Split('\n');
                using var ms = new MemoryStream();
                foreach (var item in items)
                {
                    ms.Write(Encoding.Unicode.GetBytes(item));
                    ms.Write(new byte[] { 0, 0 });
                }
                ms.Write(new byte[] { 0, 0 });
                return ms.ToArray();
            }
            case RegType.Binary:
                return Convert.FromHexString((value?.ToString() ?? string.Empty).Replace(" ", "").Replace(",", ""));
            default:
                return value as byte[] ?? Encoding.Unicode.GetBytes(value?.ToString() ?? string.Empty);
        }
    }

    private static object ToScalar(object value)
    {
        // JSON numbers arrive as long/double/JsonElement; normalize to a numeric string.
        if (value is System.Text.Json.JsonElement je)
        {
            return je.ValueKind switch
            {
                System.Text.Json.JsonValueKind.Number => je.GetInt64(),
                System.Text.Json.JsonValueKind.String => long.TryParse(je.GetString(), out var n) ? n : 0,
                _ => 0L,
            };
        }
        return value;
    }

    private static byte[] Append(byte[] a, byte[] b)
    {
        var r = new byte[a.Length + b.Length];
        Array.Copy(a, r, a.Length);
        Array.Copy(b, 0, r, a.Length, b.Length);
        return r;
    }

    public static RegType ParseTypeName(string name) => name.ToUpperInvariant() switch
    {
        "REG_SZ" => RegType.Sz,
        "REG_EXPAND_SZ" => RegType.ExpandSz,
        "REG_BINARY" => RegType.Binary,
        "REG_DWORD" => RegType.Dword,
        "REG_MULTI_SZ" => RegType.MultiSz,
        "REG_QWORD" => RegType.Qword,
        _ => RegType.Sz,
    };
}
