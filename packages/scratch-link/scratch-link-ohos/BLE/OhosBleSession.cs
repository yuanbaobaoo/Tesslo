// BLE 会话的 OHOS 实现：继承上游 BLESession，泛型实例化为
// OhosBlePeripheral（发现记录）/ string（设备地址）/ string（UUID）。
// 扫描与连接经由设备内 BLE 桥（127.0.0.1:20113，BleTcpBridge.ets）完成。

namespace ScratchLink.Ohos.BLE;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Fleck;
using ScratchLink.BLE;
using ScratchLink.JsonRpc;

internal class OhosBleSession : BLESession<OhosBlePeripheral, string, string>
{
    /// <summary>与上游 Windows 版一致的扫描窗口长度。</summary>
    private static readonly TimeSpan ScanWindow = TimeSpan.FromMilliseconds(4500);

    private readonly OhosBleClient bridge = new ();
    private readonly SemaphoreSlim bridgeLock = new (1, 1);
    private volatile bool connected;
    private string? connectedDeviceId;
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
            await this.bridge.ScanAsync(ScanWindow, scanEvent =>
            {
                if (!scanEvent.TryGetProperty("deviceId", out var deviceIdElement) ||
                    deviceIdElement.GetString() is not { } deviceId)
                {
                    return Task.CompletedTask;
                }

                var name = scanEvent.TryGetProperty("name", out var nameElement) ? nameElement.GetString() ?? string.Empty : string.Empty;
                var rssi = scanEvent.TryGetProperty("rssi", out var rssiElement) ? rssiElement.GetInt32() : 0;
                var services = new List<string>();
                if (scanEvent.TryGetProperty("services", out var servicesElement) &&
                    servicesElement.ValueKind == JsonValueKind.Array)
                {
                    services.AddRange(servicesElement.EnumerateArray()
                        .Select(service => (service.GetString() ?? string.Empty).ToLowerInvariant()));
                }

                // 桥不提供厂商广播数据：带 manufacturerData 的过滤器视为不匹配
                if (!filters.Any(filter => filter.Matches(name, services, NoManufacturerData)))
                {
                    return Task.CompletedTask;
                }

                var peripheral = new OhosBlePeripheral(deviceId, name, rssi, services);
                return this.OnPeripheralDiscovered(peripheral, deviceId, name, rssi);
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
    protected override string GetDefaultServiceId() => null;

    /// <inheritdoc/>
    protected override string GetDefaultCharacteristicId(string serviceId) => null;

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

    private static readonly Dictionary<int, IEnumerable<byte>> NoManufacturerData = new ();
}
