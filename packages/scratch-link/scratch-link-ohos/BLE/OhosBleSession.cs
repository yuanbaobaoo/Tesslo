// BLE 会话的 OHOS 实现：继承上游 BLESession，泛型实例化为
// OhosBlePeripheral（发现记录）/ string（设备地址）/ string（UUID）。
// 扫描与连接最终经由设备内 BLE 桥（127.0.0.1:20113，BleTcpBridge.ets）完成——
// 对接逻辑从 dotnet/Tesslo.Link/OhosBleBridge.cs 平移，分步实施。

namespace ScratchLink.Ohos.BLE;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Fleck;
using ScratchLink.BLE;

internal class OhosBleSession : BLESession<OhosBlePeripheral, string, string>
{
    private volatile bool connected;

    public OhosBleSession(IWebSocketConnection webSocket)
        : base(webSocket)
    {
    }

    /// <inheritdoc/>
    protected override bool IsConnected => this.connected;

    /// <inheritdoc/>
    protected override async Task<object> DoDiscover(List<BLEScanFilter> filters)
    {
        // TODO(bridge): 经 TCP 桥发起扫描（{"op":"scan"}），按 filters 过滤后
        // 对每个命中设备调用 OnPeripheralDiscovered(peripheral, deviceId, name, rssi)。
        await Task.CompletedTask;
        throw new NotImplementedException("OHOS BLE bridge scan is not wired up yet");
    }

    /// <inheritdoc/>
    protected override Task<object> DoConnect(OhosBlePeripheral discoveredPeripheral)
    {
        // TODO(bridge): 经 TCP 桥连接设备（{"op":"connect", ...}）并枚举 GATT 服务。
        throw new NotImplementedException("OHOS BLE bridge connect is not wired up yet");
    }

    /// <inheritdoc/>
    protected override string GetDefaultServiceId() => string.Empty;

    /// <inheritdoc/>
    protected override string GetDefaultCharacteristicId(string serviceId) => string.Empty;

    /// <inheritdoc/>
    protected override Task<IBLEEndpoint> DoGetEndpoint(string serviceId, string characteristicId)
    {
        // TODO(bridge): 校验 service/characteristic 存在后返回 OhosBleEndpoint。
        throw new NotImplementedException("OHOS BLE bridge endpoints are not wired up yet");
    }
}
