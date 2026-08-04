using System.Text;

namespace CepAgent.Logging;

/// <summary>
/// Minimal rolling file logger under ProgramData with a size cap. Also mirrors
/// to the Windows event pipeline via ILogger when available. Thread-safe.
/// </summary>
public sealed class RollingLog
{
    private readonly string _path;
    private readonly long _maxBytes;
    private readonly int _keep;
    private readonly object _gate = new();

    public RollingLog(string path, long maxBytes = 5 * 1024 * 1024, int keep = 3)
    {
        _path = path;
        _maxBytes = maxBytes;
        _keep = keep;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    }

    public void Info(string message) => Write("INFO", message);
    public void Warn(string message) => Write("WARN", message);
    public void Error(string message, Exception? ex = null) => Write("ERROR", ex == null ? message : $"{message}: {ex}");

    /// <summary>Log a destructive change explicitly (enforce/rollback/uninstall).</summary>
    public void Change(string action, string detail) => Write("CHANGE", $"{action} :: {detail}");

    private void Write(string level, string message)
    {
        var line = $"{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ss.fffZ} [{level}] {message}{Environment.NewLine}";
        lock (_gate)
        {
            try
            {
                Roll();
                File.AppendAllText(_path, line, Encoding.UTF8);
            }
            catch
            {
                // Logging must never crash the service.
            }
        }
    }

    private void Roll()
    {
        try
        {
            var fi = new FileInfo(_path);
            if (!fi.Exists || fi.Length < _maxBytes) return;
            for (int i = _keep - 1; i >= 1; i--)
            {
                var src = $"{_path}.{i}";
                var dst = $"{_path}.{i + 1}";
                if (File.Exists(src)) File.Move(src, dst, overwrite: true);
            }
            File.Move(_path, $"{_path}.1", overwrite: true);
        }
        catch
        {
            // best effort
        }
    }
}
