using System.Runtime.Versioning;
using CepAgent.Logging;
using CepAgent.Parsers;
using Microsoft.Win32;

namespace CepAgent.Engines;

/// <summary>
/// Reads and writes the machine/user Registry.pol via the PReg parser, keeps
/// gpt.ini's version counters and CSE GUID list correct, and reads the live
/// registry values behind administrative-template settings to detect tattooed
/// / out-of-band values.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class RegistryPolEngine
{
    private readonly RollingLog _log;

    public static string GroupPolicyDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "GroupPolicy");
    public static string MachineRegistryPol => Path.Combine(GroupPolicyDir, "Machine", "Registry.pol");
    public static string UserRegistryPol => Path.Combine(GroupPolicyDir, "User", "Registry.pol");
    public static string GptIniPath => Path.Combine(GroupPolicyDir, "gpt.ini");

    public RegistryPolEngine(RollingLog log) => _log = log;

    public List<PregRecord> ReadMachinePol() => ReadPol(MachineRegistryPol);
    public List<PregRecord> ReadUserPol() => ReadPol(UserRegistryPol);

    private static List<PregRecord> ReadPol(string path)
    {
        if (!File.Exists(path)) return new List<PregRecord>();
        var bytes = File.ReadAllBytes(path);
        if (bytes.Length < 8) return new List<PregRecord>();
        return PregFile.Parse(bytes).Records;
    }

    /// <summary>Read the live effective registry value (detects tattooing / out-of-band edits).</summary>
    public object? ReadLiveValue(string hive, string subKey, string valueName)
    {
        try
        {
            using var baseKey = hive.Equals("HKCU", StringComparison.OrdinalIgnoreCase)
                ? Registry.CurrentUser
                : Registry.LocalMachine;
            using var key = baseKey.OpenSubKey(subKey);
            return key?.GetValue(valueName);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Apply a set of desired administrative-template values to the Machine (or User)
    /// Registry.pol, then bump gpt.ini so Windows processes it. Returns true if the
    /// file changed.
    /// </summary>
    public bool ApplyToPol(bool machine, IEnumerable<DesiredRegValue> desired)
    {
        var path = machine ? MachineRegistryPol : UserRegistryPol;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var records = ReadPol(path);
        var index = records
            .Select((r, i) => (r, i))
            .ToDictionary(x => Key(x.r.Key, x.r.ValueName), x => x.i, StringComparer.OrdinalIgnoreCase);

        bool changed = false;
        foreach (var d in desired)
        {
            var data = PregRecord.EncodeValue(d.Type, d.Value);
            var rec = new PregRecord(d.SubKey, d.ValueName, (uint)d.Type, data);
            var k = Key(d.SubKey, d.ValueName);
            if (index.TryGetValue(k, out var idx))
            {
                if (!records[idx].Data.AsSpan().SequenceEqual(data) || records[idx].Type != (uint)d.Type)
                {
                    records[idx] = rec;
                    changed = true;
                }
            }
            else
            {
                records.Add(rec);
                index[k] = records.Count - 1;
                changed = true;
            }
        }

        if (changed)
        {
            File.WriteAllBytes(path, PregFile.Write(records));
            BumpGpt(machine, hasSecurity: false);
            _log.Change("registry.pol", $"wrote {(machine ? "Machine" : "User")} Registry.pol ({records.Count} records)");
        }
        return changed;
    }

    /// <summary>Remove specific values from the Registry.pol (used by uninstall/rollback of authored content).</summary>
    public bool RemoveFromPol(bool machine, IEnumerable<(string SubKey, string ValueName)> targets)
    {
        var path = machine ? MachineRegistryPol : UserRegistryPol;
        if (!File.Exists(path)) return false;
        var records = ReadPol(path);
        var kill = new HashSet<string>(targets.Select(t => Key(t.SubKey, t.ValueName)), StringComparer.OrdinalIgnoreCase);
        int before = records.Count;
        records = records.Where(r => !kill.Contains(Key(r.Key, r.ValueName))).ToList();
        if (records.Count == before) return false;
        File.WriteAllBytes(path, PregFile.Write(records));
        BumpGpt(machine, hasSecurity: false);
        return true;
    }

    /// <summary>
    /// Increment the correct gpt.ini counter and ensure the Registry (and optionally
    /// Security) CSE GUIDs are listed so Windows processes the local GPO.
    /// </summary>
    public void BumpGpt(bool machine, bool hasSecurity)
    {
        Directory.CreateDirectory(GroupPolicyDir);
        var model = GptIni.Parse(File.Exists(GptIniPath) ? File.ReadAllText(GptIniPath) : null);
        model.Version = machine ? GptIni.IncrementMachine(model.Version) : GptIni.IncrementUser(model.Version);
        GptIni.EnsureExtension(machine ? model.MachineExtensionNames : model.UserExtensionNames, GptIni.RegistryCse, GptIni.RegistryTool);
        if (hasSecurity)
            GptIni.EnsureExtension(model.MachineExtensionNames, GptIni.SecurityCse, GptIni.SecurityTool);
        File.WriteAllText(GptIniPath, GptIni.Render(model));
    }
}

public sealed record DesiredRegValue(string Hive, string SubKey, string ValueName, RegType Type, object Value);
