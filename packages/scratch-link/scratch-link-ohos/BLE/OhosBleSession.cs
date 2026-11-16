// BLE 会话的 OHOS 实现：继承上游 BLESession，泛型实例化为
// OhosBlePeripheral（发现记录）/ string（设备地址）/ string（UUID）。
// 扫描与连接经由设备内 BLE 桥（127.0.0.1:20113，BleTcpBridge.ets）完成。

namespace ScratchLink.Ohos.BLE;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Fleck;
using ScratchLink.BLE;
using ScratchLink.JsonRpc;

internal class OhosBleSession : BLESession<OhosBlePeripheral, string, string>
{
    /// <summary>与上游 Windows 版一致的扫描窗口长度。</summary>
    private static readonly TimeSpan ScanWindow = TimeSpan.FromMilliseconds(4500);

    // 与设备内桥通信的客户端；bridgeLock 串行化全部桥访问（含 Endpoint 侧共享）
    private readonly OhosBleClient bridge = new ();
    private readonly SemaphoreSlim bridgeLock = new (1, 1);
    // 连接状态三件套：DoConnect 成功后写入，Dispose 时清理
    private volatile bool connected;
    private string? connectedDeviceId;
    // 已连接设备的 GATT 表（小写 UUID -> 特征集合），DoGetEndpoint 的白名单依据
    private Dictionary<string, HashSet<string>> connectedServices =
        new (StringComparer.Ordinal);

    public OhosBleSession(IWebSocketConnection webSocket)
        : base(webSocket)
    {
    }

    /// <inheritdoc/>
    protected override bool IsConnected => this.connected;

    /// <inheritdoc/>
    protected override async Task<object> DoDiscover(List<BLEScanFilter> filters)
    {
        await this.bridgeLock.WaitAsync();
        try
        {
            await this.bridge.ScanAsync(ScanWindow, scan =>
            {
                // 桥不提供厂商广播数据：带 manufacturerData 的过滤器视为不匹配
                if (!filters.Any(filter => filter.Matches(scan.Name, scan.Services, NoManufacturerData)))
                {
                    return Task.CompletedTask;
                }

                var peripheral = new OhosBlePeripheral(scan.DeviceId, scan.Name, scan.Rssi, scan.Services);
                return this.OnPeripheralDiscovered(peripheral, scan.DeviceId, scan.Name, scan.Rssi);
            });
        }
        finally
        {
            this.bridgeLock.Release();
        }

        return null;
    }

    /// <inheritdoc/>
    protected override async Task<object> DoConnect(OhosBlePeripheral discoveredPeripheral)
    {
        await this.bridgeLock.WaitAsync();
        try
        {
            this.connectedServices = await this.bridge.ConnectAsync(discoveredPeripheral.DeviceId);
            this.connectedDeviceId = discoveredPeripheral.DeviceId;
            this.connected = true;
        }
        finally
        {
            this.bridgeLock.Release();
        }

        return null;
    }

    /// <inheritdoc/>
    /// <remarks>OHOS 桥没有"默认 service/characteristic"概念：约定返回 null 使上游调用侧
    /// 回退到客户端显式指定的值；基类签名未标注可空，此处以 ! 断言该既有契约。</remarks>
    protected override string GetDefaultServiceId() => null!;

    /// <inheritdoc/>
    /// <remarks>同 <see cref="GetDefaultServiceId"/>：null 表示无默认值。</remarks>
    protected override string GetDefaultCharacteristicId(string serviceId) => null!;

    /// <inheritdoc/>
    protected override Task<IBLEEndpoint> DoGetEndpoint(string serviceId, string characteristicId)
    {
        if (!this.connected || this.connectedDeviceId is null)
        {
            throw JsonRpc2Error.ApplicationError($"Peripheral is not connected").ToException();
        }

        if (!this.connectedServices.TryGetValue(serviceId, out var characteristics))
        {
            throw JsonRpc2Error.ApplicationError($"GATT service not available on connected device: {serviceId}").ToException();
        }

        if (!characteristics.Contains(characteristicId))
        {
            throw JsonRpc2Error.ApplicationError(
                $"GATT characteristic not available on service {serviceId}: {characteristicId}").ToException();
        }

        return Task.FromResult<IBLEEndpoint>(
            new OhosBleEndpoint(this.bridge, this.bridgeLock, this.connectedDeviceId, serviceId, characteristicId));
    }

    /// <inheritdoc/>
    protected override void Dispose(bool disposing)
    {
        if (!this.DisposedValue)
        {
            if (disposing)
            {
                var deviceId = this.connectedDeviceId;
                this.connected = false;
                this.connectedDeviceId = null;
                this.bridge.DisposeAsync().AsTask().ContinueWith(_ => { });
                if (deviceId is not null)
                {
                    this.bridge.DisconnectAsync(deviceId).ContinueWith(_ => { });
                }
            }
        }

        base.Dispose(disposing);
    }

    // 桥不提供厂商广播数据：空的 manufacturerData 表让带该过滤器的规则必然不匹配
    private static readonly Dictionary<int, IEnumerable<byte>> NoManufacturerData = new ();
}
