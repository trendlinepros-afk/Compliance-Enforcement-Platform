using System.Diagnostics;
using System.Runtime.Versioning;
using System.ServiceProcess;

// CepAgent.Updater — a tiny detached helper. The service cannot replace or
// remove itself while running, so it launches this process and exits.
//
//   CepAgent.Updater install <msiPath>   -> stop service, msiexec /i /qn, (service reinstalls)
//   CepAgent.Updater uninstall            -> msiexec /x by ProductCode, then wipe ProgramData + task
//
// This helper only orchestrates external tooling; all destructive filesystem
// work it performs is logged to ProgramData\CepAgent\logs\updater.log.

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("CepAgent.Updater only runs on Windows.");
    return 1;
}
return Updater.Run(args);

[SupportedOSPlatform("windows")]
static class Updater
{
    const string ServiceName = "CepAgent";
    const string UpgradeCode = "{7E9F2A54-3C1B-4E8D-9A0F-2B6C1D4E5F60}"; // must match the WiX UpgradeCode

    static string ProgramData => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "CepAgent");
    static string LogFile => Path.Combine(ProgramData, "logs", "updater.log");

    public static int Run(string[] args)
    {
        try { Directory.CreateDirectory(Path.GetDirectoryName(LogFile)!); } catch { /* ignore */ }
        if (args.Length == 0)
        {
            Log("no verb supplied");
            return 2;
        }

        switch (args[0].ToLowerInvariant())
        {
            case "install":
                if (args.Length < 2) { Log("install requires an MSI path"); return 2; }
                return DoInstall(args[1]);
            case "uninstall":
                return DoUninstall();
            default:
                Log($"unknown verb {args[0]}");
                return 2;
        }
    }

    static int DoInstall(string msiPath)
    {
        Log($"install starting: {msiPath}");
        if (!File.Exists(msiPath)) { Log("MSI not found"); return 3; }

        // Give the service a moment to exit after it launched us.
        StopService();

        // msiexec /i <msi> /qn  — the MSI's MajorUpgrade replaces the old version and
        // reinstalls/starts the service.
        var exit = RunMsiexec($"/i \"{msiPath}\" /qn /norestart REBOOT=ReallySuppress");
        Log($"msiexec /i exited {exit}");
        return exit;
    }

    static int DoUninstall()
    {
        Log("uninstall starting");
        StopService();

        // Remove the product by UpgradeCode -> ProductCode lookup via msiexec /x.
        // Using the UpgradeCode form lets us uninstall without knowing the exact ProductCode.
        var exit = RunMsiexec($"/x {UpgradeCode} /qn /norestart REBOOT=ReallySuppress");
        Log($"msiexec /x exited {exit}");

        // Final cleanup the MSI cannot guarantee: scheduled task + ProgramData tree.
        RemoveScheduledTask();
        WipeProgramData();
        Log("uninstall cleanup complete");
        return exit;
    }

    static void StopService()
    {
        try
        {
            using var sc = new ServiceController(ServiceName);
            if (sc.Status != ServiceControllerStatus.Stopped)
            {
                sc.Stop();
                sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(60));
                Log("service stopped");
            }
        }
        catch (Exception ex)
        {
            Log($"stop service: {ex.Message}");
        }
    }

    static int RunMsiexec(string arguments)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "msiexec.exe"),
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var p = Process.Start(psi)!;
            p.WaitForExit((int)TimeSpan.FromMinutes(10).TotalMilliseconds);
            return p.HasExited ? p.ExitCode : -1;
        }
        catch (Exception ex)
        {
            Log($"msiexec failed: {ex.Message}");
            return -1;
        }
    }

    static void RemoveScheduledTask()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "schtasks.exe"),
                Arguments = "/delete /tn CepAgentUpdater /f",
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var p = Process.Start(psi)!;
            p.WaitForExit(30_000);
        }
        catch (Exception ex)
        {
            Log($"remove task: {ex.Message}");
        }
    }

    static void WipeProgramData()
    {
        // Keep the final updater log; delete everything else this agent created.
        try
        {
            foreach (var dir in new[] { "queue", "snapshots", "updates" })
            {
                var p = Path.Combine(ProgramData, dir);
                if (Directory.Exists(p)) Directory.Delete(p, recursive: true);
            }
            foreach (var file in new[] { "config.json", "device.dat", "state.json", "effective-policy.json" })
            {
                var p = Path.Combine(ProgramData, file);
                if (File.Exists(p)) File.Delete(p);
            }
            Log("ProgramData artifacts removed (device token, config, state, snapshots, queues)");
        }
        catch (Exception ex)
        {
            Log($"wipe ProgramData: {ex.Message}");
        }
    }

    static void Log(string message)
    {
        var line = $"{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ss.fffZ} [updater] {message}{Environment.NewLine}";
        try { File.AppendAllText(LogFile, line); } catch { /* ignore */ }
        Console.WriteLine(message);
    }
}
