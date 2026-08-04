using System.Runtime.Versioning;
using CepAgent.Logging;
using CepAgent.Parsers;
using CepAgent.Util;

namespace CepAgent.Engines;

/// <summary>
/// Reads current security policy via `secedit /export` and applies desired
/// values via `secedit /configure` with a generated INF.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class SecEditEngine
{
    private readonly RollingLog _log;
    public SecEditEngine(RollingLog log) => _log = log;

    private static string SecEditPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "secedit.exe");

    /// <summary>Export current security policy to an INF and parse it.</summary>
    public async Task<SecEditInf> ExportAsync(CancellationToken ct)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"cep-secexport-{Guid.NewGuid():N}.inf");
        try
        {
            var res = await ProcessRunner.RunAsync(SecEditPath, $"/export /cfg \"{tmp}\" /quiet", ct);
            if (!res.Success || !File.Exists(tmp))
            {
                _log.Warn($"secedit /export failed: {res.ExitCode} {res.StdErr}");
                return new SecEditInf();
            }
            return SecEditInf.ParseBuffer(await File.ReadAllBytesAsync(tmp, ct));
        }
        finally
        {
            TryDelete(tmp);
        }
    }

    /// <summary>Raw export bytes (for snapshots).</summary>
    public async Task<byte[]> ExportRawAsync(CancellationToken ct)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"cep-secexport-{Guid.NewGuid():N}.inf");
        try
        {
            await ProcessRunner.RunAsync(SecEditPath, $"/export /cfg \"{tmp}\" /quiet", ct);
            return File.Exists(tmp) ? await File.ReadAllBytesAsync(tmp, ct) : Array.Empty<byte>();
        }
        finally { TryDelete(tmp); }
    }

    /// <summary>Apply an INF via secedit /configure. Returns true on success.</summary>
    public async Task<bool> ConfigureAsync(SecEditInf.Builder builder, CancellationToken ct)
    {
        var inf = Path.Combine(Path.GetTempPath(), $"cep-secapply-{Guid.NewGuid():N}.inf");
        var db = Path.Combine(Path.GetTempPath(), $"cep-secapply-{Guid.NewGuid():N}.sdb");
        var logFile = Path.Combine(Path.GetTempPath(), $"cep-secapply-{Guid.NewGuid():N}.log");
        try
        {
            await File.WriteAllBytesAsync(inf, builder.RenderBuffer(), ct);
            // /areas limits configure to the areas we manage.
            var res = await ProcessRunner.RunAsync(
                SecEditPath,
                $"/configure /db \"{db}\" /cfg \"{inf}\" /areas SECURITYPOLICY USER_RIGHTS /log \"{logFile}\" /quiet",
                ct);
            if (!res.Success)
            {
                _log.Warn($"secedit /configure exited {res.ExitCode}: {res.StdOut} {res.StdErr}");
                return false;
            }
            _log.Change("secedit", "applied security template via secedit /configure");
            return true;
        }
        finally
        {
            TryDelete(inf);
            TryDelete(db);
            TryDelete(logFile);
        }
    }

    /// <summary>Restore from a saved INF (rollback). Configures all areas from the snapshot INF.</summary>
    public async Task<bool> RestoreFromInfAsync(byte[] infBytes, CancellationToken ct)
    {
        var inf = Path.Combine(Path.GetTempPath(), $"cep-secrestore-{Guid.NewGuid():N}.inf");
        var db = Path.Combine(Path.GetTempPath(), $"cep-secrestore-{Guid.NewGuid():N}.sdb");
        try
        {
            await File.WriteAllBytesAsync(inf, infBytes, ct);
            var res = await ProcessRunner.RunAsync(SecEditPath, $"/configure /db \"{db}\" /cfg \"{inf}\" /overwrite /quiet", ct);
            if (!res.Success) _log.Warn($"secedit restore exited {res.ExitCode}: {res.StdErr}");
            else _log.Change("secedit", "restored security policy from snapshot INF");
            return res.Success;
        }
        finally
        {
            TryDelete(inf);
            TryDelete(db);
        }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { /* ignore */ }
    }
}
