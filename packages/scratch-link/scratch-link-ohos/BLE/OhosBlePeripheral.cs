// 发现阶段的设备记录：设备内 BLE 桥上报的原始信息。

namespace ScratchLink.Ohos.BLE;

using System.Collections.Generic;

internal sealed record OhosBlePeripheral(string DeviceId, string Name, int Rssi, IReadOnlyList<string> Services);
