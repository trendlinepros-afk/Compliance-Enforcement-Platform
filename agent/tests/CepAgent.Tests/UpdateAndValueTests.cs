using System.Text.Json;
using CepAgent.Engines;
using Xunit;

namespace CepAgent.Tests;

public class UpdateScheduleTests
{
    [Theory]
    [InlineData("1.2.0", "1.1.0", true)]
    [InlineData("1.1.0", "1.2.0", false)]
    [InlineData("2.0.0", "1.9.9", true)]
    [InlineData("1.0.1", "1.0.0", true)]
    [InlineData("1.0.0", "1.0.0", false)]
    [InlineData("v1.3.0", "1.2.0", true)]
    [InlineData("1.2.0-rc1", "1.1.0", true)]
    [InlineData("1.2.0", "1.2.0-rc1", false)] // 1.2.0 core == 1.2.0 core -> not strictly newer
    public void IsNewer_compares_semver(string candidate, string current, bool expected)
    {
        Assert.Equal(expected, UpdateSchedule.IsNewer(candidate, current));
    }

    [Fact]
    public void NextUpdate_is_noon_eastern_in_utc()
    {
        var tz = UpdateSchedule.ResolveEasternTimeZone();
        // Pick a winter date (EST = UTC-5). 09:00 UTC on 2026-01-15 is 04:00 ET, before noon.
        var nowUtc = new DateTime(2026, 1, 15, 9, 0, 0, DateTimeKind.Utc);
        var next = UpdateSchedule.NextUpdateUtc(nowUtc, jitterMinutes: 0, tz);
        var nextEastern = TimeZoneInfo.ConvertTimeFromUtc(next, tz);
        Assert.Equal(12, nextEastern.Hour);
        Assert.Equal(15, nextEastern.Day); // same day, since 04:00 < 12:00
    }

    [Fact]
    public void NextUpdate_rolls_to_tomorrow_after_noon()
    {
        var tz = UpdateSchedule.ResolveEasternTimeZone();
        // 20:00 UTC on 2026-01-15 is 15:00 ET, after noon -> next is the 16th.
        var nowUtc = new DateTime(2026, 1, 15, 20, 0, 0, DateTimeKind.Utc);
        var next = UpdateSchedule.NextUpdateUtc(nowUtc, jitterMinutes: 0, tz);
        var nextEastern = TimeZoneInfo.ConvertTimeFromUtc(next, tz);
        Assert.Equal(16, nextEastern.Day);
        Assert.Equal(12, nextEastern.Hour);
    }

    [Fact]
    public void NextUpdate_applies_jitter()
    {
        var tz = UpdateSchedule.ResolveEasternTimeZone();
        var nowUtc = new DateTime(2026, 6, 15, 9, 0, 0, DateTimeKind.Utc); // summer -> EDT
        var next = UpdateSchedule.NextUpdateUtc(nowUtc, jitterMinutes: 7, tz);
        var nextEastern = TimeZoneInfo.ConvertTimeFromUtc(next, tz);
        Assert.Equal(12, nextEastern.Hour);
        Assert.Equal(7, nextEastern.Minute);
    }

    [Fact]
    public void NextUpdate_is_dst_aware()
    {
        var tz = UpdateSchedule.ResolveEasternTimeZone();
        // Summer date: EDT = UTC-4, so noon ET = 16:00 UTC.
        var summer = UpdateSchedule.NextUpdateUtc(new DateTime(2026, 7, 1, 3, 0, 0, DateTimeKind.Utc), 0, tz);
        // Winter date: EST = UTC-5, so noon ET = 17:00 UTC.
        var winter = UpdateSchedule.NextUpdateUtc(new DateTime(2026, 1, 1, 3, 0, 0, DateTimeKind.Utc), 0, tz);
        // Only assert when the tz db actually provides US DST rules (CI images do).
        if (tz.Id != "UTC")
        {
            Assert.Equal(16, summer.Hour);
            Assert.Equal(17, winter.Hour);
        }
    }
}

public class ValueCompareTests
{
    private static JsonElement J(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void Dword_numeric_equality_across_types()
    {
        Assert.True(ValueCompare.ValuesEqual(J("5"), "5", "dword"));
        Assert.True(ValueCompare.ValuesEqual(J("5"), 5, "dword"));
        Assert.False(ValueCompare.ValuesEqual(J("5"), 6, "dword"));
    }

    [Fact]
    public void String_comparison_is_case_insensitive()
    {
        Assert.True(ValueCompare.ValuesEqual(J("\"Block\""), "block", "string"));
    }

    [Fact]
    public void Multi_comparison_is_order_insensitive()
    {
        var desired = J("[\"*S-1-5-32-544\",\"*S-1-5-11\"]");
        Assert.True(ValueCompare.ValuesEqual(desired, new[] { "*S-1-5-11", "*S-1-5-32-544" }, "multi"));
        Assert.False(ValueCompare.ValuesEqual(desired, new[] { "*S-1-5-11" }, "multi"));
    }

    [Fact]
    public void Empty_multi_equals_empty()
    {
        Assert.True(ValueCompare.ValuesEqual(J("[]"), Array.Empty<string>(), "multi"));
    }

    [Fact]
    public void Normalize_handles_bool_and_null()
    {
        Assert.Equal("1", ValueCompare.Normalize(J("true")));
        Assert.Equal("0", ValueCompare.Normalize(J("false")));
        Assert.Equal("", ValueCompare.Normalize(J("null")));
    }

    [Fact]
    public void ToStringArray_from_json_array()
    {
        Assert.Equal(new[] { "a", "b" }, ValueCompare.ToStringArray(J("[\"a\",\"b\"]")));
    }
}
