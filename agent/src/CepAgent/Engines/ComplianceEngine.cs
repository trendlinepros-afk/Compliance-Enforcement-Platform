using System.Runtime.Versioning;
using System.Text.Json;
using CepAgent.Api;
using CepAgent.Logging;
using CepAgent.Models;
using CepAgent.Parsers;
using CepAgent.State;
using CepAgent.Util;

namespace CepAgent.Engines;

/// <summary>
/// The audit + continuous-enforcement engine. Reads real current state from
/// Registry.pol, secedit export, auditpol CSV, and live registry values;
/// compares against the effective policy; remediates drift; uploads results.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class ComplianceEngine
{
    private readonly RollingLog _log;
    private readonly PortalClient _portal;
    private readonly RegistryPolEngine _registry;
    private readonly SecEditEngine _secedit;
    private readonly AuditPolEngine _auditpol;
    private readonly OfflineQueue _auditQueue;
    private readonly OfflineQueue _driftQueue;

    public ComplianceEngine(
        RollingLog log,
        PortalClient portal,
        RegistryPolEngine registry,
        SecEditEngine secedit,
        AuditPolEngine auditpol,
        OfflineQueue auditQueue,
        OfflineQueue driftQueue)
    {
        _log = log;
        _portal = portal;
        _registry = registry;
        _secedit = secedit;
        _auditpol = auditpol;
        _auditQueue = auditQueue;
        _driftQueue = driftQueue;
    }

    public sealed record AuditFinding(EffectivePolicyEntry Entry, object? Current, bool Compliant);

    /// <summary>
    /// Run a full audit against the effective policy. Reads all three sources once,
    /// then evaluates each setting. Returns per-setting findings.
    /// </summary>
    public async Task<List<AuditFinding>> AuditAsync(EffectivePolicyDocument policy, CancellationToken ct)
    {
        int build = SystemInfo.BuildNumber();
        var findings = new List<AuditFinding>();

        // Read current state from each source once.
        var machinePol = IndexPreg(_registry.ReadMachinePol());
        var userPol = IndexPreg(_registry.ReadUserPol());
        var sec = await _secedit.ExportAsync(ct);
        var auditRows = (await _auditpol.GetAllAsync(ct)).ToDictionary(r => r.Guid.ToUpperInvariant(), r => r.Value);

        foreach (var entry in policy.Entries)
        {
            // Applicability: skip settings whose minBuild exceeds this OS.
            if (entry.MinBuild.HasValue && build < entry.MinBuild.Value) continue;

            object? current = entry.Mechanism switch
            {
                "REGISTRY_POL" => ReadRegistryCurrent(entry, machinePol, userPol),
                "SECEDIT" => ReadSecEditCurrent(entry, sec),
                "AUDITPOL" => auditRows.TryGetValue((entry.Audit?.Guid ?? "").ToUpperInvariant(), out var v) ? v : (object?)null,
                _ => null,
            };
            bool compliant = current != null && ValueCompare.ValuesEqual(entry.DesiredValue, current, entry.DataType);
            findings.Add(new AuditFinding(entry, current, compliant));
        }
        return findings;
    }

    /// <summary>Upload audit findings (queueing locally if offline).</summary>
    public async Task UploadAuditAsync(List<AuditFinding> findings, CancellationToken ct)
    {
        var batch = new AuditBatch
        {
            CheckedAt = DateTime.UtcNow.ToString("o"),
            Results = findings.Select(f => new AuditResultDto
            {
                SettingKey = f.Entry.SettingKey,
                CurrentValue = f.Current?.ToString(),
                RequiredValue = ValueCompare.Normalize(f.Entry.DesiredValue),
                Compliant = f.Compliant,
            }).ToList(),
        };
        bool ok;
        try { ok = await _portal.UploadAuditAsync(batch, ct); }
        catch { ok = false; }
        if (!ok)
        {
            _auditQueue.Enqueue(batch);
            _log.Warn($"audit upload failed; queued {batch.Results.Count} results offline");
        }
    }

    /// <summary>
    /// Enforce: remediate every non-compliant setting, grouped by mechanism, then
    /// gpupdate /force. Logs a drift event per remediated setting. Respects pause
    /// (caller must not call this when paused).
    /// </summary>
    public async Task<int> EnforceAsync(EffectivePolicyDocument policy, List<AuditFinding> findings, CancellationToken ct)
    {
        var drifted = findings.Where(f => !f.Compliant).ToList();
        if (drifted.Count == 0) return 0;

        var driftEvents = new List<DriftEventDto>();
        var now = DateTime.UtcNow.ToString("o");

        // --- Registry.pol (admin templates) ---
        var machineReg = new List<DesiredRegValue>();
        var userReg = new List<DesiredRegValue>();
        foreach (var f in drifted.Where(x => x.Entry.Mechanism == "REGISTRY_POL" && x.Entry.Registry != null))
        {
            var r = f.Entry.Registry!;
            var type = PregRecord.ParseTypeName(r.ValueType);
            object value = MaterializeValue(f.Entry);
            var target = new DesiredRegValue(r.Hive, r.Key, r.ValueName, type, value);
            if (r.Hive.Equals("HKCU", StringComparison.OrdinalIgnoreCase)) userReg.Add(target);
            else machineReg.Add(target);
            driftEvents.Add(Drift(f, now));
        }
        if (machineReg.Count > 0) _registry.ApplyToPol(machine: true, machineReg);
        if (userReg.Count > 0) _registry.ApplyToPol(machine: false, userReg);
        // Also write the live registry value directly so tattooed values are corrected immediately.
        foreach (var t in machineReg.Concat(userReg)) WriteLiveRegistry(t);

        // --- SecEdit (System Access, Privilege Rights, Registry Values, Event Audit) ---
        var secBuilder = new SecEditInf.Builder();
        bool anySec = false;
        foreach (var f in drifted.Where(x => x.Entry.Mechanism == "SECEDIT" && x.Entry.SecEdit != null))
        {
            AddSecEdit(secBuilder, f.Entry);
            driftEvents.Add(Drift(f, now));
            anySec = true;
        }
        if (anySec)
        {
            await _secedit.ConfigureAsync(secBuilder, ct);
            _registry.BumpGpt(machine: true, hasSecurity: true);
        }

        // --- AuditPol ---
        foreach (var f in drifted.Where(x => x.Entry.Mechanism == "AUDITPOL" && x.Entry.Audit != null))
        {
            int value = (int)ValueCompare.ToLong(f.Entry.DesiredValue);
            await _auditpol.SetAsync(f.Entry.Audit!.Guid, value, ct);
            driftEvents.Add(Drift(f, now));
        }

        // --- Finish: gpupdate /target:computer /force ---
        await ProcessRunner.RunAsync(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "gpupdate.exe"),
            "/target:computer /force", ct, timeoutMs: 180_000);

        // Upload drift events.
        if (driftEvents.Count > 0)
        {
            var batch = new DriftBatch { Events = driftEvents };
            bool ok;
            try { ok = await _portal.UploadDriftAsync(batch, ct); }
            catch { ok = false; }
            if (!ok) _driftQueue.Enqueue(batch);
            _log.Change("enforce", $"remediated {driftEvents.Count} drifted settings");
        }
        return driftEvents.Count;
    }

    /// <summary>Flush any queued audit/drift batches after reconnect.</summary>
    public async Task FlushQueuesAsync(CancellationToken ct)
    {
        if (_auditQueue.HasItems())
        {
            var batches = _auditQueue.DrainAll<AuditBatch>();
            bool allOk = true;
            foreach (var b in batches)
            {
                try { if (!await _portal.UploadAuditAsync(b, ct)) { allOk = false; break; } }
                catch { allOk = false; break; }
            }
            if (allOk) { _auditQueue.Clear(); _log.Info($"flushed {batches.Count} queued audit batches"); }
        }
        if (_driftQueue.HasItems())
        {
            var batches = _driftQueue.DrainAll<DriftBatch>();
            bool allOk = true;
            foreach (var b in batches)
            {
                try { if (!await _portal.UploadDriftAsync(b, ct)) { allOk = false; break; } }
                catch { allOk = false; break; }
            }
            if (allOk) { _driftQueue.Clear(); _log.Info($"flushed {batches.Count} queued drift batches"); }
        }
    }

    // ---- Reads ----

    private static Dictionary<string, PregRecord> IndexPreg(List<PregRecord> records)
    {
        var d = new Dictionary<string, PregRecord>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in records) d[$"{r.Key}|{r.ValueName}"] = r;
        return d;
    }

    /// <summary>
    /// Registry setting compliance uses the LIVE registry value (catches tattooing
    /// and out-of-band edits), falling back to the Registry.pol authored value.
    /// </summary>
    private object? ReadRegistryCurrent(EffectivePolicyEntry entry, Dictionary<string, PregRecord> machinePol, Dictionary<string, PregRecord> userPol)
    {
        var r = entry.Registry!;
        var live = _registry.ReadLiveValue(r.Hive, r.Key, r.ValueName);
        if (live != null)
        {
            if (live is string[] arr) return arr;
            return live;
        }
        var pol = r.Hive.Equals("HKCU", StringComparison.OrdinalIgnoreCase) ? userPol : machinePol;
        return pol.TryGetValue($"{r.Key}|{r.ValueName}", out var rec) ? rec.Decode() : null;
    }

    private static object? ReadSecEditCurrent(EffectivePolicyEntry entry, SecEditInf sec)
    {
        var key = entry.SecEdit!.Key;
        var area = entry.SecEdit.Area;
        if (area.Equals("System Access", StringComparison.OrdinalIgnoreCase))
            return sec.SystemAccess.TryGetValue(key, out var v) ? v : null;
        if (area.Equals("Privilege Rights", StringComparison.OrdinalIgnoreCase))
            return sec.PrivilegeRights.TryGetValue(key, out var v) ? v.ToArray() : Array.Empty<string>();
        if (area.Equals("Event Audit", StringComparison.OrdinalIgnoreCase))
            return sec.EventAudit.TryGetValue(key, out var v) ? v : null;
        if (area.Equals("Registry Values", StringComparison.OrdinalIgnoreCase))
        {
            // Key may include the =type suffix stripped by the server; match on the MACHINE\ path.
            var match = sec.RegistryValues.FirstOrDefault(kv => kv.Key.Equals(key, StringComparison.OrdinalIgnoreCase));
            if (match.Key != null) return SecEditInf.DecodeRegistryValue(match.Value.Type, match.Value.Raw);
            return null;
        }
        return null;
    }

    // ---- Writes helpers ----

    private void AddSecEdit(SecEditInf.Builder builder, EffectivePolicyEntry entry)
    {
        var key = entry.SecEdit!.Key;
        var area = entry.SecEdit.Area;
        if (area.Equals("System Access", StringComparison.OrdinalIgnoreCase))
        {
            builder.SystemAccess[key] = ValueCompare.Normalize(entry.DesiredValue);
        }
        else if (area.Equals("Privilege Rights", StringComparison.OrdinalIgnoreCase))
        {
            builder.PrivilegeRights[key] = entry.DesiredValue.ValueKind == JsonValueKind.Array
                ? ValueCompare.ToStringArray(entry.DesiredValue).ToList()
                : new List<string>();
        }
        else if (area.Equals("Event Audit", StringComparison.OrdinalIgnoreCase))
        {
            builder.EventAudit[key] = (int)ValueCompare.ToLong(entry.DesiredValue);
        }
        else if (area.Equals("Registry Values", StringComparison.OrdinalIgnoreCase))
        {
            int infType = InfTypeForDataType(entry.DataType);
            string value = infType == 7
                ? string.Join(",", ValueCompare.ToStringArray(entry.DesiredValue))
                : ValueCompare.Normalize(entry.DesiredValue);
            builder.RegistryValues[key] = (infType, value);
        }
    }

    private static int InfTypeForDataType(string dataType) => dataType switch
    {
        "dword" => 4,
        "multi" => 7,
        "expand" => 2,
        "binary" => 3,
        _ => 1,
    };

    private static object MaterializeValue(EffectivePolicyEntry entry)
    {
        if (entry.DataType == "multi") return ValueCompare.ToStringArray(entry.DesiredValue);
        if (entry.DesiredValue.ValueKind == JsonValueKind.Number) return entry.DesiredValue.GetInt64();
        if (entry.DesiredValue.ValueKind == JsonValueKind.String) return entry.DesiredValue.GetString() ?? "";
        return ValueCompare.Normalize(entry.DesiredValue);
    }

    private void WriteLiveRegistry(DesiredRegValue t)
    {
        try
        {
            using var baseKey = t.Hive.Equals("HKCU", StringComparison.OrdinalIgnoreCase)
                ? Microsoft.Win32.Registry.CurrentUser
                : Microsoft.Win32.Registry.LocalMachine;
            using var key = baseKey.CreateSubKey(t.SubKey);
            var kind = t.Type switch
            {
                RegType.Dword => Microsoft.Win32.RegistryValueKind.DWord,
                RegType.Qword => Microsoft.Win32.RegistryValueKind.QWord,
                RegType.MultiSz => Microsoft.Win32.RegistryValueKind.MultiString,
                RegType.ExpandSz => Microsoft.Win32.RegistryValueKind.ExpandString,
                _ => Microsoft.Win32.RegistryValueKind.String,
            };
            object toSet = kind switch
            {
                Microsoft.Win32.RegistryValueKind.DWord => (object)(int)ValueCompare.ToLong(t.Value),
                Microsoft.Win32.RegistryValueKind.QWord => ValueCompare.ToLong(t.Value),
                Microsoft.Win32.RegistryValueKind.MultiString => t.Value as string[] ?? Array.Empty<string>(),
                _ => t.Value?.ToString() ?? "",
            };
            key?.SetValue(t.ValueName, toSet, kind);
        }
        catch (Exception ex)
        {
            _log.Warn($"live registry write {t.Hive}\\{t.SubKey}\\{t.ValueName} failed: {ex.Message}");
        }
    }

    private static DriftEventDto Drift(AuditFinding f, string now) => new()
    {
        SettingKey = f.Entry.SettingKey,
        BeforeValue = f.Current?.ToString(),
        AfterValue = ValueCompare.Normalize(f.Entry.DesiredValue),
        RemediatedAt = now,
    };
}
