namespace CepAgent;

/// <summary>
/// All agent state lives under ProgramData (never the ephemeral install dir).
/// Uninstall must remove this whole tree — see Cleanup.
/// </summary>
public static class AgentPaths
{
    public static string Root =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "CepAgent");

    public static string ConfigFile => Path.Combine(Root, "config.json");
    public static string DeviceTokenFile => Path.Combine(Root, "device.dat"); // DPAPI-protected
    public static string StateFile => Path.Combine(Root, "state.json");
    public static string PolicyCacheFile => Path.Combine(Root, "effective-policy.json");
    public static string OfflineQueueDir => Path.Combine(Root, "queue");
    public static string AuditQueueFile => Path.Combine(OfflineQueueDir, "audit.jsonl");
    public static string DriftQueueFile => Path.Combine(OfflineQueueDir, "drift.jsonl");
    public static string SnapshotsDir => Path.Combine(Root, "snapshots");
    public static string LogsDir => Path.Combine(Root, "logs");
    public static string LogFile => Path.Combine(LogsDir, "agent.log");
    public static string UpdatesDir => Path.Combine(Root, "updates");

    public const string ServiceName = "CepAgent";
    public const string UpdaterTaskName = "CepAgentUpdater";

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(OfflineQueueDir);
        Directory.CreateDirectory(SnapshotsDir);
        Directory.CreateDirectory(LogsDir);
        Directory.CreateDirectory(UpdatesDir);
    }
}
