using System.Text;

namespace CepAgent.Parsers;

/// <summary>
/// auditpol /get /category:* /r  (and /backup) CSV parser.
/// Columns: Machine,Target,Subcategory,GUID,Inclusion,Exclusion,Value
/// Value bitmask: 0 none, 1 success, 2 failure, 3 both.
/// </summary>
public sealed record AuditRow(string Machine, string Target, string Subcategory, string Guid, string Inclusion, string Exclusion, int Value);

public static class AuditCsv
{
    public static int ValueFromText(string text)
    {
        var t = text.Trim().ToLowerInvariant();
        if (t.Length == 0 || t == "no auditing") return 0;
        int v = 0;
        if (t.Contains("success")) v |= 1;
        if (t.Contains("failure")) v |= 2;
        return v;
    }

    public static string ValueToText(int value) => (value & 3) switch
    {
        1 => "Success",
        2 => "Failure",
        3 => "Success and Failure",
        _ => "No Auditing",
    };

    public static List<string> SplitCsvLine(string line)
    {
        var outp = new List<string>();
        var cur = new StringBuilder();
        bool quoted = false;
        for (int i = 0; i < line.Length; i++)
        {
            char ch = line[i];
            if (quoted)
            {
                if (ch == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; }
                    else quoted = false;
                }
                else cur.Append(ch);
            }
            else if (ch == '"') quoted = true;
            else if (ch == ',') { outp.Add(cur.ToString()); cur.Clear(); }
            else cur.Append(ch);
        }
        outp.Add(cur.ToString());
        return outp;
    }

    public static string DecodeBuffer(byte[] buf)
    {
        if (buf.Length >= 2 && buf[0] == 0xff && buf[1] == 0xfe) return Encoding.Unicode.GetString(buf, 2, buf.Length - 2);
        if (buf.Length >= 3 && buf[0] == 0xef && buf[1] == 0xbb && buf[2] == 0xbf) return Encoding.UTF8.GetString(buf, 3, buf.Length - 3);
        if (Array.IndexOf(buf, (byte)0) >= 0) return Encoding.Unicode.GetString(buf);
        return Encoding.UTF8.GetString(buf);
    }

    public static List<AuditRow> Parse(string text)
    {
        if (text.Length > 0 && text[0] == '﻿') text = text[1..];
        var rows = new List<AuditRow>();
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.Trim().Length == 0) continue;
            var cols = SplitCsvLine(line).Select(c => c.Trim()).ToList();
            if (cols.Count < 4) continue;
            if (cols[0].Equals("Machine Name", StringComparison.OrdinalIgnoreCase)) continue;
            string guid = (cols.Count > 3 ? cols[3] : "").ToUpperInvariant();
            if (!System.Text.RegularExpressions.Regex.IsMatch(guid, "^\\{[0-9A-F-]{36}\\}$")) continue;
            string inclusion = cols.Count > 4 ? cols[4] : "";
            int value;
            string rawValue = cols.Count > 6 ? cols[6] : "";
            value = int.TryParse(rawValue, out var parsed) ? (parsed & 3) : ValueFromText(inclusion);
            rows.Add(new AuditRow(cols[0], cols.Count > 1 ? cols[1] : "", cols.Count > 2 ? cols[2] : "", guid, inclusion, cols.Count > 5 ? cols[5] : "", value));
        }
        return rows;
    }

    public static List<AuditRow> ParseBuffer(byte[] buf) => Parse(DecodeBuffer(buf));
}
