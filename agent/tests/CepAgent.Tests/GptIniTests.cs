using CepAgent.Parsers;
using Xunit;

namespace CepAgent.Tests;

public class GptIniTests
{
    [Fact]
    public void Packs_user_high_machine_low()
    {
        // user=2 machine=5 -> 0x00020005 = 131077
        Assert.Equal(131077u, GptIni.PackVersion(2, 5));
        var (user, machine) = GptIni.UnpackVersion(131077u);
        Assert.Equal(2, user);
        Assert.Equal(5, machine);
    }

    [Fact]
    public void Increment_machine_touches_only_low_word()
    {
        uint v = GptIni.PackVersion(3, 9);
        uint next = GptIni.IncrementMachine(v);
        var (user, machine) = GptIni.UnpackVersion(next);
        Assert.Equal(3, user);      // user counter unchanged
        Assert.Equal(10, machine);  // machine incremented
    }

    [Fact]
    public void Increment_user_touches_only_high_word()
    {
        uint v = GptIni.PackVersion(3, 9);
        var (user, machine) = GptIni.UnpackVersion(GptIni.IncrementUser(v));
        Assert.Equal(4, user);
        Assert.Equal(9, machine);
    }

    [Fact]
    public void Machine_counter_wraps_at_16_bits_without_touching_user()
    {
        uint v = GptIni.PackVersion(1, 0xFFFF);
        var (user, machine) = GptIni.UnpackVersion(GptIni.IncrementMachine(v));
        Assert.Equal(1, user);   // no carry into the user counter
        Assert.Equal(0, machine);
    }

    [Fact]
    public void Parses_version_and_extension_guids()
    {
        var content = "[General]\r\nVersion=65537\r\n" +
                      $"gPCMachineExtensionNames=[{GptIni.RegistryCse}{GptIni.RegistryTool}]\r\n";
        var model = GptIni.Parse(content);
        Assert.Equal(65537u, model.Version);
        Assert.Contains(GptIni.RegistryCse.ToUpperInvariant(), model.MachineExtensionNames);
        Assert.Contains(GptIni.RegistryTool.ToUpperInvariant(), model.MachineExtensionNames);
    }

    [Fact]
    public void EnsureExtension_is_idempotent()
    {
        var guids = new List<string>();
        GptIni.EnsureExtension(guids, GptIni.RegistryCse, GptIni.RegistryTool);
        GptIni.EnsureExtension(guids, GptIni.RegistryCse, GptIni.RegistryTool);
        Assert.Equal(2, guids.Count); // CSE + tool, not duplicated
    }

    [Fact]
    public void Renders_extension_names_grouped_by_cse()
    {
        var guids = new List<string>();
        GptIni.EnsureExtension(guids, GptIni.RegistryCse, GptIni.RegistryTool);
        GptIni.EnsureExtension(guids, GptIni.SecurityCse, GptIni.SecurityTool);
        var rendered = GptIni.RenderExtensionNames(guids);
        // Each CSE is bracketed with its tool GUID; both groups present.
        Assert.Contains($"[{GptIni.RegistryCse.ToUpperInvariant()}{GptIni.RegistryTool.ToUpperInvariant()}]", rendered);
        Assert.Contains($"[{GptIni.SecurityCse.ToUpperInvariant()}{GptIni.SecurityTool.ToUpperInvariant()}]", rendered);
        // Round-trips back to the same GUID set.
        var reparsed = GptIni.ParseExtensionGuids(rendered).ToList();
        Assert.Contains(GptIni.RegistryCse.ToUpperInvariant(), reparsed);
        Assert.Contains(GptIni.SecurityTool.ToUpperInvariant(), reparsed);
    }

    [Fact]
    public void Render_full_gpt_ini_has_general_and_version()
    {
        var model = new GptIni.GptModel { Version = GptIni.PackVersion(0, 3) };
        GptIni.EnsureExtension(model.MachineExtensionNames, GptIni.RegistryCse, GptIni.RegistryTool);
        var text = GptIni.Render(model);
        Assert.Contains("[General]", text);
        Assert.Contains("Version=3", text);
        Assert.Contains("gPCMachineExtensionNames=", text);
    }
}
