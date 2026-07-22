namespace WardlineAgent;

/// <summary>Configuration bound from the "Wardline" section of appsettings.json.</summary>
public sealed class AgentOptions
{
    /// <summary>Base URL of the cloud ingest API.</summary>
    public string ApiUrl { get; set; } = "http://127.0.0.1:4000";

    /// <summary>Per-device bearer token issued at enrolment.</summary>
    public string DeviceToken { get; set; } = "";

    /// <summary>How often to roll up and send usage telemetry, in seconds.</summary>
    public int SampleSeconds { get; set; } = 60;

    /// <summary>How often the tamper watchdog re-checks integrity, in seconds.</summary>
    public int WatchdogSeconds { get; set; } = 30;
}
