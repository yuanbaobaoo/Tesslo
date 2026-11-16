// NAPI 宿主导出：与 napi/tesslo_link_napi.cpp 约定的符号同名。
// 上游 ScratchLinkApp 把监听端口固定为 20111，Start 的 port 参数仅做一致性校验。

namespace ScratchLink.Ohos;

using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using ScratchLink.BLE;

internal static class Exports
{
    // 与上游 scratch-link-common ScratchLinkApp.WebSocketPort 一致；改动需两侧同步
    private const int LinkPort = 20111;

    // 已启动的应用实例；Start 幂等（非空直接返回），Stop 置空以便重启
    private static ScratchLinkApp? app;

    [UnmanagedCallersOnly(EntryPoint = "TessloLinkStart", CallConvs = [typeof(CallConvCdecl)])]
    public static int Start(int port)
    {
        try
        {
            if (app is not null) return 0;
            if (port != LinkPort)
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
            // 跨 ABI 导出禁止托管异常穿出（§12.3）：全部转成返回码 + stderr
            Console.Error.WriteLine($"TessloLinkStart failed: {error}");
            return -1;
        }
    }

    [UnmanagedCallersOnly(EntryPoint = "TessloLinkStop", CallConvs = [typeof(CallConvCdecl)])]
    public static void Stop()
    {
        try
        {
            app?.Quit();
            app = null;
        }
        catch (Exception error)
        {
            // Quit 涉及 WebSocket/会话清理，可能抛出；吞掉并记录，不让异常穿过 ABI
            Console.Error.WriteLine($"TessloLinkStop failed: {error}");
        }
    }

    [UnmanagedCallersOnly(EntryPoint = "TessloLinkVersion", CallConvs = [typeof(CallConvCdecl)])]
    public static unsafe IntPtr Version()
    {
        try
        {
            // 返回模块只读数据段里的静态 UTF-8 串（显式含结尾 '\0'）：进程生命周期内有效，
            // 调用侧（napi/tesslo_link_napi.cpp）只读复制、无需释放，不存在所有权转移。
            // fixed 块结束指针仍有效：u8 字面量是 RVA 静态数据，不受 GC 移动影响。
            fixed (byte* pointer = "scratch-link-ohos/1.4\0"u8)
            {
                return (IntPtr)pointer;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"TessloLinkVersion failed: {error}");
            return IntPtr.Zero;
        }
    }
}
