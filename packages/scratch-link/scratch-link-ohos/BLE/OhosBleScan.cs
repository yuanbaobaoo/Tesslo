// 扫描阶段由设备内 BLE 桥上报的单条设备记录：
// 在桥客户端（OhosBleClient）边界解析为强类型，JsonElement 不下渗到会话层。

namespace ScratchLink.Ohos.BLE;

using System.Collections.Generic;

internal sealed record OhosBleScan(string DeviceId, string Name, int Rssi, IReadOnlyList<string> Services);
