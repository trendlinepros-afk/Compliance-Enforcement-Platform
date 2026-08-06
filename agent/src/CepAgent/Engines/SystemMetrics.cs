using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Runtime.Versioning;
using CepAgent.Models;

namespace CepAgent.Engines;

/// <summary>
/// Lightweight system metrics for the heartbeat: CPU %, physical RAM, fixed-disk
/// usage, and uptime. Dependency-free — RAM + CPU come from kernel32 P/Invoke,
/// disks from DriveInfo. Every probe is best-effort; a failure yields zeros
/// rather than throwing (metrics must never break the heartbeat).
/// </summary>
[SupportedOSPlatform("windows")]
public static class SystemMetrics
{
    public static MetricsDto Collect()
    {
        var m = new MetricsDto
        {
            CpuCores = Environment.ProcessorCount,
            UptimeSeconds = Environment.TickCount64 / 1000,
        };

        try
        {
            var mem = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
            if (GlobalMemoryStatusEx(ref mem))
            {
                m.MemTotalBytes = (long)mem.ullTotalPhys;
                m.MemUsedBytes = (long)(mem.ullTotalPhys - mem.ullAvailPhys);
            }
        }
        catch { /* leave zero */ }

        try { m.CpuPercent = Math.Round(SampleCpuPercent(), 1); }
        catch { /* leave zero */ }

        try
        {
            foreach (var d in DriveInfo.GetDrives())
            {
                if (d.DriveType != DriveType.Fixed || !d.IsReady) continue;
                m.Disks.Add(new DiskDto { Name = d.Name, TotalBytes = d.TotalSize, FreeBytes = d.AvailableFreeSpace });
            }
        }
        catch { /* leave empty */ }

        return m;
    }

    /// <summary>System-wide CPU % over a short sample (kernel time includes idle).</summary>
    private static double SampleCpuPercent()
    {
        if (!GetSystemTimes(out var idle1, out var kernel1, out var user1)) return 0;
        Thread.Sleep(500);
        if (!GetSystemTimes(out var idle2, out var kernel2, out var user2)) return 0;

        ulong idle = Delta(idle2, idle1);
        ulong total = Delta(kernel2, kernel1) + Delta(user2, user1); // kernel already counts idle
        if (total == 0) return 0;
        double busy = (double)(total - idle) / total;
        return Math.Clamp(busy * 100.0, 0, 100);
    }

    private static ulong ToUlong(FILETIME t) => ((ulong)(uint)t.dwHighDateTime << 32) | (uint)t.dwLowDateTime;
    private static ulong Delta(FILETIME a, FILETIME b) => ToUlong(a) - ToUlong(b);

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemTimes(out FILETIME lpIdleTime, out FILETIME lpKernelTime, out FILETIME lpUserTime);
}
