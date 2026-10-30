// 设备内 BLE 桥（BleTcpBridge.ets，127.0.0.1:20113）的异步客户端。
// 协议：每个操作一条短 TCP 连接，写一行 JSON 请求、按行读 JSON 事件直到命中
// 期望事件或 error/disconnect；订阅使用常驻连接接收 notification 事件。
// 从 dotnet/Tesslo.Link/OhosBleBridge.cs 平移，改为 async/await + System.Text.Json。

namespace ScratchLink.Ohos.BLE;

using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using ScratchLink.JsonRpc;

internal sealed class OhosBleClient : IAsyncDisposable
{
    private const string Host = "127.0.0.1";
    private const int Port = 20113;
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(8);

    private TcpClient? subscriptionClient;
    private StreamReader? subscriptionReader;
    private Task? subscriptionLoop;
    private (string DeviceId, string ServiceId, string CharacteristicId)? subscription;

    /// <summary>
    /// 发起一次扫描，期间对每个匹配设备调用 <paramref name="onDevice"/>（原始 scan 事件 JSON）。
    /// 直到收到 scanEnd 或超时。
    /// </summary>
    public async Task ScanAsync(TimeSpan timeout, Func<JsonElement, Task> onDevice)
    {
        using var cancellation = new CancellationTokenSource(timeout);
        using var client = await ConnectAsync(cancellation.Token);
        var (reader, writer) = Open(client);
        try
        {
            await WriteRequestAsync(writer, new Dictionary<string, object?> { ["op"] = "scan" }, cancellation.Token);
            while (true)
            {
                var root = await ReadEventAsync(reader, cancellation.Token);
                var name = EventName(root);
                if (name == "scan")
                {
                    await onDevice(root);
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
        await RequestAsync(new Dictionary<string, object?>
        {
            ["op"] = "connect",
            ["deviceId"] = deviceId,
        }, "connect");

        var servicesElement = await RequestAsync(new Dictionary<string, object?>
        {
            ["op"] = "getServices",
            ["deviceId"] = deviceId,
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
            await RequestAsync(new Dictionary<string, object?>
            {
                ["op"] = "disconnect",
                ["deviceId"] = deviceId,
            }, "disconnect");
        }
        catch (Exception)
        {
            // best effort
        }
    }

    /// <summary>
    /// 读取特征值并解码 base64。
    /// </summary>
    public async Task<byte[]> ReadAsync(string deviceId, string serviceId, string characteristicId)
    {
        var element = await RequestAsync(new Dictionary<string, object?>
        {
            ["op"] = "read",
            ["deviceId"] = deviceId,
            ["serviceId"] = serviceId,
            ["characteristicId"] = characteristicId,
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
        var element = await RequestAsync(new Dictionary<string, object?>
        {
            ["op"] = "write",
            ["deviceId"] = deviceId,
            ["serviceId"] = serviceId,
            ["characteristicId"] = characteristicId,
            ["message"] = Convert.ToBase64String(buffer),
            ["withResponse"] = withResponse,
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
            await WriteRequestAsync(writer, new Dictionary<string, object?>
            {
                ["op"] = "subscribe",
                ["deviceId"] = deviceId,
                ["serviceId"] = serviceId,
                ["characteristicId"] = characteristicId,
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
        catch (Exception)
        {
            // best effort
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
            await RequestAsync(new Dictionary<string, object?>
            {
                ["op"] = "unsubscribe",
                ["deviceId"] = deviceId,
                ["serviceId"] = serviceId,
                ["characteristicId"] = characteristicId,
            }, "unsubscribed");
        }
        catch (Exception)
        {
            // best effort：订阅连接已关闭，桥端同样会清理订阅
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
        catch (Exception)
        {
            // connection closed
        }
    }

    private static async Task<JsonElement> RequestAsync(Dictionary<string, object?> request, string expectedEvent)
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

    private static (StreamReader Reader, StreamWriter Writer) Open(TcpClient client)
    {
        var stream = client.GetStream();
        var reader = new StreamReader(stream);
        var writer = new StreamWriter(stream) { AutoFlush = true };
        return (reader, writer);
    }

    private static async Task WriteRequestAsync(
        StreamWriter writer,
        Dictionary<string, object?> request,
        CancellationToken cancellation) =>
        await writer.WriteLineAsync(JsonSerializer.Serialize(request).AsMemory(), cancellation);

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

    private static string? EventName(JsonElement element) =>
        element.TryGetProperty("event", out var name) ? name.GetString() : null;

    private static JsonRpc2Exception BridgeError(JsonElement element)
    {
        var message =
            (element.TryGetProperty("error", out var error) ? error.GetString() : null) ??
            (element.TryGetProperty("message", out var text) ? text.GetString() : null) ??
            "BLE bridge error";
        return JsonRpc2Error.ApplicationError(message).ToException();
    }
}
