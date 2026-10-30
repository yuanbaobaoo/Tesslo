using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using Tesslo.Link;

namespace Tesslo.Link.Native;

public static class Exports
{
    private static LinkServer? _server;

    [UnmanagedCallersOnly(EntryPoint = "TessloLinkStart", CallConvs = [typeof(CallConvCdecl)])]
    public static int Start(int port)
    {
        try
        {
            if (_server is not null) return 0;
            _server = new LinkServer(port);
            new Thread(_server.Run) {IsBackground = true}.Start();
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"TessloLinkStart failed: {error}");
            return -1;
        }
    }

    [UnmanagedCallersOnly(EntryPoint = "TessloLinkStop", CallConvs = [typeof(CallConvCdecl)])]
    public static void Stop()
    {
        _server?.Dispose();
        _server = null;
    }

    [UnmanagedCallersOnly(EntryPoint = "TessloLinkVersion", CallConvs = [typeof(CallConvCdecl)])]
    public static IntPtr Version() => Marshal.StringToHGlobalAnsi("1.3");
}
