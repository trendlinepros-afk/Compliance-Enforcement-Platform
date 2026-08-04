using System.Text.Json;

namespace CepAgent.State;

/// <summary>Durable local state (survives restarts) under ProgramData.</summary>
public sealed class AgentState
{
    public string PolicyHash { get; set; } = "";
    public bool FirstEnforcementDone { get; set; }
    public bool EnforcementPaused { get; set; }
    public string LastSnapshotId { get; set; } = "";
    public DateTime? LastAuditUtc { get; set; }
    public DateTime? LastUpdateCheckUtc { get; set; }

    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static AgentState Load()
    {
        try
        {
            if (File.Exists(AgentPaths.StateFile))
                return JsonSerializer.Deserialize<AgentState>(File.ReadAllText(AgentPaths.StateFile)) ?? new AgentState();
        }
        catch { /* corrupt -> fresh */ }
        return new AgentState();
    }

    public void Save()
    {
        AgentPaths.EnsureDirectories();
        File.WriteAllText(AgentPaths.StateFile, JsonSerializer.Serialize(this, Options));
    }
}
