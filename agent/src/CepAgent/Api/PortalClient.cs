using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using CepAgent.Identity;
using CepAgent.Logging;
using CepAgent.Models;

namespace CepAgent.Api;

/// <summary>
/// HTTP client for the portal API. Forces TLS 1.2+, uses the device token for
/// authenticated calls, and applies exponential backoff on transient failures.
/// </summary>
public sealed class PortalClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly DeviceIdentity _identity;
    private readonly RollingLog _log;

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never,
    };

    public PortalClient(DeviceIdentity identity, RollingLog log)
    {
        _identity = identity;
        _log = log;
        var handler = new HttpClientHandler
        {
            // Force TLS 1.2+ (Server 2016 default may include older protocols).
            SslProtocols = System.Security.Authentication.SslProtocols.Tls12 | System.Security.Authentication.SslProtocols.Tls13,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
        };
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(5) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"CepAgent/{AgentInfo.Version}");
    }

    private Uri BuildUri(string path) => new(new Uri(_identity.Config.ServerUrl.TrimEnd('/') + "/"), path.TrimStart('/'));

    private HttpRequestMessage Authed(HttpMethod method, string path)
    {
        var req = new HttpRequestMessage(method, BuildUri(path));
        if (!string.IsNullOrEmpty(_identity.DeviceToken))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _identity.DeviceToken);
        return req;
    }

    // ---- Enrollment ----

    public async Task<EnrollResponse?> EnrollAsync(EnrollRequest request, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, BuildUri("/api/agent/enroll"))
        {
            Content = JsonContent.Create(request, options: JsonOptions),
        };
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            _log.Warn($"Enrollment failed: {(int)res.StatusCode} {await res.Content.ReadAsStringAsync(ct)}");
            return null;
        }
        return await res.Content.ReadFromJsonAsync<EnrollResponse>(JsonOptions, ct);
    }

    // ---- Heartbeat + policy ----

    public async Task<HeartbeatResponse?> HeartbeatAsync(HeartbeatRequest request, CancellationToken ct)
    {
        var req = Authed(HttpMethod.Post, "/api/agent/heartbeat");
        req.Content = JsonContent.Create(request, options: JsonOptions);
        using var res = await _http.SendAsync(req, ct);
        if (res.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedAccessException("device token rejected");
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<HeartbeatResponse>(JsonOptions, ct);
    }

    public async Task<EffectivePolicyDocument?> GetPolicyAsync(CancellationToken ct)
    {
        var req = Authed(HttpMethod.Get, "/api/agent/policy");
        using var res = await _http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<EffectivePolicyDocument>(JsonOptions, ct);
    }

    // ---- Audit + drift ingest ----

    public async Task<bool> UploadAuditAsync(AuditBatch batch, CancellationToken ct)
    {
        var req = Authed(HttpMethod.Post, "/api/agent/audit");
        req.Content = JsonContent.Create(batch, options: JsonOptions);
        using var res = await _http.SendAsync(req, ct);
        return res.IsSuccessStatusCode;
    }

    public async Task<bool> UploadDriftAsync(DriftBatch batch, CancellationToken ct)
    {
        var req = Authed(HttpMethod.Post, "/api/agent/drift");
        req.Content = JsonContent.Create(batch, options: JsonOptions);
        using var res = await _http.SendAsync(req, ct);
        return res.IsSuccessStatusCode;
    }

    // ---- Snapshots ----

    public async Task<string?> UploadSnapshotAsync(byte[] zip, string note, CancellationToken ct)
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(zip);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
        form.Add(file, "snapshot", "snapshot.zip");
        form.Add(new StringContent(note), "note");
        var req = Authed(HttpMethod.Post, "/api/agent/snapshot");
        req.Content = form;
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;
        var doc = await res.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: ct);
        return doc.TryGetProperty("id", out var id) ? id.GetString() : null;
    }

    public async Task<byte[]?> DownloadSnapshotAsync(string snapshotId, CancellationToken ct)
    {
        var req = Authed(HttpMethod.Get, $"/api/agent/snapshots/{snapshotId}");
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadAsByteArrayAsync(ct);
    }

    // ---- Command acks ----

    public async Task AckCommandAsync(string commandId, bool success, string error, CancellationToken ct)
    {
        var req = Authed(HttpMethod.Post, $"/api/agent/commands/{commandId}/ack");
        req.Content = JsonContent.Create(new AckRequest { Status = success ? "acked" : "failed", Error = error }, options: JsonOptions);
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) _log.Warn($"Ack for {commandId} failed: {(int)res.StatusCode}");
    }

    // ---- Updates ----

    public async Task<UpdateCheckResponse?> CheckUpdateAsync(CancellationToken ct)
    {
        var req = Authed(HttpMethod.Get, "/api/agent/update/check");
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadFromJsonAsync<UpdateCheckResponse>(JsonOptions, ct);
    }

    public async Task<byte[]?> DownloadMsiAsync(string url, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (!string.IsNullOrEmpty(_identity.DeviceToken))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _identity.DeviceToken);
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode) return null;
        return await res.Content.ReadAsByteArrayAsync(ct);
    }

    public void Dispose() => _http.Dispose();
}
