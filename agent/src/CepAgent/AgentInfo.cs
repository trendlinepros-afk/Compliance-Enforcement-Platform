using System.Reflection;

namespace CepAgent;

public static class AgentInfo
{
    public static string Version =>
        Assembly.GetExecutingAssembly().GetName().Version is { } v
            ? $"{v.Major}.{v.Minor}.{v.Build}"
            : "1.0.0";
}
