// GATT endpoint（service + characteristic 对）的 OHOS 实现。
// read/write/notifications 全部经由设备内 BLE 桥转发。

namespace ScratchLink.Ohos.BLE;

using System;
using System.Threading.Tasks;
using ScratchLink.BLE;

internal sealed class OhosBleEndpoint : IBLEEndpoint
{
    private readonly string deviceId;

    public OhosBleEndpoint(string deviceId, string serviceId, string characteristicId)
    {
        this.deviceId = deviceId;
        this.ServiceId = serviceId;
        this.CharacteristicId = characteristicId;
    }

    /// <inheritdoc/>
    public string ServiceId { get; }

    /// <inheritdoc/>
    public string CharacteristicId { get; }

    /// <inheritdoc/>
    public Task<int> Write(byte[] buffer, bool? withResponse)
    {
        // TODO(bridge): {"op":"write", deviceId, serviceId, characteristicId, value(base64)}
        throw new NotImplementedException("OHOS BLE bridge write is not wired up yet");
    }

    /// <inheritdoc/>
    public Task<byte[]> Read()
    {
        // TODO(bridge): {"op":"read", deviceId, serviceId, characteristicId}
        throw new NotImplementedException("OHOS BLE bridge read is not wired up yet");
    }

    /// <inheritdoc/>
    public Task StartNotifications(Action<byte[]> notifier)
    {
        // TODO(bridge): {"op":"subscribe", ...} 并把桥事件分发给 notifier。
        throw new NotImplementedException("OHOS BLE bridge notifications are not wired up yet");
    }

    /// <inheritdoc/>
    public Task StopNotifications()
    {
        // TODO(bridge): {"op":"unsubscribe", ...}
        throw new NotImplementedException("OHOS BLE bridge notifications are not wired up yet");
    }
}
