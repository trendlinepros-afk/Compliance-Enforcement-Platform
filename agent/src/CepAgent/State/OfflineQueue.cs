using System.Text;
using System.Text.Json;
using CepAgent.Api;

namespace CepAgent.State;

/// <summary>
/// Append-only JSONL queue for audit/drift batches that could not be uploaded
/// (offline). Flushed on reconnect. Bounded so a long outage cannot fill disk.
/// </summary>
public sealed class OfflineQueue
{
    private readonly string _path;
    private readonly int _maxLines;
    private readonly object _gate = new();

    public OfflineQueue(string path, int maxLines = 20_000)
    {
        _path = path;
        _maxLines = maxLines;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    }

    public void Enqueue<T>(T item)
    {
        lock (_gate)
        {
            var line = JsonSerializer.Serialize(item, PortalClient.JsonOptions);
            File.AppendAllText(_path, line + "\n", Encoding.UTF8);
            TrimIfNeeded();
        }
    }

    public List<T> DrainAll<T>()
    {
        lock (_gate)
        {
            if (!File.Exists(_path)) return new List<T>();
            var items = new List<T>();
            foreach (var line in File.ReadAllLines(_path))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var item = JsonSerializer.Deserialize<T>(line, PortalClient.JsonOptions);
                    if (item != null) items.Add(item);
                }
                catch { /* skip malformed line */ }
            }
            return items;
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            try { if (File.Exists(_path)) File.Delete(_path); } catch { /* ignore */ }
        }
    }

    public bool HasItems() => File.Exists(_path) && new FileInfo(_path).Length > 0;

    private void TrimIfNeeded()
    {
        try
        {
            var lines = File.ReadAllLines(_path);
            if (lines.Length <= _maxLines) return;
            var keep = lines.Skip(lines.Length - _maxLines).ToArray();
            File.WriteAllLines(_path, keep);
        }
        catch { /* ignore */ }
    }
}
