using System.Text.Json;

namespace CepAgent.Engines;

/// <summary>
/// Normalizes and compares desired policy values (from JSON) against current
/// system values (from registry/secedit/auditpol reads). Numeric comparison is
/// value-based; multi-string comparison is order-insensitive; strings compare
/// case-insensitively (registry paths and SIDs are case-insensitive).
/// </summary>
public static class ValueCompare
{
    // Separator used to join multi-string values for stable comparison. U+0001
    // will not appear inside real registry multi-string data.
    private const string Sep = "";

    public static string Normalize(object? value)
    {
        if (value is null) return "";
        if (value is JsonElement je) return NormalizeJson(je);
        if (value is bool b) return b ? "1" : "0";
        if (value is string[] arr) return string.Join(Sep, arr.Select(x => x.Trim()));
        if (value is IEnumerable<string> en) return string.Join(Sep, en.Select(x => x.Trim()));
        return value.ToString()?.Trim() ?? "";
    }

    private static string NormalizeJson(JsonElement je)
    {
        switch (je.ValueKind)
        {
            case JsonValueKind.Number:
                return je.TryGetInt64(out var l) ? l.ToString() : je.GetRawText();
            case JsonValueKind.String:
                return je.GetString()?.Trim() ?? "";
            case JsonValueKind.True: return "1";
            case JsonValueKind.False: return "0";
            case JsonValueKind.Array:
                return string.Join(Sep, je.EnumerateArray().Select(e => e.ValueKind == JsonValueKind.String ? e.GetString()?.Trim() ?? "" : e.GetRawText()));
            case JsonValueKind.Null:
                return "";
            default:
                return je.GetRawText();
        }
    }

    /// <summary>Numeric-aware equality: "5" == 5, "0x5" == 5 for dwords.</summary>
    public static bool ValuesEqual(object? desired, object? current, string dataType)
    {
        if (dataType is "dword" or "qword")
        {
            if (TryNum(desired, out var a) && TryNum(current, out var b)) return a == b;
        }
        if (dataType == "multi")
        {
            var da = Normalize(desired).Split(Sep, StringSplitOptions.RemoveEmptyEntries).OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();
            var db = Normalize(current).Split(Sep, StringSplitOptions.RemoveEmptyEntries).OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();
            return da.SequenceEqual(db, StringComparer.OrdinalIgnoreCase);
        }
        return string.Equals(Normalize(desired), Normalize(current), StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryNum(object? v, out long result)
    {
        result = 0;
        var s = Normalize(v);
        if (s.Length == 0) return false;
        if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            return long.TryParse(s[2..], System.Globalization.NumberStyles.HexNumber, null, out result);
        return long.TryParse(s, out result);
    }

    public static long ToLong(object? v)
    {
        TryNum(v, out var r);
        return r;
    }

    public static string[] ToStringArray(JsonElement je)
    {
        if (je.ValueKind == JsonValueKind.Array)
            return je.EnumerateArray().Select(e => e.ValueKind == JsonValueKind.String ? e.GetString() ?? "" : e.GetRawText()).ToArray();
        if (je.ValueKind == JsonValueKind.String)
            return je.GetString()?.Split('\n', StringSplitOptions.RemoveEmptyEntries) ?? Array.Empty<string>();
        return Array.Empty<string>();
    }
}
