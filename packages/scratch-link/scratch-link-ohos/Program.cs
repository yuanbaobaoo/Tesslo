// OHOS 平台版 Scratch Link 宿主。
// 对应 scratch-link-win / scratch-link-mac 的 App 入口：装配平台 SessionManager
// 与 GattHelpers 后启动上游 WebSocketListener（端口由上游 ScratchLinkApp 固定为 20111）。

namespace ScratchLink.Ohos;

using System.Threading;
using ScratchLink;

internal static class Program
{
    // 独立运行入口（桌面调试用）：设备上实际走 NAPI 的 Exports.Start。
    // 上游 Run 非阻塞，Sleep 保活进程；Ctrl+C 结束。
    private static int Main(string[] args)
    {
        var appBuilder = new ScratchLinkApp.Builder();
        appBuilder.SetSessionManager<OhosSessionManager>();
        appBuilder.SetGattHelpers<OhosGattHelpers, string>();
        var app = appBuilder.Build();
        app.Run();
        Thread.Sleep(Timeout.Infinite);
        return 0;
    }
}
