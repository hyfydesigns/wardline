using Microsoft.Extensions.Options;

namespace WardlineAgent;

/// <summary>
/// The background loop. Every SampleSeconds it rolls up usage and posts it;
/// every WatchdogSeconds it runs the tamper check and reports a tamper event
/// as a high-priority alert if integrity is broken.
///
/// The usage numbers here are illustrative. A full agent samples the active
/// foreground window / browser and maps it to a category on-device.
/// </summary>
public sealed class Worker(
    ILogger<Worker> logger,
    IngestClient ingest,
    TamperWatchdog watchdog,
    IOptions<AgentOptions> options) : BackgroundService
{
    private readonly AgentOptions _opts = options.Value;
    private DateTime _lastWatchdog = DateTime.MinValue;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Wardline agent started. Reporting to {Api}", _opts.ApiUrl);

        while (!stoppingToken.IsCancellationRequested)
        {
            var batch = new List<AgentEvent>
            {
                // Illustrative usage rollup for the sampling window.
                new()
                {
                    Kind = "usage",
                    Source = "system",
                    Category = SampleForegroundCategory(),
                    Minutes = Math.Max(1, _opts.SampleSeconds / 60),
                },
            };

            // Periodic integrity heartbeat. We report every cycle — a reason
            // when something is wrong, or an explicit "ok" when checks pass —
            // so the server can detect the transition back to healthy and clear
            // the device's tamper flag. The server suppresses repeats, so this
            // heartbeat is cheap even though it fires on every check.
            if ((DateTime.UtcNow - _lastWatchdog).TotalSeconds >= _opts.WatchdogSeconds)
            {
                _lastWatchdog = DateTime.UtcNow;
                var reason = watchdog.Check();
                if (reason is not null)
                {
                    logger.LogWarning("Tamper detected: {Reason}", reason);
                    batch.Add(new AgentEvent { Kind = "tamper", Source = "tamper-watchdog", Text = reason });
                }
                else
                {
                    batch.Add(new AgentEvent { Kind = "integrity_ok", Source = "tamper-watchdog" });
                }
            }

            await ingest.SendAsync(batch, stoppingToken);
            await Task.Delay(TimeSpan.FromSeconds(_opts.SampleSeconds), stoppingToken);
        }
    }

    /// <summary>
    /// Placeholder for foreground-window sampling. Real implementation calls
    /// GetForegroundWindow + GetWindowThreadProcessId and maps the process to a
    /// category (browser, game, streaming app, …).
    /// </summary>
    private static string SampleForegroundCategory()
    {
        string[] categories = ["Social", "Gaming", "Streaming", "Homework", "Other"];
        return categories[Random.Shared.Next(categories.Length)];
    }
}
