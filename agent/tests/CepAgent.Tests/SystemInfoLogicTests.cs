using System.Net;
using CepAgent.Engines;
using Xunit;

namespace CepAgent.Tests;

public class SystemInfoLogicTests
{
    [Theory]
    [InlineData("Windows 10 Pro", 26200, "Windows 11 Pro")]           // the reported laptop
    [InlineData("Windows 10 Enterprise", 22631, "Windows 11 Enterprise")]
    [InlineData("Windows 10 Home", 22000, "Windows 11 Home")]         // first Win11 build
    [InlineData("Windows 10 Pro", 19045, "Windows 10 Pro")]           // real Win10 22H2
    [InlineData("Windows 11 Pro", 26100, "Windows 11 Pro")]           // already correct
    [InlineData("Windows Server 2022 Standard", 20348, "Windows Server 2022 Standard")]
    [InlineData("Windows Server 2025 Standard", 26100, "Windows Server 2025 Standard")]
    public void NormalizeWindowsName_uses_build_number(string product, int build, string expected)
        => Assert.Equal(expected, SystemInfoLogic.NormalizeWindowsName(product, build));

    [Theory]
    [InlineData("Tailscale", "Tailscale Tunnel")]
    [InlineData("Ethernet 2", "Hyper-V Virtual Ethernet Adapter")]
    [InlineData("VPN - Corp", "SonicWall NetExtender VPN Adapter")]
    [InlineData("wg0", "WireGuard Tunnel")]
    [InlineData("VMware Network Adapter VMnet8", "VMware Virtual Ethernet Adapter")]
    public void IsVirtualAdapter_flags_overlay_and_vpn_devices(string name, string desc)
        => Assert.True(SystemInfoLogic.IsVirtualAdapter(name, desc));

    [Theory]
    [InlineData("Ethernet", "Intel(R) Ethernet Connection I219-LM")]
    [InlineData("Wi-Fi", "Intel(R) Wi-Fi 6 AX201 160MHz")]
    public void IsVirtualAdapter_keeps_physical_nics(string name, string desc)
        => Assert.False(SystemInfoLogic.IsVirtualAdapter(name, desc));

    [Theory]
    [InlineData("192.168.1.72", true)]
    [InlineData("10.0.0.5", true)]
    [InlineData("100.65.125.60", true)]   // CGNAT is a valid address; the Tailscale *adapter* is what gets skipped
    [InlineData("127.0.0.1", false)]      // loopback
    [InlineData("169.254.10.20", false)]  // APIPA / link-local
    public void IsReportableIPv4_filters_loopback_and_linklocal(string ip, bool expected)
        => Assert.Equal(expected, SystemInfoLogic.IsReportableIPv4(IPAddress.Parse(ip)));
}
