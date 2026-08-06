using System.Text.Json;
using System.Text.Json.Serialization;

namespace CepAgent.Models;

public sealed class EnrollRequest
{
    [JsonPropertyName("enrollToken")] public string EnrollToken { get; set; } = "";
    [JsonPropertyName("hostname")] public string Hostname { get; set; } = "";
    [JsonPropertyName("ipAddresses")] public List<string> IpAddresses { get; set; } = new();
    [JsonPropertyName("osName")] public string OsName { get; set; } = "";
    [JsonPropertyName("osVersion")] public string OsVersion { get; set; } = "";
    [JsonPropertyName("osBuild")] public string OsBuild { get; set; } = "";
    [JsonPropertyName("agentVersion")] public string AgentVersion { get; set; } = "";
}

public sealed class EnrollResponse
{
    [JsonPropertyName("deviceToken")] public string DeviceToken { get; set; } = "";
    [JsonPropertyName("computerId")] public string ComputerId { get; set; } = "";
    [JsonPropertyName("tenantName")] public string TenantName { get; set; } = "";
    [JsonPropertyName("heartbeatSeconds")] public int HeartbeatSeconds { get; set; } = 300;
}

public sealed class HeartbeatRequest
{
    [JsonPropertyName("hostname")] public string Hostname { get; set; } = "";
    [JsonPropertyName("ipAddresses")] public List<string> IpAddresses { get; set; } = new();
    [JsonPropertyName("osName")] public string OsName { get; set; } = "";
    [JsonPropertyName("osVersion")] public string OsVersion { get; set; } = "";
    [JsonPropertyName("osBuild")] public string OsBuild { get; set; } = "";
    [JsonPropertyName("agentVersion")] public string AgentVersion { get; set; } = "";
    [JsonPropertyName("enforcementPaused")] public bool EnforcementPaused { get; set; }
    [JsonPropertyName("policyHash")] public string PolicyHash { get; set; } = "";
    [JsonPropertyName("metrics")] public MetricsDto? Metrics { get; set; }
}

public sealed class MetricsDto
{
    [JsonPropertyName("cpuPercent")] public double CpuPercent { get; set; }
    [JsonPropertyName("cpuCores")] public int CpuCores { get; set; }
    [JsonPropertyName("memTotalBytes")] public long MemTotalBytes { get; set; }
    [JsonPropertyName("memUsedBytes")] public long MemUsedBytes { get; set; }
    [JsonPropertyName("uptimeSeconds")] public long UptimeSeconds { get; set; }
    [JsonPropertyName("disks")] public List<DiskDto> Disks { get; set; } = new();
}

public sealed class DiskDto
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("totalBytes")] public long TotalBytes { get; set; }
    [JsonPropertyName("freeBytes")] public long FreeBytes { get; set; }
}

public sealed class CommandDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("payload")] public JsonElement Payload { get; set; }
}

public sealed class HeartbeatResponse
{
    [JsonPropertyName("commands")] public List<CommandDto> Commands { get; set; } = new();
    [JsonPropertyName("policyChanged")] public bool PolicyChanged { get; set; }
    [JsonPropertyName("policyHash")] public string PolicyHash { get; set; } = "";
    [JsonPropertyName("enforcementPaused")] public bool EnforcementPaused { get; set; }
    [JsonPropertyName("heartbeatSeconds")] public int HeartbeatSeconds { get; set; } = 300;
}

public sealed class AuditResultDto
{
    [JsonPropertyName("settingKey")] public string SettingKey { get; set; } = "";
    [JsonPropertyName("currentValue")] public object? CurrentValue { get; set; }
    [JsonPropertyName("requiredValue")] public object? RequiredValue { get; set; }
    [JsonPropertyName("compliant")] public bool Compliant { get; set; }
}

public sealed class AuditBatch
{
    [JsonPropertyName("checkedAt")] public string CheckedAt { get; set; } = "";
    [JsonPropertyName("results")] public List<AuditResultDto> Results { get; set; } = new();
}

public sealed class DriftEventDto
{
    [JsonPropertyName("settingKey")] public string SettingKey { get; set; } = "";
    [JsonPropertyName("beforeValue")] public object? BeforeValue { get; set; }
    [JsonPropertyName("afterValue")] public object? AfterValue { get; set; }
    [JsonPropertyName("remediatedAt")] public string RemediatedAt { get; set; } = "";
}

public sealed class DriftBatch
{
    [JsonPropertyName("events")] public List<DriftEventDto> Events { get; set; } = new();
}

public sealed class AckRequest
{
    [JsonPropertyName("status")] public string Status { get; set; } = "acked";
    [JsonPropertyName("error")] public string Error { get; set; } = "";
}

public sealed class UpdateCheckResponse
{
    [JsonPropertyName("available")] public bool Available { get; set; }
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
    [JsonPropertyName("url")] public string Url { get; set; } = "";
    [JsonPropertyName("notes")] public string Notes { get; set; } = "";
}
