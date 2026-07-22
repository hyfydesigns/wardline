using System.Runtime.Versioning;
using Microsoft.Win32;

namespace WardlineAgent;

/// <summary>
/// Checks that the agent's own protections are still in place and reports a
/// tamper event if not. This is a skeleton: it demonstrates the checks a real
/// watchdog performs (service auto-start intact, managed-extension policy
/// present). A production build also re-asserts the policy and runs a paired
/// protector process so killing one restarts the other.
/// </summary>
public sealed class TamperWatchdog(ILogger<TamperWatchdog> logger)
{
    // Chrome/Edge managed extension force-install list, set by the installer.
    private const string ChromePolicyKey = @"SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist";
    private const string ServiceKey = @"SYSTEM\CurrentControlSet\Services\WardlineAgent";

    /// <summary>Returns a tamper reason if something is wrong, otherwise null.</summary>
    public string? Check()
    {
        if (!OperatingSystem.IsWindows())
            return null; // Windows-only agent; no-op elsewhere so it still compiles.

        return CheckWindows();
    }

    [SupportedOSPlatform("windows")]
    private string? CheckWindows()
    {
        try
        {
            using var service = Registry.LocalMachine.OpenSubKey(ServiceKey);
            if (service is null)
                return "Agent service registration missing";

            // Start value 2 == automatic. Anything else means it was disabled.
            if (service.GetValue("Start") is int start && start != 2)
                return "Agent service was set to non-automatic start";

            using var policy = Registry.LocalMachine.OpenSubKey(ChromePolicyKey);
            if (policy is null || policy.ValueCount == 0)
                return "Browser extension policy was removed";

            return null;
        }
        catch (Exception ex)
        {
            logger.LogWarning("Watchdog check failed: {Message}", ex.Message);
            return null;
        }
    }
}
