using System.Runtime.Versioning;
using System.Text.Json;
using CepAgent.Api;
using CepAgent.Engines;
using CepAgent.Identity;
using CepAgent.Logging;
using CepAgent.Models;
using CepAgent.State;
using CepAgent.Util;
using Microsoft.Extensions.Hosting;

namespace CepAgent;

/// <summary>
/// The Windows Service worker. Owns the timing loops (heartbeat every 5 min,
/// audit every 30 min, daily update at 12:00 ET), processes commands from
/// heartbeat responses, and coordinates enrollment / enforcement / rollback /
/// uninstall / update.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class AgentWorker : BackgroundService
{
    private readonly RollingLog _log;
    private readonly DeviceIdentity _identity;
    private readonly AgentState _state;

    private PortalClient _portal = null!;
    private RegistryPolEngine _registry = null!;
    private SecEditEngine _secedit = null!;
    private AuditPolEngine _auditpol = null!;
    private SnapshotManager _snapshots = null!;
    private ComplianceEngine _compliance = null!;
    private UninstallCleanup _cleanup = null!;
    private UpdateManager _updater = null!;

    private EffectivePolicyDocument? _policy;
    private DateTime _nextAuditUtc = DateTime.MinValue;
    private DateTime _nextUpdateUtc = DateTime.MinValue;
    private readonly Backoff _backoff = new();

    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan AuditInterval = TimeSpan.FromMinutes(30);

    public AgentWorker()
    {
        AgentPaths.EnsureDirectories();
        _log = new RollingLog(AgentPaths.LogFile);
        _identity = new DeviceIdentity();
        _state = AgentState.Load();
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        _log.Info($"CepAgent {AgentInfo.Version} starting");
        _identity.Load();

        _portal = new PortalClient(_identity, _log);
        _registry = new RegistryPolEngine(_log);
        _secedit = new SecEditEngine(_log);
        _auditpol = new AuditPolEngine(_log);
        _snapshots = new SnapshotManager(_log, _secedit, _auditpol, _registry);
        var auditQueue = new OfflineQueue(AgentPaths.AuditQueueFile);
        var driftQueue = new OfflineQueue(AgentPaths.DriftQueueFile);
        _compliance = new ComplianceEngine(_log, _portal, _registry, _secedit, _auditpol, auditQueue, driftQueue);
        _cleanup = new UninstallCleanup(_log, _registry);
        _updater = new UpdateManager(_log, _portal);

        _policy = LoadCachedPolicy();
        _nextUpdateUtc = _updater.NextUpdateUtc(DateTime.UtcNow);

        // Enroll if needed (retries with backoff inside the loop).
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!_identity.IsEnrolled)
                {
                    if (!await EnrollAsync(ct))
                    {
                        await DelayWithBackoff(ct);
                        continue;
                    }
                }

                await HeartbeatCycleAsync(ct);
                _backoff.Reset();
                await Task.Delay(HeartbeatInterval, ct);
            }
            catch (OperationCanceledException) { break; }
            catch (UnauthorizedAccessException)
            {
                // Device token revoked server-side (e.g. decommissioned). Stop cleanly.
                _log.Warn("device token rejected by server; agent will idle until reinstall");
                _identity.ClearDeviceToken();
                await Task.Delay(TimeSpan.FromMinutes(15), ct);
            }
            catch (Exception ex)
            {
                _log.Error("main loop error", ex);
                await DelayWithBackoff(ct);
            }
        }
        _log.Info("CepAgent stopping");
    }

    private async Task<bool> EnrollAsync(CancellationToken ct)
    {
        if (string.IsNullOrEmpty(_identity.Config.ServerUrl) || string.IsNullOrEmpty(_identity.Config.EnrollToken))
        {
            _log.Warn("not enrolled and no SERVERURL/ENROLLTOKEN configured; waiting");
            return false;
        }
        var (name, version, build) = SystemInfo.OsInfo();
        var res = await _portal.EnrollAsync(new EnrollRequest
        {
            EnrollToken = _identity.Config.EnrollToken,
            Hostname = SystemInfo.Hostname,
            IpAddresses = SystemInfo.IPv4Addresses(),
            OsName = name,
            OsVersion = version,
            OsBuild = build,
            AgentVersion = AgentInfo.Version,
        }, ct);
        if (res == null) return false;
        _identity.StoreDeviceToken(res.DeviceToken, res.ComputerId, res.TenantName, res.HeartbeatSeconds);
        _log.Info($"enrolled to tenant '{res.TenantName}' as computer {res.ComputerId}");
        return true;
    }

    private async Task HeartbeatCycleAsync(CancellationToken ct)
    {
        var (name, version, build) = SystemInfo.OsInfo();
        var hb = new HeartbeatRequest
        {
            Hostname = SystemInfo.Hostname,
            IpAddresses = SystemInfo.IPv4Addresses(),
            OsName = name,
            OsVersion = version,
            OsBuild = build,
            AgentVersion = AgentInfo.Version,
            EnforcementPaused = _state.EnforcementPaused,
            PolicyHash = _state.PolicyHash,
            Metrics = SafeCollectMetrics(),
        };
        var response = await _portal.HeartbeatAsync(hb, ct);
        if (response == null) return;

        _state.EnforcementPaused = response.EnforcementPaused;
        _state.Save();

        // Flush any queued audit/drift now that we are online.
        await _compliance.FlushQueuesAsync(ct);

        // Refresh policy if the server says it changed.
        if (response.PolicyChanged || _policy == null || _policy.PolicyHash != response.PolicyHash)
        {
            await RefreshPolicyAsync(ct);
        }

        // Process any commands.
        foreach (var cmd in response.Commands)
        {
            await HandleCommandAsync(cmd, ct);
        }

        // Time-based audit.
        if (DateTime.UtcNow >= _nextAuditUtc)
        {
            await RunAuditAndEnforceAsync(ct);
            _nextAuditUtc = DateTime.UtcNow + AuditInterval;
        }

        // Daily update check.
        if (DateTime.UtcNow >= _nextUpdateUtc)
        {
            try { await _updater.CheckAndUpdateAsync(ct); }
            catch (Exception ex) { _log.Error("update check failed", ex); }
            _nextUpdateUtc = _updater.NextUpdateUtc(DateTime.UtcNow);
            _state.LastUpdateCheckUtc = DateTime.UtcNow;
            _state.Save();
        }
    }

    private async Task RefreshPolicyAsync(CancellationToken ct)
    {
        var doc = await _portal.GetPolicyAsync(ct);
        if (doc == null) return;
        _policy = doc;
        _state.PolicyHash = doc.PolicyHash;
        _state.Save();
        SaveCachedPolicy(doc);
        _log.Info($"effective policy refreshed: {doc.Entries.Count} settings, hash {doc.PolicyHash[..Math.Min(12, doc.PolicyHash.Length)]}");
        // Apply immediately on change (unless paused).
        await RunAuditAndEnforceAsync(ct);
    }

    private async Task RunAuditAndEnforceAsync(CancellationToken ct)
    {
        if (_policy == null || _policy.Entries.Count == 0) return;

        var findings = await _compliance.AuditAsync(_policy, ct);
        await _compliance.UploadAuditAsync(findings, ct);
        _state.LastAuditUtc = DateTime.UtcNow;
        _state.Save();

        bool paused = _state.EnforcementPaused;
        if (paused)
        {
            _log.Info("enforcement paused; audit only, no writes");
            return;
        }

        // Snapshot BEFORE the first enforcement ever performed on this machine.
        if (!_state.FirstEnforcementDone)
        {
            await CaptureFirstSnapshotAsync(ct);
        }

        int remediated = await _compliance.EnforceAsync(_policy, findings, ct);
        if (remediated > 0)
        {
            // Re-audit after enforcement so the portal reflects the corrected state.
            var post = await _compliance.AuditAsync(_policy, ct);
            await _compliance.UploadAuditAsync(post, ct);
        }
    }

    private async Task CaptureFirstSnapshotAsync(CancellationToken ct)
    {
        try
        {
            var zip = await _snapshots.CaptureAsync(_policy!, ct);
            _snapshots.SaveLocal(zip);
            var id = await _portal.UploadSnapshotAsync(zip, "Pre-enforcement baseline", ct);
            _state.FirstEnforcementDone = true;
            if (id != null) _state.LastSnapshotId = id;
            _state.Save();
            _log.Change("snapshot", $"first-enforcement snapshot captured and uploaded ({id})");
        }
        catch (Exception ex)
        {
            // If the snapshot fails we must NOT enforce (rollback would be impossible).
            _log.Error("first snapshot failed; skipping enforcement this cycle", ex);
            throw;
        }
    }

    private async Task HandleCommandAsync(CommandDto cmd, CancellationToken ct)
    {
        _log.Info($"command received: {cmd.Type} ({cmd.Id})");
        try
        {
            switch (cmd.Type)
            {
                case "REAUDIT":
                    await RunAuditAndEnforceAsync(ct);
                    break;
                case "APPLY_POLICY":
                    await RefreshPolicyAsync(ct);
                    break;
                case "PAUSE_ENFORCEMENT":
                    _state.EnforcementPaused = true;
                    _state.Save();
                    break;
                case "RESUME_ENFORCEMENT":
                    _state.EnforcementPaused = false;
                    _state.Save();
                    await RunAuditAndEnforceAsync(ct);
                    break;
                case "UPDATE_NOW":
                    await _updater.CheckAndUpdateAsync(ct);
                    break;
                case "ROLLBACK":
                    await HandleRollbackAsync(cmd, ct);
                    break;
                case "UNINSTALL":
                    await HandleUninstallAsync(cmd, ct);
                    break;
                default:
                    _log.Warn($"unknown command type {cmd.Type}");
                    break;
            }
            await _portal.AckCommandAsync(cmd.Id, success: true, error: "", ct);
        }
        catch (Exception ex)
        {
            _log.Error($"command {cmd.Type} failed", ex);
            await _portal.AckCommandAsync(cmd.Id, success: false, error: ex.Message, ct);
        }
    }

    private async Task HandleRollbackAsync(CommandDto cmd, CancellationToken ct)
    {
        byte[]? zip = null;
        // Prefer the specific snapshot from the payload; download from portal.
        if (cmd.Payload.ValueKind == JsonValueKind.Object && cmd.Payload.TryGetProperty("snapshotId", out var sid) && sid.ValueKind == JsonValueKind.String)
        {
            zip = await _portal.DownloadSnapshotAsync(sid.GetString()!, ct);
        }
        // Fall back to the newest local snapshot.
        if (zip == null)
        {
            var local = _snapshots.LatestLocalSnapshot();
            if (local != null) zip = await File.ReadAllBytesAsync(local, ct);
        }
        if (zip == null) throw new InvalidOperationException("no snapshot available to roll back to");

        await _snapshots.RestoreAsync(zip, ct);
        await ProcessRunner.RunAsync(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "gpupdate.exe"),
            "/force", ct, timeoutMs: 180_000);

        // Auto-pause enforcement so the drift loop does not re-apply immediately.
        _state.EnforcementPaused = true;
        _state.Save();
        _log.Change("rollback", "snapshot restored; enforcement auto-paused on this machine");
    }

    private async Task HandleUninstallAsync(CommandDto cmd, CancellationToken ct)
    {
        string mode = cmd.Payload.ValueKind == JsonValueKind.Object && cmd.Payload.TryGetProperty("mode", out var m) && m.ValueKind == JsonValueKind.String
            ? m.GetString()!
            : "leave";

        if (mode == "revert")
        {
            // Restore the snapshot first.
            var local = _snapshots.LatestLocalSnapshot();
            byte[]? zip = local != null ? await File.ReadAllBytesAsync(local, ct) : (_state.LastSnapshotId.Length > 0 ? await _portal.DownloadSnapshotAsync(_state.LastSnapshotId, ct) : null);
            if (zip != null)
            {
                await _snapshots.RestoreAsync(zip, ct);
                _log.Change("uninstall", "reverted settings to snapshot before removal");
            }
            else
            {
                _log.Warn("uninstall revert requested but no snapshot found; falling back to removing authored content");
                await _cleanup.RemoveAuthoredPolicyAsync(_policy, ct);
            }
        }
        else
        {
            // Leave settings: still remove the authored Registry.pol baseline so we
            // never leave a populated baseline behind (the incumbent's critical bug).
            // The current *live* hardening stays; only OUR policy authorship is removed.
            await _cleanup.RemoveAuthoredPolicyAsync(_policy, ct);
        }

        _cleanup.WipeLocalStateExceptSnapshots();

        // Hand off to the detached helper to run msiexec /x and remove the
        // service + ProgramData + scheduled task (service cannot remove itself).
        LaunchUninstaller();
    }

    private void LaunchUninstaller()
    {
        var updaterExe = Path.Combine(AppContext.BaseDirectory, "CepAgent.Updater.exe");
        if (!File.Exists(updaterExe))
        {
            _log.Error($"uninstall: updater helper not found at {updaterExe}");
            return;
        }
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = updaterExe,
            Arguments = "uninstall",
            UseShellExecute = false,
            CreateNoWindow = true,
        });
        _log.Info("uninstall: detached uninstaller launched");
    }

    // Metrics are best-effort telemetry — never let a probe failure break the heartbeat.
    private CepAgent.Models.MetricsDto? SafeCollectMetrics()
    {
        try { return SystemMetrics.Collect(); }
        catch (Exception ex) { _log.Warn($"metrics collection failed: {ex.Message}"); return null; }
    }

    private EffectivePolicyDocument? LoadCachedPolicy()
    {
        try
        {
            if (File.Exists(AgentPaths.PolicyCacheFile))
                return JsonSerializer.Deserialize<EffectivePolicyDocument>(File.ReadAllText(AgentPaths.PolicyCacheFile), PortalClient.JsonOptions);
        }
        catch { /* ignore */ }
        return null;
    }

    private void SaveCachedPolicy(EffectivePolicyDocument doc)
    {
        try { File.WriteAllText(AgentPaths.PolicyCacheFile, JsonSerializer.Serialize(doc, PortalClient.JsonOptions)); }
        catch { /* ignore */ }
    }

    private async Task DelayWithBackoff(CancellationToken ct)
    {
        var delay = _backoff.Next();
        _log.Info($"backing off {delay.TotalSeconds:F0}s");
        await Task.Delay(delay, ct);
    }
}
