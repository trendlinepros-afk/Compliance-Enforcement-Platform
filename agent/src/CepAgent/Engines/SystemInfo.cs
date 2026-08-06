using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.Versioning;
using Microsoft.Win32;

namespace CepAgent.Engines;

[SupportedOSPlatform("windows")]
public static class SystemInfo
{
    public static string Hostname => Dns.GetHostName();

    public static List<string> IPv4Addresses()
    {
        var list = new List<string>();
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up) continue;
            if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
            // Skip Tailscale / VPN / hypervisor adapters so we report the real LAN IP.
            if (SystemInfoLogic.IsVirtualAdapter(ni.Name, ni.Description)) continue;
            foreach (var ua in ni.GetIPProperties().UnicastAddresses)
            {
                if (!SystemInfoLogic.IsReportableIPv4(ua.Address)) continue;
                var s = ua.Address.ToString();
                if (!list.Contains(s)) list.Add(s);
            }
        }
        return list;
    }

    public static (string Name, string Version, string Build) OsInfo()
    {
        string name = "Windows";
        string build = Environment.OSVersion.Version.Build.ToString();
        string version = Environment.OSVersion.Version.ToString();
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            if (key != null)
            {
                name = key.GetValue("ProductName")?.ToString() ?? name;
                var ubr = key.GetValue("UBR");
                var currentBuild = key.GetValue("CurrentBuildNumber")?.ToString() ?? build;
                build = ubr != null ? $"{currentBuild}.{ubr}" : currentBuild;
                var displayVersion = key.GetValue("DisplayVersion")?.ToString();
                version = displayVersion ?? key.GetValue("ReleaseId")?.ToString() ?? version;
                // Win11 still reports ProductName as "Windows 10 ..."; correct it by build.
                if (int.TryParse(currentBuild, out var cb))
                    name = SystemInfoLogic.NormalizeWindowsName(name, cb);
            }
        }
        catch { /* fall back to Environment.OSVersion */ }
        return (name, version, build);
    }

    /// <summary>Windows build number for minBuild applicability checks.</summary>
    public static int BuildNumber()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            var cb = key?.GetValue("CurrentBuildNumber")?.ToString();
            if (cb != null && int.TryParse(cb, out var n)) return n;
        }
        catch { /* ignore */ }
        return Environment.OSVersion.Version.Build;
    }
}
