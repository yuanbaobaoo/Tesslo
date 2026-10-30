// NAPI 宿主导出：与 napi/tesslo_link_napi.cpp 约定的符号同名。
// 上游 ScratchLinkApp 把监听端口固定为 20111，Start 的 port 参数仅做一致性校验。

namespace ScratchLink.Ohos;

using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using ScratchLink.BLE;

internal static class Exports
{
    private static ScratchLinkApp? app;

    [UnmanagedCallersOnly(EntryPoint = "TessloLinkStart", CallConvs = [typeof(CallConvCdecl)])]
    public static int Start(int port)
    {
        try
        {
            if (app is not null) return 0;
            if (port != 20111)
            {
                // 上游 ScratchLinkApp 硬编码监听 20111；如需可配置需上游化该常量
                return -3;
            }

            var builder = new ScratchLinkApp.Builder();
            builder.SetSessionManager<OhosSessionManager>();
            builder.SetGattHelpers<OhosGattHelpers, string>();
            app = builder.Build();
            app.Run();
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
        app?.Quit();
        app = null;
    }

    [UnmanagedCallersOnly(EntryPoint = "TessloLinkVersion", CallConvs = [typeof(CallConvCdecl)])]
    public static IntPtr Version() => Marshal.StringToHGlobalAnsi("scratch-link-ohos/1.4");
}
