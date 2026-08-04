using System.Runtime.Versioning;
using System.Security.Cryptography;
using CepAgent.Api;
using CepAgent.Logging;
using CepAgent.Util;

namespace CepAgent.Engines;

/// <summary>
/// Auto-update: ask the portal for the latest release, compare versions,
/// download the MSI through the portal endpoint, verify SHA-256, and hand off
/// to a detached updater helper (the service cannot replace itself while
/// running). Runs daily at 12:00 America/New_York (DST-aware) with +/- 10 min
/// jitter, plus on UPDATE_NOW.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class UpdateManager
{
    private readonly RollingLog _log;
    private readonly PortalClient _portal;
    private readonly Random _rng = new();

    public UpdateManager(RollingLog log, PortalClient portal)
    {
        _log = log;
        _portal = portal;
    }

    /// <summary>Perform an update if a newer release is available. Returns true if an update was launched.</summary>
    public async Task<bool> CheckAndUpdateAsync(CancellationToken ct)
    {
        var latest = await _portal.CheckUpdateAsync(ct);
        if (latest is not { Available: true } || string.IsNullOrEmpty(latest.Version)) return false;

        if (!UpdateSchedule.IsNewer(latest.Version, AgentInfo.Version))
        {
            _log.Info($"update check: current {AgentInfo.Version} is up to date (latest {latest.Version})");
            return false;
        }

        _log.Info($"update available: {AgentInfo.Version} -> {latest.Version}, downloading");
        var msi = await _portal.DownloadMsiAsync(latest.Url, ct);
        if (msi == null || msi.Length == 0)
        {
            _log.Warn("update: MSI download failed");
            return false;
        }

        // Verify SHA-256 against the manifest before touching it.
        var actual = Convert.ToHexString(SHA256.HashData(msi)).ToLowerInvariant();
        if (!string.Equals(actual, latest.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            _log.Error($"update: SHA-256 mismatch (expected {latest.Sha256}, got {actual}) — aborting");
            return false;
        }

        AgentPaths.EnsureDirectories();
        var msiPath = Path.Combine(AgentPaths.UpdatesDir, $"cep-agent-{latest.Version}.msi");
        await File.WriteAllBytesAsync(msiPath, msi, ct);
        _log.Change("update", $"verified MSI {latest.Version} ({msi.Length} bytes, sha256 ok); handing off to updater");

        LaunchUpdater(msiPath);
        return true;
    }

    /// <summary>Launch the detached updater helper that runs msiexec /i /qn after the service exits.</summary>
    private void LaunchUpdater(string msiPath)
    {
        var updaterExe = Path.Combine(AppContext.BaseDirectory, "CepAgent.Updater.exe");
        if (!File.Exists(updaterExe))
        {
            _log.Error($"update: updater helper not found at {updaterExe}");
            return;
        }
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = updaterExe,
            Arguments = $"install \"{msiPath}\"",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        System.Diagnostics.Process.Start(psi);
        _log.Info("update: detached updater launched");
    }

    /// <summary>
    /// Next scheduled update time: today/tomorrow at 12:00 America/New_York with
    /// +/- 10 minutes jitter, converted to UTC (DST-aware). Delegates the pure
    /// math to <see cref="UpdateSchedule"/>.
    /// </summary>
    public DateTime NextUpdateUtc(DateTime nowUtc) => UpdateSchedule.NextUpdateUtc(nowUtc, _rng.Next(-10, 11));
}
