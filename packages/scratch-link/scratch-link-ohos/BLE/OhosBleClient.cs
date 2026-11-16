// 设备内 BLE 桥（BleTcpBridge.ets，127.0.0.1:20113）的异步客户端。
// 协议：每个操作一条短 TCP 连接，写一行 JSON 请求、按行读 JSON 事件直到命中
// 期望事件或 error/disconnect；订阅使用常驻连接接收 notification 事件。
// 从 dotnet/Tesslo.Link/OhosBleBridge.cs 平移，改为 async/await + System.Text.Json。

namespace ScratchLink.Ohos.BLE;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ScratchLink.JsonRpc;

internal sealed class OhosBleClient : IAsyncDisposable
{
    // 桥固定监听本机回环；命令级超时兜底，避免桥无响应时挂死会话
    private const string Host = "127.0.0.1";
    private const int Port = 20113;
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(8);

    // 常驻订阅连接三元组：Reader 与 ReadNotificationsLoop 通过引用比对判断是否仍有效
    private TcpClient? subscriptionClient;
    private StreamReader? subscriptionReader;
    private Task? subscriptionLoop;
    // 当前订阅的设备/服务/特征；关闭连接时据此向桥补发 unsubscribe
    private (string DeviceId, string ServiceId, string CharacteristicId)? subscription;

    /// <summary>
    /// 发起一次扫描，期间对每条匹配记录调用 <paramref name="onDevice"/>；
    /// 直到收到 scanEnd 或超时。JsonElement 在此边界转成强类型 <see cref="OhosBleScan"/>。
    /// </summary>
    public async Task ScanAsync(TimeSpan timeout, Func<OhosBleScan, Task> onDevice)
    {
        using var cancellation = new CancellationTokenSource(timeout);
        using var client = await ConnectAsync(cancellation.Token);
        var (reader, writer) = Open(client);
        try
        {
            await WriteRequestAsync(writer, new BridgeRequest { Op = "scan" }, cancellation.Token);
            while (true)
            {
                var root = await ReadEventAsync(reader, cancellation.Token);
                var name = EventName(root);
                if (name == "scan")
                {
                    var scan = ParseScanEvent(root);
                    if (scan is not null)
                    {
                        await onDevice(scan);
                    }
                }
                else if (name == "error")
                {
                    throw BridgeError(root);
                }
                else if (name == "scanEnd")
                {
                    return;
                }
            }
        }
        finally
        {
            client.Close();
        }
    }

    /// <summary>
    /// 连接设备并枚举其 GATT 服务与特征表。
    /// </summary>
    public async Task<Dictionary<string, HashSet<string>>> ConnectAsync(string deviceId)
    {
        // connect 与 getServices 分两条短连接，与既有桥行为一致
        await RequestAsync(new BridgeRequest
        {
            Op = "connect",
            DeviceId = deviceId,
        }, "connect");

        var servicesElement = await RequestAsync(new BridgeRequest
        {
            Op = "getServices",
            DeviceId = deviceId,
        }, "services");

        var services = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        if (servicesElement.TryGetProperty("serviceList", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var service in list.EnumerateArray())
            {
                var serviceUuid = service.TryGetProperty("uuid", out var uuid) ? uuid.GetString() : null;
                if (serviceUuid is null)
                {
                    continue;
                }

                var serviceId = serviceUuid;

                var characteristics = new HashSet<string>(StringComparer.Ordinal);
                if (service.TryGetProperty("characteristics", out var jsonCharacteristics) &&
                    jsonCharacteristics.ValueKind == JsonValueKind.Array)
                {
                    foreach (var characteristic in jsonCharacteristics.EnumerateArray())
                    {
                        if (characteristic.TryGetProperty("uuid", out var id) && id.GetString() is { } value)
                        {
                            characteristics.Add(value.ToLowerInvariant());
                        }
                    }
                }

                services[serviceId.ToLowerInvariant()] = characteristics;
            }
        }

        return services;
    }

    /// <summary>
    /// 尽力断开设备；失败（如桥不可达）不影响调用方。
    /// </summary>
    public async Task DisconnectAsync(string deviceId)
    {
        try
        {
            await RequestAsync(new BridgeRequest
            {
                Op = "disconnect",
                DeviceId = deviceId,
            }, "disconnect");
        }
        catch (Exception exception)
        {
            // best effort：断开失败只记录，不上抛
            Console.Error.WriteLine($"BLE bridge disconnect failed: {exception.Message}");
        }
    }

    /// <summary>
    /// 读取特征值并解码 base64。
    /// </summary>
    public async Task<byte[]> ReadAsync(string deviceId, string serviceId, string characteristicId)
    {
        var element = await RequestAsync(new BridgeRequest
        {
            Op = "read",
            DeviceId = deviceId,
            ServiceId = serviceId,
            CharacteristicId = characteristicId,
        }, "read");
        var base64 = element.TryGetProperty("value", out var value) ? value.GetString() ?? string.Empty : string.Empty;
        return Convert.FromBase64String(base64);
    }

    /// <summary>
    /// 写入特征值（base64 编码后发送），返回写入长度。
    /// </summary>
    public async Task<int> WriteAsync(
        string deviceId,
        string serviceId,
        string characteristicId,
        byte[] buffer,
        bool withResponse)
    {
        var element = await RequestAsync(new BridgeRequest
        {
            Op = "write",
            DeviceId = deviceId,
            ServiceId = serviceId,
            CharacteristicId = characteristicId,
            Message = Convert.ToBase64String(buffer),
            WithResponse = withResponse,
        }, "write");
        return element.TryGetProperty("length", out var length) ? length.GetInt32() : 0;
    }

    /// <summary>
    /// 在常驻连接上订阅特征值变化；断开该连接即停止订阅（与桥的既有语义一致）。
    /// </summary>
    public async Task SubscribeAsync(string deviceId, string serviceId, string characteristicId, Action<byte[]> notifier)
    {
        await StopNotificationsAsync();
        using var cancellation = new CancellationTokenSource(CommandTimeout);
        var client = await ConnectAsync(cancellation.Token);
        var (reader, writer) = Open(client);
        try
        {
            await WriteRequestAsync(writer, new BridgeRequest
            {
                Op = "subscribe",
                DeviceId = deviceId,
                ServiceId = serviceId,
                CharacteristicId = characteristicId,
            }, cancellation.Token);
            var subscribed = await ReadEventAsync(reader, cancellation.Token);
            if (EventName(subscribed) == "error")
            {
                throw BridgeError(subscribed);
            }

            this.subscriptionClient = client;
            this.subscriptionReader = reader;
            this.subscription = (deviceId, serviceId, characteristicId);
            this.subscriptionLoop = Task.Run(() => this.ReadNotificationsLoop(reader, notifier));
        }
        catch (Exception)
        {
            client.Close();
            throw;
        }
    }

    /// <summary>
    /// 停止通知：先尽力向桥发送 unsubscribe，再关闭订阅连接（桥端随之清理）。
    /// </summary>
    public async Task StopNotificationsAsync()
    {
        var client = this.subscriptionClient;
        var subscription = this.subscription;
        this.subscriptionClient = null;
        this.subscriptionReader = null;
        this.subscription = null;
        try
        {
            client?.Close();
        }
        catch (Exception exception)
        {
            // best effort：关闭失败只记录，本地状态已清理
            Console.Error.WriteLine($"BLE bridge subscription close failed: {exception.Message}");
        }

        if (subscription is { } active)
        {
            await this.DisconnectSubscriptionAsync(active.DeviceId, active.ServiceId, active.CharacteristicId);
        }
    }

    private async Task DisconnectSubscriptionAsync(string deviceId, string serviceId, string characteristicId)
    {
        try
        {
            await RequestAsync(new BridgeRequest
            {
                Op = "unsubscribe",
                DeviceId = deviceId,
                ServiceId = serviceId,
                CharacteristicId = characteristicId,
            }, "unsubscribed");
        }
        catch (Exception exception)
        {
            // best effort：订阅连接已关闭，桥端同样会清理订阅
            Console.Error.WriteLine($"BLE bridge unsubscribe failed: {exception.Message}");
        }
    }

    public async ValueTask DisposeAsync()
    {
        await this.StopNotificationsAsync();
    }

    private async Task ReadNotificationsLoop(StreamReader reader, Action<byte[]> notifier)
    {
        try
        {
            while (this.subscriptionReader == reader)
            {
                var line = await reader.ReadLineAsync();
                if (line is null)
                {
                    return;
                }

                using var document = JsonDocument.Parse(line);
                var root = document.RootElement.Clone();
                if (EventName(root) != "notification")
                {
                    continue;
                }

                var base64 = root.TryGetProperty("value", out var value) ? value.GetString() ?? string.Empty : string.Empty;
                notifier(Convert.FromBase64String(base64));
            }
        }
        catch (Exception exception)
        {
            // 连接被关闭（IOException）或单行解析失败；循环终止，错误记录供排查
            Console.Error.WriteLine($"BLE notification loop ended: {exception.Message}");
        }
    }

    /// <summary>
    /// 把桥的 scan 事件解析为强类型记录；缺 deviceId 的事件丢弃（返回 null）。
    /// </summary>
    private static OhosBleScan? ParseScanEvent(JsonElement root)
    {
        if (!root.TryGetProperty("deviceId", out var deviceIdElement) ||
            deviceIdElement.GetString() is not { } deviceId)
        {
            return null;
        }

        var name = root.TryGetProperty("name", out var nameElement) ? nameElement.GetString() ?? string.Empty : string.Empty;
        var rssi = root.TryGetProperty("rssi", out var rssiElement) ? rssiElement.GetInt32() : 0;
        var services = new List<string>();
        if (root.TryGetProperty("services", out var servicesElement) &&
            servicesElement.ValueKind == JsonValueKind.Array)
        {
            services.AddRange(servicesElement.EnumerateArray()
                .Select(service => (service.GetString() ?? string.Empty).ToLowerInvariant()));
        }

        return new OhosBleScan(deviceId, name, rssi, services);
    }

    // 单次请求-应答：短连接写一行请求，按行读事件直到命中期望事件或 error/disconnect
    private static async Task<JsonElement> RequestAsync(BridgeRequest request, string expectedEvent)
    {
        using var cancellation = new CancellationTokenSource(CommandTimeout);
        using var client = await ConnectAsync(cancellation.Token);
        var (reader, writer) = Open(client);
        try
        {
            await WriteRequestAsync(writer, request, cancellation.Token);
            while (true)
            {
                var root = await ReadEventAsync(reader, cancellation.Token);
                var name = EventName(root);
                if (name == expectedEvent)
                {
                    return root;
                }

                if (name == "error" || name == "disconnect")
                {
                    throw BridgeError(root);
                }
            }
        }
        finally
        {
            client.Close();
        }
    }

    // 建立到桥的 TCP 连接；失败统一转成 JsonRpc 应用错误（含可读原因）
    private static async Task<TcpClient> ConnectAsync(CancellationToken cancellation)
    {
        var client = new TcpClient();
        try
        {
            await client.ConnectAsync(Host, Port, cancellation);
            return client;
        }
        catch (Exception exception)
        {
            client.Dispose();
            throw JsonRpc2Error.ApplicationError($"BLE bridge unreachable: {exception.Message}").ToException();
        }
    }

    // 在 TCP 流上挂行协议读写器；AutoFlush 保证请求行立即发出
    private static (StreamReader Reader, StreamWriter Writer) Open(TcpClient client)
    {
        var stream = client.GetStream();
        var reader = new StreamReader(stream);
        var writer = new StreamWriter(stream) { AutoFlush = true };
        return (reader, writer);
    }

    // 请求行走源生成序列化上下文（NativeAOT 无反射）
    private static async Task WriteRequestAsync(
        StreamWriter writer,
        BridgeRequest request,
        CancellationToken cancellation) =>
        await writer.WriteLineAsync(JsonSerializer.Serialize(request, BridgeJsonContext.Default.BridgeRequest).AsMemory(), cancellation);

    // 读一行事件并 Clone 出独立的 JsonElement（原 document 随 using 释放）
    private static async Task<JsonElement> ReadEventAsync(StreamReader reader, CancellationToken cancellation)
    {
        var line = await reader.ReadLineAsync(cancellation);
        if (line is null)
        {
            throw JsonRpc2Error.ApplicationError("BLE bridge closed the connection").ToException();
        }

        var document = JsonDocument.Parse(line);
        return document.RootElement.Clone();
    }

    // 取事件类型字段；缺失返回 null（调用方按未知事件跳过）
    private static string? EventName(JsonElement element) =>
        element.TryGetProperty("event", out var name) ? name.GetString() : null;

    // 把桥的 error/disconnect 事件转成 JsonRpc 应用错误，message 取不到时给兜底文案
    private static JsonRpc2Exception BridgeError(JsonElement element)
    {
        var message =
            (element.TryGetProperty("error", out var error) ? error.GetString() : null) ??
            (element.TryGetProperty("message", out var text) ? text.GetString() : null) ??
            "BLE bridge error";
        return JsonRpc2Error.ApplicationError(message).ToException();
    }
}
