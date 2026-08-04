using System.Runtime.Versioning;
using CepAgent;
using CepAgent.Identity;
using Microsoft.Extensions.Hosting;

// Entry point. On first-ever start the MSI may have written SERVERURL/ENROLLTOKEN
// into config via the "configure" verb (invoked by the MSI custom action); handle
// that here, then run as a Windows Service.

if (args.Length >= 1 && args[0].Equals("configure", StringComparison.OrdinalIgnoreCase))
{
    // Usage: CepAgent.exe configure <serverUrl> <enrollToken>
    if (OperatingSystem.IsWindows())
    {
        ConfigureFromArgs(args);
    }
    return;
}

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options => options.ServiceName = AgentPaths.ServiceName);
if (OperatingSystem.IsWindows())
{
    builder.Services.AddHostedService<AgentWorker>();
}
var host = builder.Build();
host.Run();

[SupportedOSPlatform("windows")]
static void ConfigureFromArgs(string[] args)
{
    var identity = new DeviceIdentity();
    identity.Load();
    if (args.Length >= 2 && !string.IsNullOrWhiteSpace(args[1])) identity.Config.ServerUrl = args[1].TrimEnd('/');
    if (args.Length >= 3 && !string.IsNullOrWhiteSpace(args[2])) identity.Config.EnrollToken = args[2];
    identity.SaveConfig();
    Console.WriteLine($"CepAgent configured: server={identity.Config.ServerUrl}");
}
