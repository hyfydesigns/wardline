using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace WardlineAgent;

/// <summary>An event queued on-device to send to the ingest API.</summary>
public sealed class AgentEvent
{
    [JsonPropertyName("eventId")] public string EventId { get; init; } = Guid.NewGuid().ToString();
    [JsonPropertyName("occurredAt")] public string OccurredAt { get; init; } = DateTime.UtcNow.ToString("o");
    [JsonPropertyName("source")] public string Source { get; init; } = "system";
    [JsonPropertyName("kind")] public string Kind { get; init; } = "usage";
    [JsonPropertyName("text")] public string? Text { get; init; }
    [JsonPropertyName("url")] public string? Url { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("minutes")] public int? Minutes { get; init; }
}

/// <summary>
/// Posts batches of events to the cloud ingest endpoint using the device
/// token. In a full build this also owns the encrypted local queue that
/// buffers events while offline and drains on reconnect; here it posts directly.
/// </summary>
public sealed class IngestClient(IHttpClientFactory httpFactory, IOptions<AgentOptions> options, ILogger<IngestClient> logger)
{
    /// <summary>Reported to the server on every ingest so the dashboard can show
    /// something truer than the "not yet installed" placeholder it starts with.
    /// Keep in sync with AppVersion in installer/wardline.iss.</summary>
    private const string AgentVersion = "1.0.1";

    private readonly AgentOptions _opts = options.Value;
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public async Task<bool> SendAsync(IReadOnlyList<AgentEvent> events, CancellationToken ct)
    {
        if (events.Count == 0) return true;
        var client = httpFactory.CreateClient();
        client.BaseAddress = new Uri(_opts.ApiUrl);
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _opts.DeviceToken);

        try
        {
            using var res = await client.PostAsJsonAsync("/api/ingest", new { events, agentVersion = AgentVersion }, JsonOpts, ct);
            if (!res.IsSuccessStatusCode)
            {
                logger.LogWarning("Ingest returned {Status}", (int)res.StatusCode);
                return false;
            }
            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            // Offline: a real agent re-queues here. The dashboard shows an
            // honest "last seen" rather than implying live coverage.
            logger.LogInformation("Ingest unreachable, will retry: {Message}", ex.Message);
            return false;
        }
    }
}
