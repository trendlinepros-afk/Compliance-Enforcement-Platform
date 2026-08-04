using System.Globalization;
using System.Text;

namespace CepAgent.Parsers;

/// <summary>
/// gpt.ini version math + client-side extension GUID management.
///
/// The Version value packs two 16-bit counters: the USER counter in the high
/// 16 bits and the MACHINE counter in the low 16 bits. Bumping the counter is
/// what tells Windows the local GPO changed; without it, a modified
/// Registry.pol is ignored until the next unrelated bump.
///
/// For a local GPO the required client-side extensions (gPCMachineExtensionNames
/// / gPCUserExtensionNames) must list the Registry CSE tool GUID pair so that
/// Windows' Group Policy engine actually processes the Registry.pol file.
/// </summary>
public static class GptIni
{
    // Registry client-side extension + the RegistryExtension tool GUID.
    public const string RegistryCse = "{35378EAC-683F-11D2-A89A-00C04FBBCFA2}";
    public const string RegistryTool = "{D02B1F72-3407-48AE-BA88-E8213C6761F1}";
    // Security CSE + tool GUID (secedit-applied areas).
    public const string SecurityCse = "{827D319E-6EAC-11D2-A4EA-00C04F79F83A}";
    public const string SecurityTool = "{803E14A0-B4FB-11D0-A0D0-00A0C90F574B}";

    public static uint PackVersion(int userCounter, int machineCounter)
        => ((uint)(userCounter & 0xFFFF) << 16) | (uint)(machineCounter & 0xFFFF);

    public static (int User, int Machine) UnpackVersion(uint version)
        => ((int)((version >> 16) & 0xFFFF), (int)(version & 0xFFFF));

    public static uint IncrementMachine(uint version)
    {
        var (user, machine) = UnpackVersion(version);
        machine = (machine + 1) & 0xFFFF;
        return PackVersion(user, machine);
    }

    public static uint IncrementUser(uint version)
    {
        var (user, machine) = UnpackVersion(version);
        user = (user + 1) & 0xFFFF;
        return PackVersion(user, machine);
    }

    public sealed class GptModel
    {
        public uint Version { get; set; }
        public List<string> MachineExtensionNames { get; } = new();
        public List<string> UserExtensionNames { get; } = new();
        public bool HasGeneral { get; set; }
    }

    public static GptModel Parse(string? content)
    {
        var model = new GptModel();
        if (string.IsNullOrWhiteSpace(content)) return model;
        string section = "";
        foreach (var raw in content.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            if (line.StartsWith('[') && line.EndsWith(']'))
            {
                section = line[1..^1].Trim().ToLowerInvariant();
                if (section == "general") model.HasGeneral = true;
                continue;
            }
            int eq = line.IndexOf('=');
            if (eq < 0) continue;
            string key = line[..eq].Trim();
            string val = line[(eq + 1)..].Trim();
            if (section == "general")
            {
                if (key.Equals("Version", StringComparison.OrdinalIgnoreCase) && uint.TryParse(val, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v))
                    model.Version = v;
                else if (key.Equals("gPCMachineExtensionNames", StringComparison.OrdinalIgnoreCase))
                    model.MachineExtensionNames.AddRange(ParseExtensionGuids(val));
                else if (key.Equals("gPCUserExtensionNames", StringComparison.OrdinalIgnoreCase))
                    model.UserExtensionNames.AddRange(ParseExtensionGuids(val));
            }
        }
        return model;
    }

    /// <summary>Ensure the given CSE+tool GUID pair is present in the extension list.</summary>
    public static void EnsureExtension(List<string> guids, string cse, string tool)
    {
        void Add(string g)
        {
            if (!guids.Any(x => string.Equals(x, g, StringComparison.OrdinalIgnoreCase))) guids.Add(g);
        }
        Add(cse.ToUpperInvariant());
        Add(tool.ToUpperInvariant());
    }

    /// <summary>
    /// Render gPCMachineExtensionNames as Windows expects: each CSE followed by
    /// its tool GUIDs, wrapped in brackets, GUIDs sorted, ordered by CSE.
    /// e.g. [{CSE1}{TOOL1}][{CSE2}{TOOL2}]
    /// </summary>
    public static string RenderExtensionNames(IEnumerable<string> guids)
    {
        var set = new List<string>();
        foreach (var g in guids)
        {
            var up = g.ToUpperInvariant();
            if (!set.Contains(up)) set.Add(up);
        }
        if (set.Count == 0) return "";

        // Pair known CSEs with their tools; unknown GUIDs are treated as their own group.
        var groups = new List<(string Cse, List<string> Tools)>();
        void EnsureGroup(string cse, string tool)
        {
            if (!set.Contains(cse)) return;
            var grp = groups.FirstOrDefault(x => x.Cse == cse);
            if (grp.Cse == null)
            {
                grp = (cse, new List<string>());
                groups.Add(grp);
            }
            if (set.Contains(tool) && !grp.Tools.Contains(tool)) grp.Tools.Add(tool);
        }
        EnsureGroup(RegistryCse.ToUpperInvariant(), RegistryTool.ToUpperInvariant());
        EnsureGroup(SecurityCse.ToUpperInvariant(), SecurityTool.ToUpperInvariant());

        // CSEs are sorted GUID-ascending in the real format.
        groups.Sort((a, b) => string.CompareOrdinal(a.Cse, b.Cse));
        var sb = new StringBuilder();
        foreach (var (cse, tools) in groups)
        {
            sb.Append('[').Append(cse);
            foreach (var t in tools.OrderBy(x => x, StringComparer.Ordinal)) sb.Append(t);
            sb.Append(']');
        }
        return sb.ToString();
    }

    public static string Render(GptModel model)
    {
        var sb = new StringBuilder();
        sb.Append("[General]\r\n");
        sb.Append("Version=").Append(model.Version.ToString(CultureInfo.InvariantCulture)).Append("\r\n");
        var machine = RenderExtensionNames(model.MachineExtensionNames);
        if (machine.Length > 0) sb.Append("gPCMachineExtensionNames=").Append(machine).Append("\r\n");
        var user = RenderExtensionNames(model.UserExtensionNames);
        if (user.Length > 0) sb.Append("gPCUserExtensionNames=").Append(user).Append("\r\n");
        return sb.ToString();
    }

    public static IEnumerable<string> ParseExtensionGuids(string value)
    {
        // Format: [{GUID}{GUID}][{GUID}{GUID}] -> flatten to individual GUIDs.
        var guids = new List<string>();
        int i = 0;
        while (i < value.Length)
        {
            int open = value.IndexOf('{', i);
            if (open < 0) break;
            int close = value.IndexOf('}', open);
            if (close < 0) break;
            guids.Add(value.Substring(open, close - open + 1).ToUpperInvariant());
            i = close + 1;
        }
        return guids;
    }
}
