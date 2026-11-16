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

            // BT classic 在 OHOS 上尚未接通：未知路径落到基础 Session，
            // 以"method not found"类错误应答，便于调试（与上游对未知路径的行为一致）。
            _ => new Session(webSocket),
        };
    }
}
