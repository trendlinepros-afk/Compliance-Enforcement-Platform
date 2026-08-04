using System.Runtime.Versioning;
using CepAgent.Logging;
using CepAgent.Parsers;
using CepAgent.Util;

namespace CepAgent.Engines;

/// <summary>
/// Reads advanced audit policy via `auditpol /get /category:* /r` and applies
/// subcategory settings via `auditpol /set`.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class AuditPolEngine
{
    private readonly RollingLog _log;
    public AuditPolEngine(RollingLog log) => _log = log;

    private static string AuditPolPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "auditpol.exe");

    public async Task<List<AuditRow>> GetAllAsync(CancellationToken ct)
    {
        var res = await ProcessRunner.RunAsync(AuditPolPath, "/get /category:* /r", ct);
        if (!res.Success)
        {
            _log.Warn($"auditpol /get failed: {res.ExitCode} {res.StdErr}");
            return new List<AuditRow>();
        }
        return AuditCsv.Parse(res.StdOut);
    }

    /// <summary>Back up current audit policy to CSV bytes (for snapshots).</summary>
    public async Task<byte[]> BackupAsync(CancellationToken ct)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"cep-auditbackup-{Guid.NewGuid():N}.csv");
        try
        {
            await ProcessRunner.RunAsync(AuditPolPath, $"/backup /file:\"{tmp}\"", ct);
            return File.Exists(tmp) ? await File.ReadAllBytesAsync(tmp, ct) : Array.Empty<byte>();
        }
        finally { TryDelete(tmp); }
    }

    public async Task<bool> RestoreAsync(byte[] csvBytes, CancellationToken ct)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"cep-auditrestore-{Guid.NewGuid():N}.csv");
        try
        {
            await File.WriteAllBytesAsync(tmp, csvBytes, ct);
            var res = await ProcessRunner.RunAsync(AuditPolPath, $"/restore /file:\"{tmp}\"", ct);
            if (res.Success) _log.Change("auditpol", "restored audit policy from snapshot");
            else _log.Warn($"auditpol /restore exited {res.ExitCode}: {res.StdErr}");
            return res.Success;
        }
        finally { TryDelete(tmp); }
    }

    /// <summary>Set a single subcategory (by GUID) to the desired success/failure bitmask.</summary>
    public async Task<bool> SetAsync(string subcategoryGuid, int value, CancellationToken ct)
    {
        string success = (value & 1) != 0 ? "enable" : "disable";
        string failure = (value & 2) != 0 ? "enable" : "disable";
        var res = await ProcessRunner.RunAsync(
            AuditPolPath,
            $"/set /subcategory:\"{subcategoryGuid}\" /success:{success} /failure:{failure}",
            ct);
        if (res.Success)
            _log.Change("auditpol", $"set {subcategoryGuid} success={success} failure={failure}");
        else
            _log.Warn($"auditpol /set {subcategoryGuid} exited {res.ExitCode}: {res.StdErr}");
        return res.Success;
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { /* ignore */ }
    }
}
