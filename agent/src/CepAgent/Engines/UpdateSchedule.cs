namespace CepAgent.Engines;

/// <summary>
/// Pure update-scheduling logic (dependency-free so it is unit-testable on any
/// host): semantic version comparison and the DST-aware daily update time with
/// jitter.
/// </summary>
public static class UpdateSchedule
{
    /// <summary>Semantic version comparison (x.y.z), tolerant of a leading 'v' and a prerelease suffix.</summary>
    public static bool IsNewer(string candidate, string current)
    {
        static (int, int, int) Parse(string v)
        {
            var core = v.TrimStart('v', 'V').Split('-', '+')[0].Split('.');
            int G(int i) => i < core.Length && int.TryParse(core[i], out var n) ? n : 0;
            return (G(0), G(1), G(2));
        }
        var (a1, a2, a3) = Parse(candidate);
        var (b1, b2, b3) = Parse(current);
        if (a1 != b1) return a1 > b1;
        if (a2 != b2) return a2 > b2;
        return a3 > b3;
    }

    public static TimeZoneInfo ResolveEasternTimeZone()
    {
        foreach (var id in new[] { "Eastern Standard Time", "America/New_York" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch (TimeZoneNotFoundException) { }
            catch (InvalidTimeZoneException) { }
        }
        return TimeZoneInfo.Utc;
    }

    /// <summary>
    /// Next daily update time at 12:00 America/New_York (+ jitterMinutes), in UTC.
    /// DST-aware via the tz database. jitterMinutes is provided by the caller so
    /// the calculation is deterministic and testable.
    /// </summary>
    public static DateTime NextUpdateUtc(DateTime nowUtc, int jitterMinutes, TimeZoneInfo? tz = null)
    {
        tz ??= ResolveEasternTimeZone();
        var nowEastern = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, tz);
        var todayNoon = new DateTime(nowEastern.Year, nowEastern.Month, nowEastern.Day, 12, 0, 0, DateTimeKind.Unspecified)
            .AddMinutes(jitterMinutes);
        var target = nowEastern <= todayNoon ? todayNoon : todayNoon.AddDays(1);
        // Convert back to UTC. If the wall-clock time is invalid/ambiguous due to a
        // DST transition, ConvertTimeToUtc handles it against the tz rules.
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(target, DateTimeKind.Unspecified), tz);
    }
}
