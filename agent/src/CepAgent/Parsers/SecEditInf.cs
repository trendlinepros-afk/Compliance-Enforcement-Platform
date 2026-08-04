using System.Globalization;
using System.Text;

namespace CepAgent.Parsers;

/// <summary>
/// Security template (secedit /export INF) parser + generator.
/// Sections: [System Access], [Privilege Rights], [Registry Values], [Event Audit].
/// </summary>
public sealed class SecEditInf
{
    public Dictionary<string, string> SystemAccess { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, List<string>> PrivilegeRights { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, (int Type, string Raw)> RegistryValues { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, int> EventAudit { get; } = new(StringComparer.OrdinalIgnoreCase);

    public static string DecodeBuffer(byte[] buf)
    {
        if (buf.Length >= 2 && buf[0] == 0xff && buf[1] == 0xfe)
            return Encoding.Unicode.GetString(buf, 2, buf.Length - 2);
        if (buf.Length >= 3 && buf[0] == 0xef && buf[1] == 0xbb && buf[2] == 0xbf)
            return Encoding.UTF8.GetString(buf, 3, buf.Length - 3);
        if (Array.IndexOf(buf, (byte)0) >= 0)
            return Encoding.Unicode.GetString(buf);
        return Encoding.UTF8.GetString(buf);
    }

    public static SecEditInf Parse(string text)
    {
        var inf = new SecEditInf();
        string section = "";
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith(';')) continue;
            if (line.StartsWith('[') && line.EndsWith(']'))
            {
                section = line[1..^1].Trim().ToLowerInvariant();
                continue;
            }
            int eq = line.IndexOf('=');
            if (eq < 0) continue;
            string key = line[..eq].Trim();
            string val = line[(eq + 1)..].Trim();
            switch (section)
            {
                case "system access":
                    inf.SystemAccess[key] = StripQuotes(val);
                    break;
                case "privilege rights":
                    inf.PrivilegeRights[key] = val.Length == 0
                        ? new List<string>()
                        : val.Split(',').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
                    break;
                case "registry values":
                {
                    int comma = val.IndexOf(',');
                    int type = int.TryParse(comma >= 0 ? val[..comma] : val, out var t) ? t : 1;
                    string raw2 = comma >= 0 ? val[(comma + 1)..] : "";
                    inf.RegistryValues[key] = (type, raw2);
                    break;
                }
                case "event audit":
                    if (int.TryParse(val, out var n)) inf.EventAudit[key] = n;
                    break;
            }
        }
        return inf;
    }

    public static SecEditInf ParseBuffer(byte[] buf) => Parse(DecodeBuffer(buf));

    private static string StripQuotes(string s)
        => s.Length >= 2 && s[0] == '"' && s[^1] == '"' ? s[1..^1] : s;

    // ---- Generation ----

    public sealed class Builder
    {
        public Dictionary<string, string> SystemAccess { get; } = new();
        public Dictionary<string, List<string>> PrivilegeRights { get; } = new();
        public Dictionary<string, (int Type, string Value)> RegistryValues { get; } = new();
        public Dictionary<string, int> EventAudit { get; } = new();

        public string RenderText()
        {
            var sb = new StringBuilder();
            sb.Append("[Unicode]\r\nUnicode=yes\r\n");
            if (SystemAccess.Count > 0)
            {
                sb.Append("[System Access]\r\n");
                foreach (var (k, v) in SystemAccess) sb.Append(k).Append(" = ").Append(FormatSystemAccess(v)).Append("\r\n");
            }
            if (PrivilegeRights.Count > 0)
            {
                sb.Append("[Privilege Rights]\r\n");
                foreach (var (k, v) in PrivilegeRights) sb.Append(k).Append(" = ").Append(string.Join(",", v)).Append("\r\n");
            }
            if (RegistryValues.Count > 0)
            {
                sb.Append("[Registry Values]\r\n");
                foreach (var (k, v) in RegistryValues) sb.Append(k).Append('=').Append(EncodeRegistryValue(v.Type, v.Value)).Append("\r\n");
            }
            if (EventAudit.Count > 0)
            {
                sb.Append("[Event Audit]\r\n");
                foreach (var (k, v) in EventAudit) sb.Append(k).Append(" = ").Append(v).Append("\r\n");
            }
            sb.Append("[Version]\r\nsignature=\"$CHICAGO$\"\r\nRevision=1\r\n");
            return sb.ToString();
        }

        /// <summary>secedit /configure requires a UTF-16LE file with BOM.</summary>
        public byte[] RenderBuffer()
        {
            var text = RenderText();
            var body = Encoding.Unicode.GetBytes(text);
            var buf = new byte[body.Length + 2];
            buf[0] = 0xff;
            buf[1] = 0xfe;
            Array.Copy(body, 0, buf, 2, body.Length);
            return buf;
        }

        private static string FormatSystemAccess(string v)
            => System.Text.RegularExpressions.Regex.IsMatch(v, "^-?\\d+$") ? v : $"\"{v}\"";
    }

    public static string EncodeRegistryValue(int type, string value) => type switch
    {
        4 => $"4,{value}",
        1 => $"1,\"{value}\"",
        2 => $"2,\"{value}\"",
        7 => $"7,{value}",
        3 => $"3,{value}",
        _ => $"{type},{value}",
    };

    public static object DecodeRegistryValue(int type, string raw)
    {
        raw = raw.Trim();
        switch (type)
        {
            case 4:
                return int.TryParse(StripQuotes(raw), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : 0;
            case 1:
            case 2:
                return StripQuotes(raw);
            case 7:
                return raw.Length == 0 ? Array.Empty<string>() : raw.Split(',').Select(s => StripQuotes(s.Trim())).Where(s => s.Length > 0).ToArray();
            default:
                return StripQuotes(raw);
        }
    }
}
