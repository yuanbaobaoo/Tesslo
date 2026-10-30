// 实现 SessionManager 的 OHOS 平台分派：/scratch/ble 进入 BLE 会话。
// BT 经典（/scratch/bt）暂不支持，落到基础 Session 用于调试（与上游对未知路径的行为一致）。

namespace ScratchLink.Ohos;

using Fleck;
using ScratchLink.Ohos.BLE;

internal class OhosSessionManager : SessionManager
{
    /// <inheritdoc/>
    protected override Session MakeNewSession(IWebSocketConnection webSocket)
    {
        var requestPath = webSocket.ConnectionInfo.Path;
        return requestPath switch
        {
            "/scratch/ble" => new OhosBleSession(webSocket),

            // BT classic on OHOS is not wired up yet; a plain Session answers
            // JSON-RPC with "method not found"-style errors for debugging.
            _ => new Session(webSocket),
        };
    }
}
