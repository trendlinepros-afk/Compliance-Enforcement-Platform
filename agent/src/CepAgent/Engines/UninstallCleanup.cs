using System.Runtime.Versioning;
using CepAgent.Logging;
using CepAgent.Parsers;
using CepAgent.Util;

namespace CepAgent.Engines;

/// <summary>
/// Removes every artifact the agent authored. This is the single most important
/// correctness property of the product: leaving a populated Registry.pol
/// baseline behind after uninstall is the incumbent's critical bug and must
/// never happen here.
///
/// This cleans the *authored policy content*. Removal of the service, the
/// ProgramData tree, and scheduled tasks is finished by the detached helper /
/// MSI custom action (the service cannot delete its own running files).
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class UninstallCleanup
{
    private readonly RollingLog _log;
    private readonly RegistryPolEngine _registry;

    public UninstallCleanup(RollingLog log, RegistryPolEngine registry)
    {
        _log = log;
        _registry = registry;
    }

    /// <summary>
    /// Remove the Registry.pol values this agent authored for the given policy,
    /// and if that empties the file, delete it so no baseline is left behind.
    /// Then bump gpt.ini and gpupdate so the removals take effect.
    /// </summary>
    public async Task RemoveAuthoredPolicyAsync(Models.EffectivePolicyDocument? policy, CancellationToken ct)
    {
        // Targets from the last-known effective policy (registry mechanism only).
        var machineTargets = new List<(string, string)>();
        var userTargets = new List<(string, string)>();
        if (policy != null)
        {
            foreach (var e in policy.Entries.Where(x => x.Mechanism == "REGISTRY_POL" && x.Registry != null))
            {
                if (e.Registry!.Hive.Equals("HKCU", StringComparison.OrdinalIgnoreCase))
                    userTargets.Add((e.Registry.Key, e.Registry.ValueName));
                else
                    machineTargets.Add((e.Registry.Key, e.Registry.ValueName));
            }
        }

        _registry.RemoveFromPol(machine: true, machineTargets);
        _registry.RemoveFromPol(machine: false, userTargets);

        // Delete Registry.pol entirely if it is now empty (no baseline left behind).
        DeleteIfEmpty(RegistryPolEngine.MachineRegistryPol);
        DeleteIfEmpty(RegistryPolEngine.UserRegistryPol);
        _log.Change("uninstall", "removed authored Registry.pol content; deleted pol files if empty");

        await ProcessRunner.RunAsync(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "gpupdate.exe"),
            "/target:computer /force", ct, timeoutMs: 180_000);
    }

    private void DeleteIfEmpty(string polPath)
    {
        try
        {
            if (!File.Exists(polPath)) return;
            var bytes = File.ReadAllBytes(polPath);
            if (bytes.Length < 8) { File.Delete(polPath); return; }
            var records = PregFile.Parse(bytes).Records;
            if (records.Count == 0)
            {
                File.Delete(polPath);
                _log.Change("uninstall", $"deleted empty {polPath}");
            }
        }
        catch (Exception ex)
        {
            _log.Warn($"uninstall: could not evaluate {polPath}: {ex.Message}");
        }
    }

    /// <summary>Best-effort local artifact wipe the service can do while alive (queues, cache, snapshots kept for revert).</summary>
    public void WipeLocalStateExceptSnapshots()
    {
        TryDelete(AgentPaths.PolicyCacheFile);
        TryDelete(AgentPaths.AuditQueueFile);
        TryDelete(AgentPaths.DriftQueueFile);
        TryDelete(AgentPaths.StateFile);
        _log.Change("uninstall", "wiped local queues, policy cache, and state");
    }

    private void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception ex) { _log.Warn($"uninstall: could not delete {path}: {ex.Message}"); }
    }
}
