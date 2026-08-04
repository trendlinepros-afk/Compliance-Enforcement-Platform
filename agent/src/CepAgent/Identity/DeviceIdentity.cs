using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace CepAgent.Identity;

public sealed class AgentConfig
{
    public string ServerUrl { get; set; } = "";
    public string EnrollToken { get; set; } = "";
    public string ComputerId { get; set; } = "";
    public string TenantName { get; set; } = "";
    public int HeartbeatSeconds { get; set; } = 300;
}

/// <summary>
/// Device identity: enrollment config + the DPAPI-protected device token.
/// The token is stored under ProgramData encrypted to LocalMachine scope so
/// only this machine (running as SYSTEM/service) can read it.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class DeviceIdentity
{
    public AgentConfig Config { get; private set; } = new();
    public string? DeviceToken { get; private set; }

    public bool IsEnrolled => !string.IsNullOrEmpty(DeviceToken);

    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("CepAgent.DeviceToken.v1");

    public void Load()
    {
        if (File.Exists(AgentPaths.ConfigFile))
        {
            try
            {
                var cfg = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(AgentPaths.ConfigFile));
                if (cfg != null) Config = cfg;
            }
            catch { /* corrupt config -> treat as unconfigured */ }
        }
        // MSI properties are handed to first-run via config; also read env overrides.
        var envServer = Environment.GetEnvironmentVariable("CEP_SERVERURL");
        var envToken = Environment.GetEnvironmentVariable("CEP_ENROLLTOKEN");
        if (!string.IsNullOrEmpty(envServer)) Config.ServerUrl = envServer;
        if (!string.IsNullOrEmpty(envToken)) Config.EnrollToken = envToken;

        DeviceToken = ReadDeviceToken();
    }

    public void SaveConfig()
    {
        AgentPaths.EnsureDirectories();
        File.WriteAllText(AgentPaths.ConfigFile, JsonSerializer.Serialize(Config, new JsonSerializerOptions { WriteIndented = true }));
    }

    public void StoreDeviceToken(string token, string computerId, string tenantName, int heartbeatSeconds)
    {
        AgentPaths.EnsureDirectories();
        var protectedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.LocalMachine);
        File.WriteAllBytes(AgentPaths.DeviceTokenFile, protectedBytes);
        DeviceToken = token;
        Config.ComputerId = computerId;
        Config.TenantName = tenantName;
        Config.HeartbeatSeconds = heartbeatSeconds;
        SaveConfig();
    }

    public void ClearDeviceToken()
    {
        try { if (File.Exists(AgentPaths.DeviceTokenFile)) File.Delete(AgentPaths.DeviceTokenFile); }
        catch { /* ignore */ }
        DeviceToken = null;
    }

    private static string? ReadDeviceToken()
    {
        try
        {
            if (!File.Exists(AgentPaths.DeviceTokenFile)) return null;
            var protectedBytes = File.ReadAllBytes(AgentPaths.DeviceTokenFile);
            var plain = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.LocalMachine);
            return Encoding.UTF8.GetString(plain);
        }
        catch
        {
            return null;
        }
    }
}
