using System.Net;
using System.Net.Sockets;

namespace CepAgent.Engines;

/// <summary>
/// Pure, platform-neutral helpers behind <see cref="SystemInfo"/>. Kept free of
/// Windows APIs (registry / NetworkInterface) so they can be unit-tested on any
/// CI host, and referenced directly by the test project.
/// </summary>
public static class SystemInfoLogic
{
    // Overlay / VPN / hypervisor adapters whose addresses are not the machine's
    // real LAN identity — e.g. Tailscale hands out 100.64.0.0/10 (CGNAT) IPs on
    // its own adapter. Matched case-insensitively against the adapter's name +
    // description so the physical NIC's address is what gets reported.
    private static readonly string[] VirtualAdapterMarkers =
    {
        "tailscale", "wireguard", "openvpn", "zerotier", "hamachi", "nordlynx",
        "vpn", "hyper-v", "vethernet", "vmware", "virtualbox", "vbox",
        "tap-windows", "tap adapter", "loopback", "bluetooth", "docker",
        "npcap", "wan miniport", "wsl", "hns",
    };

    /// <summary>True when an adapter is a virtual / overlay / VPN device we should skip.</summary>
    public static bool IsVirtualAdapter(string? name, string? description)
    {
        var hay = ((name ?? string.Empty) + " " + (description ?? string.Empty)).ToLowerInvariant();
        foreach (var marker in VirtualAdapterMarkers)
            if (hay.Contains(marker)) return true;
        return false;
    }

    /// <summary>
    /// True when an IPv4 address is a real, reportable address — i.e. not
    /// loopback (127/8) and not APIPA / link-local (169.254/16).
    /// </summary>
    public static bool IsReportableIPv4(IPAddress address)
    {
        if (address.AddressFamily != AddressFamily.InterNetwork) return false;
        var b = address.GetAddressBytes();
        if (b[0] == 127) return false;                // loopback
        if (b[0] == 169 && b[1] == 254) return false; // link-local / APIPA
        return true;
    }

    /// <summary>
    /// Windows 11 still reports its registry <c>ProductName</c> as
    /// "Windows 10 ..." — Microsoft never updated that value. The build number
    /// is the only reliable signal: 22000+ is Windows 11. Rewrites the marketing
    /// name accordingly while preserving the edition (Pro / Enterprise / Home).
    /// Server product names (which never contain "Windows 10") are left alone.
    /// </summary>
    public static string NormalizeWindowsName(string productName, int currentBuild)
    {
        if (string.IsNullOrEmpty(productName)) return productName;
        if (currentBuild >= 22000 && productName.Contains("Windows 10"))
            return productName.Replace("Windows 10", "Windows 11");
        return productName;
    }
}
