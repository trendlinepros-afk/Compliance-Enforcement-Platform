namespace CepAgent.Util;

/// <summary>Exponential backoff with jitter, capped. Never crash-loops.</summary>
public sealed class Backoff
{
    private readonly TimeSpan _base;
    private readonly TimeSpan _max;
    private int _attempt;
    private readonly Random _rng = new();

    public Backoff(TimeSpan? baseDelay = null, TimeSpan? max = null)
    {
        _base = baseDelay ?? TimeSpan.FromSeconds(5);
        _max = max ?? TimeSpan.FromMinutes(10);
    }

    public void Reset() => _attempt = 0;

    public TimeSpan Next()
    {
        _attempt = Math.Min(_attempt + 1, 20);
        var exp = _base.TotalSeconds * Math.Pow(2, _attempt - 1);
        var capped = Math.Min(exp, _max.TotalSeconds);
        // +/- 20% jitter so a fleet does not stampede.
        var jitter = capped * (0.8 + _rng.NextDouble() * 0.4);
        return TimeSpan.FromSeconds(jitter);
    }
}
