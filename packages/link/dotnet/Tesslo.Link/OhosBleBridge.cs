using System.Net.Sockets;
using System.Text.Json;

namespace Tesslo.Link;

public sealed record BleDevice(string DeviceId, string Name, int Rssi, string[] Services);

public sealed class OhosBleBridge
{
    private const string Host = "127.0.0.1";
    private const int Port = 20113;
    private TcpClient? _notifyClient;
    private StreamReader? _notifyReader;
    private StreamWriter? _notifyWriter;
    private Thread? _notifyThread;

    public event Action<string, string, string>? Notification;

    public bool TryScan(
        string filtersJson,
        int timeoutMs,
        out List<BleDevice> devices,
        out bool bridgeReached,
        out string? error)
    {
        devices = new List<BleDevice>();
        bridgeReached = false;
        error = null;
        try
        {
            using var client = new TcpClient();
            client.ReceiveTimeout = timeoutMs + 2000;
            client.Connect(Host, Port);
            bridgeReached = true;
            using var stream = client.GetStream();
            using var reader = new StreamReader(stream);
            using var writer = new StreamWriter(stream) {AutoFlush = true};
            writer.WriteLine("{\"op\":\"scan\"}");
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                var line = reader.ReadLine();
                if (line is null) break;
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (!root.TryGetProperty("event", out var eventElement)) continue;
                switch (eventElement.GetString())
                {
                    case "scan":
                        devices.Add(new BleDevice(
                            root.GetProperty("deviceId").GetString() ?? string.Empty,
                            root.TryGetProperty("name", out var name) ? name.GetString() ?? string.Empty : string.Empty,
                            root.TryGetProperty("rssi", out var rssi) ? rssi.GetInt32() : 0,
                            root.TryGetProperty("services", out var services) && services.ValueKind == JsonValueKind.Array
                                ? services.EnumerateArray().Select(item => item.GetString() ?? string.Empty).ToArray()
                                : Array.Empty<string>()));
                        break;
                    case "error":
                        error = root.TryGetProperty("error", out var message) ? message.GetString() : "BLE bridge error";
                        return true;
                    case "scanEnd":
                        return true;
                }
            }
            return true;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return false;
        }
    }

    public bool Connect(string deviceId, out string? error) =>
        RunCommand($"\"op\":\"connect\",\"deviceId\":\"{Escape(deviceId)}\"",
            "connect", "disconnect", out error);

    public void Disconnect(string deviceId)
    {
        try
        {
            using var client = Open(out var reader, out var writer, out _);
            if (client is null) return;
            writer.WriteLine($"{{\"op\":\"disconnect\",\"deviceId\":\"{Escape(deviceId)}\"}}");
            reader.ReadLine();
        }
        catch
        {
            // best effort
        }
    }

    public bool GetServices(string deviceId, out List<string> services, out string? error)
    {
        services = new List<string>();
        error = null;
        try
        {
            using var client = Open(out var reader, out var writer, out error);
            if (client is null) return false;
            writer.WriteLine($"{{\"op\":\"getServices\",\"deviceId\":\"{Escape(deviceId)}\"}}");
            var element = ReadEvent(reader, "services", "error", out error);
            if (element is null) return false;
            if (error is not null) return false;
            if (element.Value.TryGetProperty("serviceList", out var list) && list.ValueKind == JsonValueKind.Array)
            {
                foreach (var service in list.EnumerateArray())
                {
                    if (service.TryGetProperty("uuid", out var uuid) && uuid.GetString() is { } value)
                    {
                        services.Add(value);
                    }
                }
            }
            return true;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return false;
        }
    }

    public bool Read(string deviceId, string serviceId, string characteristicId, out string? value, out string? error)
    {
        value = null;
        error = null;
        try
        {
            using var client = Open(out var reader, out var writer, out error);
            if (client is null) return false;
            writer.WriteLine(
                $"{{\"op\":\"read\",\"deviceId\":\"{Escape(deviceId)}\",\"serviceId\":\"{Escape(serviceId)}\",\"characteristicId\":\"{Escape(characteristicId)}\"}}");
            var element = ReadEvent(reader, "read", "error", out error);
            if (element is null) return false;
            if (error is not null) return false;
            value = element.Value.TryGetProperty("value", out var payload) ? payload.GetString() ?? string.Empty : string.Empty;
            return true;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return false;
        }
    }

    public bool Write(
        string deviceId,
        string serviceId,
        string characteristicId,
        string messageBase64,
        bool withResponse,
        out int length,
        out string? error)
    {
        length = 0;
        error = null;
        try
        {
            using var client = Open(out var reader, out var writer, out error);
            if (client is null) return false;
            writer.WriteLine(
                $"{{\"op\":\"write\",\"deviceId\":\"{Escape(deviceId)}\",\"serviceId\":\"{Escape(serviceId)}\",\"characteristicId\":\"{Escape(characteristicId)}\",\"message\":\"{Escape(messageBase64)}\",\"withResponse\":{(withResponse ? "true" : "false")}}}");
            var element = ReadEvent(reader, "write", "error", out error);
            if (element is null) return false;
            if (error is not null) return false;
            length = element.Value.TryGetProperty("length", out var payload) ? payload.GetInt32() : 0;
            return true;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return false;
        }
    }

    public bool StartNotifications(string deviceId, string serviceId, string characteristicId, out string? error)
    {
        error = null;
        StopNotifications();
        try
        {
            _notifyClient = Open(out _notifyReader, out _notifyWriter, out error);
            if (_notifyClient is null) return false;
            _notifyWriter!.WriteLine(
                $"{{\"op\":\"subscribe\",\"deviceId\":\"{Escape(deviceId)}\",\"serviceId\":\"{Escape(serviceId)}\",\"characteristicId\":\"{Escape(characteristicId)}\"}}");
            var element = ReadEvent(_notifyReader!, "subscribed", "error", out error);
            if (element is null || error is not null)
            {
                StopNotifications();
                return false;
            }
            _notifyThread = new Thread(() => ReadNotifications(serviceId, characteristicId)) {IsBackground = true};
            _notifyThread.Start();
            return true;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            StopNotifications();
            return false;
        }
    }

    public void StopNotifications()
    {
        try
        {
            _notifyClient?.Close();
        }
        catch
        {
            // best effort
        }
        _notifyClient = null;
        _notifyReader = null;
        _notifyWriter = null;
        _notifyThread = null;
    }

    private void ReadNotifications(string serviceId, string characteristicId)
    {
        try
        {
            while (_notifyReader is not null)
            {
                var line = _notifyReader.ReadLine();
                if (line is null) break;
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (!root.TryGetProperty("event", out var eventElement)) continue;
                if (eventElement.GetString() != "notification") continue;
                var value = root.TryGetProperty("value", out var payload) ? payload.GetString() ?? string.Empty : string.Empty;
                Notification?.Invoke(serviceId, characteristicId, value);
            }
        }
        catch
        {
            // connection closed
        }
    }

    private static TcpClient? Open(out StreamReader reader, out StreamWriter writer, out string? error)
    {
        reader = null!;
        writer = null!;
        error = null;
        try
        {
            var client = new TcpClient();
            client.ReceiveTimeout = 8000;
            client.Connect(Host, Port);
            var stream = client.GetStream();
            reader = new StreamReader(stream);
            writer = new StreamWriter(stream) {AutoFlush = true};
            return client;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return null;
        }
    }

    private static JsonElement? ReadEvent(StreamReader reader, string expected, string errorEvent, out string? error)
    {
        error = null;
        while (true)
        {
            var line = reader.ReadLine();
            if (line is null)
            {
                error = "BLE bridge closed";
                return null;
            }
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            if (!root.TryGetProperty("event", out var eventElement)) continue;
            var name = eventElement.GetString();
            if (name == errorEvent || name == "disconnect")
            {
                error = root.TryGetProperty("error", out var message)
                    ? message.GetString()
                    : name == "disconnect" ? "peripheral disconnected"
                    : root.TryGetProperty("message", out var text) ? text.GetString() : "BLE bridge error";
                return null;
            }
            if (name == expected) return root.Clone();
        }
    }

    private static bool RunCommand(string body, string success, string failure, out string? error)
    {
        error = null;
        try
        {
            using var client = Open(out var reader, out var writer, out error);
            if (client is null) return false;
            writer.WriteLine($"{{{body}}}");
            foreach (var _ in Enumerable.Range(0, 1))
            {
                var element = ReadEvent(reader, success, "error", out error);
                if (element is not null) return true;
                if (error is not null) return false;
            }
            return false;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return false;
        }
    }

    private static string Escape(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    public static bool Matches(BleDevice device, JsonElement filters)
    {
        foreach (var filter in filters.EnumerateArray())
        {
            if (filter.ValueKind != JsonValueKind.Object) continue;
            var matched = true;
            if (filter.TryGetProperty("name", out var name) &&
                !string.Equals(device.Name, name.GetString(), StringComparison.Ordinal))
            {
                matched = false;
            }
            if (filter.TryGetProperty("namePrefix", out var prefix) &&
                !device.Name.StartsWith(prefix.GetString() ?? string.Empty, StringComparison.Ordinal))
            {
                matched = false;
            }
            if (filter.TryGetProperty("services", out var services) && services.ValueKind == JsonValueKind.Array)
            {
                var advertised = new HashSet<string>(device.Services.Select(value => value.ToLowerInvariant()));
                foreach (var service in services.EnumerateArray())
                {
                    if (!advertised.Contains((service.GetString() ?? string.Empty).ToLowerInvariant()))
                    {
                        matched = false;
                        break;
                    }
                }
            }
            if (matched) return true;
        }
        return false;
    }
}
