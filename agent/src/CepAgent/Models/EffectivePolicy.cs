using System.Text.Json;
using System.Text.Json.Serialization;

namespace CepAgent.Models;

public sealed class RegistryTarget
{
    [JsonPropertyName("hive")] public string Hive { get; set; } = "HKLM";
    [JsonPropertyName("key")] public string Key { get; set; } = "";
    [JsonPropertyName("valueName")] public string ValueName { get; set; } = "";
    [JsonPropertyName("valueType")] public string ValueType { get; set; } = "REG_DWORD";
}

public sealed class SecEditTarget
{
    [JsonPropertyName("area")] public string Area { get; set; } = "";
    [JsonPropertyName("key")] public string Key { get; set; } = "";
}

public sealed class AuditTarget
{
    [JsonPropertyName("subcategory")] public string Subcategory { get; set; } = "";
    [JsonPropertyName("guid")] public string Guid { get; set; } = "";
}

public sealed class EffectivePolicyEntry
{
    [JsonPropertyName("settingKey")] public string SettingKey { get; set; } = "";
    [JsonPropertyName("settingName")] public string SettingName { get; set; } = "";
    [JsonPropertyName("mechanism")] public string Mechanism { get; set; } = "";
    [JsonPropertyName("scope")] public string Scope { get; set; } = "MACHINE";
    [JsonPropertyName("dataType")] public string DataType { get; set; } = "dword";
    [JsonPropertyName("desiredValue")] public JsonElement DesiredValue { get; set; }
    [JsonPropertyName("minBuild")] public int? MinBuild { get; set; }
    [JsonPropertyName("registry")] public RegistryTarget? Registry { get; set; }
    [JsonPropertyName("secedit")] public SecEditTarget? SecEdit { get; set; }
    [JsonPropertyName("audit")] public AuditTarget? Audit { get; set; }
}

public sealed class EffectivePolicyDocument
{
    [JsonPropertyName("policyHash")] public string PolicyHash { get; set; } = "";
    [JsonPropertyName("generatedAt")] public string GeneratedAt { get; set; } = "";
    [JsonPropertyName("entries")] public List<EffectivePolicyEntry> Entries { get; set; } = new();
}
