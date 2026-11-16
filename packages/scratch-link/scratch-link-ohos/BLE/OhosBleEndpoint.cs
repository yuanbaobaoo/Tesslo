// GATT endpoint（service + characteristic 对）的 OHOS 实现：
// read/write/notifications 经设备内 BLE 桥转发。

namespace ScratchLink.Ohos.BLE;

using System;
using System.Threading;
using System.Threading.Tasks;
using ScratchLink.BLE;

internal sealed class OhosBleEndpoint : IBLEEndpoint
{
    // bridge/bridgeLock 由 Session 传入共享：Endpoint 的读写与扫描/连接互斥，
    // 避免并发操作同一条短连接协议
    private readonly OhosBleClient bridge;
    private readonly SemaphoreSlim bridgeLock;
    private readonly string deviceId;

    public OhosBleEndpoint(
        OhosBleClient bridge,
        SemaphoreSlim bridgeLock,
        string deviceId,
        string serviceId,
        string characteristicId)
    {
        this.bridge = bridge;
        this.bridgeLock = bridgeLock;
        this.deviceId = deviceId;
        this.ServiceId = serviceId;
        this.CharacteristicId = characteristicId;
    }

    /// <inheritdoc/>
    public string ServiceId { get; }

    /// <inheritdoc/>
    public string CharacteristicId { get; }

    /// <inheritdoc/>
    public async Task<int> Write(byte[] buffer, bool? withResponse)
    {
        await this.bridgeLock.WaitAsync();
        try
        {
            return await this.bridge.WriteAsync(
                this.deviceId,
                this.ServiceId,
                this.CharacteristicId,
                buffer,
                withResponse ?? true);
        }
        finally
        {
            this.bridgeLock.Release();
        }
    }

    /// <inheritdoc/>
    public async Task<byte[]> Read()
    {
        await this.bridgeLock.WaitAsync();
        try
        {
            return await this.bridge.ReadAsync(this.deviceId, this.ServiceId, this.CharacteristicId);
        }
        finally
        {
            this.bridgeLock.Release();
        }
    }

    /// <inheritdoc/>
    public async Task StartNotifications(Action<byte[]> notifier)
    {
        await this.bridgeLock.WaitAsync();
        try
        {
            await this.bridge.SubscribeAsync(this.deviceId, this.ServiceId, this.CharacteristicId, notifier);
        }
        finally
        {
            this.bridgeLock.Release();
        }
    }

    /// <inheritdoc/>
    public async Task StopNotifications()
    {
        await this.bridgeLock.WaitAsync();
        try
        {
            await this.bridge.StopNotificationsAsync();
        }
        finally
        {
            this.bridgeLock.Release();
        }
    }
}
