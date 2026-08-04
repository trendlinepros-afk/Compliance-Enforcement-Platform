using System.IO.Compression;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;
using CepAgent.Logging;
using CepAgent.Models;

namespace CepAgent.Engines;

/// <summary>
/// Captures and restores the full pre-enforcement snapshot: the GroupPolicy and
/// GroupPolicyUsers folders, a secedit export INF, an auditpol backup CSV, and
/// the live registry values for every setting the policy touches. Zipped, kept
/// locally, and uploaded to the portal.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class SnapshotManager
{
    private readonly RollingLog _log;
    private readonly SecEditEngine _secedit;
    private readonly AuditPolEngine _auditpol;
    private readonly RegistryPolEngine _registry;

    private static string GroupPolicyDir => RegistryPolEngine.GroupPolicyDir;
    private static string GroupPolicyUsersDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "GroupPolicyUsers");

    public const string SeceditEntry = "secedit-export.inf";
    public const string AuditEntry = "auditpol-backup.csv";
    public const string RegistryEntry = "live-registry.json";
    public const string ManifestEntry = "manifest.json";

    public SnapshotManager(RollingLog log, SecEditEngine secedit, AuditPolEngine auditpol, RegistryPolEngine registry)
    {
        _log = log;
        _secedit = secedit;
        _auditpol = auditpol;
        _registry = registry;
    }

    public sealed record LiveRegEntry(string Hive, string Key, string ValueName, string? ValueType, JsonElement? Value);

    /// <summary>Build the snapshot zip in memory. touched = settings the policy will modify.</summary>
    public async Task<byte[]> CaptureAsync(EffectivePolicyDocument policy, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            // 1. GroupPolicy + GroupPolicyUsers folders (verbatim files).
            AddFolder(zip, GroupPolicyDir, "GroupPolicy");
            AddFolder(zip, GroupPolicyUsersDir, "GroupPolicyUsers");

            // 2. secedit export.
            var sec = await _secedit.ExportRawAsync(ct);
            WriteEntry(zip, SeceditEntry, sec);

            // 3. auditpol backup.
            var audit = await _auditpol.BackupAsync(ct);
            WriteEntry(zip, AuditEntry, audit);

            // 4. live registry values for every touched setting.
            var live = new List<LiveRegEntry>();
            foreach (var e in policy.Entries.Where(x => x.Mechanism == "REGISTRY_POL" && x.Registry != null))
            {
                var val = _registry.ReadLiveValue(e.Registry!.Hive, e.Registry.Key, e.Registry.ValueName);
                // Store a string representation (multi-strings joined by \n) so the
                // value round-trips through restore regardless of registry type.
                string? repr = val switch
                {
                    null => null,
                    string[] arr => string.Join("\n", arr),
                    _ => val.ToString(),
                };
                JsonElement? je = repr == null ? null : JsonSerializer.SerializeToElement(repr);
                live.Add(new LiveRegEntry(e.Registry.Hive, e.Registry.Key, e.Registry.ValueName, e.Registry.ValueType, je));
            }
            WriteEntry(zip, RegistryEntry, Encoding.UTF8.GetBytes(JsonSerializer.Serialize(live)));

            // 5. manifest.
            var manifest = new
            {
                capturedAt = DateTime.UtcNow.ToString("o"),
                policyHash = policy.PolicyHash,
                agentVersion = AgentInfo.Version,
                touchedSettings = policy.Entries.Count,
            };
            WriteEntry(zip, ManifestEntry, Encoding.UTF8.GetBytes(JsonSerializer.Serialize(manifest)));
        }
        _log.Change("snapshot", $"captured pre-enforcement snapshot ({policy.Entries.Count} touched settings)");
        return ms.ToArray();
    }

    /// <summary>Persist a local copy of the snapshot.</summary>
    public string SaveLocal(byte[] zip)
    {
        AgentPaths.EnsureDirectories();
        var path = Path.Combine(AgentPaths.SnapshotsDir, $"snapshot-{DateTime.UtcNow:yyyyMMddHHmmss}.zip");
        File.WriteAllBytes(path, zip);
        return path;
    }

    public bool HasLocalSnapshot() =>
        Directory.Exists(AgentPaths.SnapshotsDir) && Directory.EnumerateFiles(AgentPaths.SnapshotsDir, "*.zip").Any();

    public string? LatestLocalSnapshot()
    {
        if (!Directory.Exists(AgentPaths.SnapshotsDir)) return null;
        return Directory.EnumerateFiles(AgentPaths.SnapshotsDir, "*.zip")
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
    }

    /// <summary>
    /// Restore a snapshot exactly: replace the GroupPolicy folders, secedit
    /// /configure from the saved INF, auditpol /restore, and re-write the live
    /// registry values. Then gpupdate /force is run by the caller.
    /// </summary>
    public async Task RestoreAsync(byte[] zipBytes, CancellationToken ct)
    {
        using var ms = new MemoryStream(zipBytes);
        using var zip = new ZipArchive(ms, ZipArchiveMode.Read);

        // 1. Restore folders (delete current, extract snapshot copies).
        ReplaceFolderFromZip(zip, "GroupPolicy", GroupPolicyDir);
        ReplaceFolderFromZip(zip, "GroupPolicyUsers", GroupPolicyUsersDir);
        _log.Change("rollback", "restored GroupPolicy + GroupPolicyUsers folders");

        // 2. secedit restore.
        var secEntry = zip.GetEntry(SeceditEntry);
        if (secEntry != null)
        {
            using var s = secEntry.Open();
            using var buf = new MemoryStream();
            await s.CopyToAsync(buf, ct);
            if (buf.Length > 0) await _secedit.RestoreFromInfAsync(buf.ToArray(), ct);
        }

        // 3. auditpol restore.
        var auditEntry = zip.GetEntry(AuditEntry);
        if (auditEntry != null)
        {
            using var s = auditEntry.Open();
            using var buf = new MemoryStream();
            await s.CopyToAsync(buf, ct);
            if (buf.Length > 0) await _auditpol.RestoreAsync(buf.ToArray(), ct);
        }

        // 4. live registry values.
        var regEntry = zip.GetEntry(RegistryEntry);
        if (regEntry != null)
        {
            using var s = regEntry.Open();
            using var reader = new StreamReader(s);
            var json = await reader.ReadToEndAsync(ct);
            var live = JsonSerializer.Deserialize<List<LiveRegEntry>>(json) ?? new();
            RestoreLiveRegistry(live);
        }
        _log.Change("rollback", "restored secedit, auditpol, and live registry values from snapshot");
    }

    private void RestoreLiveRegistry(List<LiveRegEntry> live)
    {
        foreach (var e in live)
        {
            try
            {
                using var baseKey = e.Hive.Equals("HKCU", StringComparison.OrdinalIgnoreCase)
                    ? Microsoft.Win32.Registry.CurrentUser
                    : Microsoft.Win32.Registry.LocalMachine;
                if (e.Value == null)
                {
                    // Value did not exist pre-enforcement; delete it.
                    using var key = baseKey.OpenSubKey(e.Key, writable: true);
                    key?.DeleteValue(e.ValueName, throwOnMissingValue: false);
                }
                else
                {
                    using var key = baseKey.CreateSubKey(e.Key);
                    var kind = (e.ValueType ?? "REG_SZ").ToUpperInvariant() switch
                    {
                        "REG_DWORD" => Microsoft.Win32.RegistryValueKind.DWord,
                        "REG_QWORD" => Microsoft.Win32.RegistryValueKind.QWord,
                        "REG_MULTI_SZ" => Microsoft.Win32.RegistryValueKind.MultiString,
                        "REG_EXPAND_SZ" => Microsoft.Win32.RegistryValueKind.ExpandString,
                        _ => Microsoft.Win32.RegistryValueKind.String,
                    };
                    var raw = e.Value.Value.GetString() ?? "";
                    object toSet = kind switch
                    {
                        Microsoft.Win32.RegistryValueKind.DWord => (object)(int.TryParse(raw, out var d) ? d : 0),
                        Microsoft.Win32.RegistryValueKind.QWord => long.TryParse(raw, out var q) ? q : 0L,
                        Microsoft.Win32.RegistryValueKind.MultiString => raw.Split('\n'),
                        _ => raw,
                    };
                    key?.SetValue(e.ValueName, toSet, kind);
                }
            }
            catch (Exception ex)
            {
                _log.Warn($"rollback: failed to restore {e.Hive}\\{e.Key}\\{e.ValueName}: {ex.Message}");
            }
        }
    }

    private static void AddFolder(ZipArchive zip, string folder, string prefix)
    {
        if (!Directory.Exists(folder)) return;
        foreach (var file in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(folder, file).Replace('\\', '/');
            var entry = zip.CreateEntry($"{prefix}/{rel}", CompressionLevel.Optimal);
            using var es = entry.Open();
            using var fs = File.OpenRead(file);
            fs.CopyTo(es);
        }
    }

    private static void WriteEntry(ZipArchive zip, string name, byte[] data)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        using var es = entry.Open();
        es.Write(data);
    }

    private void ReplaceFolderFromZip(ZipArchive zip, string prefix, string targetDir)
    {
        var entries = zip.Entries.Where(e => e.FullName.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase) && e.Length >= 0 && !e.FullName.EndsWith("/")).ToList();
        // Wipe managed policy content then re-extract snapshot state.
        try
        {
            if (Directory.Exists(targetDir)) Directory.Delete(targetDir, recursive: true);
        }
        catch (Exception ex)
        {
            _log.Warn($"rollback: could not clear {targetDir}: {ex.Message}");
        }
        Directory.CreateDirectory(targetDir);
        foreach (var entry in entries)
        {
            var rel = entry.FullName[(prefix.Length + 1)..].Replace('/', Path.DirectorySeparatorChar);
            var dest = Path.Combine(targetDir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            entry.ExtractToFile(dest, overwrite: true);
        }
    }
}
