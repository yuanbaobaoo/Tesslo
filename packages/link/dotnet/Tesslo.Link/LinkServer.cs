using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace Tesslo.Link;

public sealed class LinkServer : IDisposable
{
    private const string ProtocolVersion = "1.3";
    private const string WebSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static readonly string LogPath = "/data/storage/el2/base/files/tesslo-link.log";
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _stop = new();
    private readonly OhosBleBridge _bleBridge = new();

    public LinkServer(int port)
    {
        _listener = new TcpListener(IPAddress.Loopback, port);
    }

    private static void Log(string message)
    {
        try { File.AppendAllText(LogPath, $"{DateTime.UtcNow:O} {message}\n"); } catch { }
    }

    public void Run()
    {
        _listener.Start();
        var endpoint = (IPEndPoint)_listener.LocalEndpoint;
        Log($"listening on {endpoint.Address}:{endpoint.Port}");
        Console.WriteLine($"tesslo-link listening on {endpoint.Address}:{endpoint.Port}");
        while (!_stop.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = _listener.AcceptTcpClient();
            }
            catch (SocketException) when (_stop.IsCancellationRequested)
            {
                break;
            }
            Log("accepted client");
            var thread = new Thread(() => HandleClient(client)) {IsBackground = true};
            thread.Start();
        }
    }

    private void HandleClient(TcpClient client)
    {
        using (client)
        {
            try
            {
                var stream = client.GetStream();
                var request = ReadHttpRequest(stream);
                Log($"request {request?.Path ?? "<null>"}");
                if (request is null)
                {
                    return;
                }
                if (request.Value.Path != "/scratch/ble" && request.Value.Path != "/scratch/bt")
                {
                    WriteHttpStatus(stream, "404 Not Found");
                    return;
                }
                if (request.Value.Key is null)
                {
                    WriteHttpStatus(stream, "400 Bad Request");
                    return;
                }

                var accept = Convert.ToBase64String(
                    Sha1.Hash(Encoding.ASCII.GetBytes(request.Value.Key + WebSocketGuid))
                );
                var response =
                    "HTTP/1.1 101 Switching Protocols\r\n" +
                    "Upgrade: websocket\r\n" +
                    "Connection: Upgrade\r\n" +
                    $"Sec-WebSocket-Accept: {accept}\r\n\r\n";
                Log("writing handshake");
                var bytes = Encoding.ASCII.GetBytes(response);
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush();
                Log("handshake sent");

                void OnNotification(string serviceId, string characteristicId, string value)
                {
                    try
                    {
                        WriteText(stream,
                            "{\"jsonrpc\":\"2.0\",\"method\":\"characteristicDidChange\",\"params\":" +
                            $"{{\"serviceId\":\"{Escape(serviceId)}\",\"characteristicId\":\"{Escape(characteristicId)}\",\"message\":\"{Escape(value)}\",\"encoding\":\"base64\"}}}}");
                    }
                    catch
                    {
                        // client disconnected
                    }
                }

                _bleBridge.Notification += OnNotification;
                try
                {
                    while (!_stop.IsCancellationRequested)
                    {
                        var text = ReadTextFrame(stream);
                        if (text is null) break;
                        HandleRpc(stream, text);
                    }
                }
                finally
                {
                    _bleBridge.Notification -= OnNotification;
                    _bleBridge.StopNotifications();
                }
            }
            catch (IOException error)
            {
                Log($"io error {error.Message}");
            }
            catch (Exception error)
            {
                Log($"client error {error}");
            }
        }
    }

    private void HandleRpc(NetworkStream stream, string text)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            WriteText(stream, "{\"jsonrpc\":\"2.0\",\"id\":null,\"error\":{\"code\":-32700,\"message\":\"Parse error\"}}");
            return;
        }

        using (document)
        {
            var root = document.RootElement;
            if (!root.TryGetProperty("id", out var idElement)) return;
            var id = idElement.GetRawText();
            var method = root.TryGetProperty("method", out var methodElement)
                ? methodElement.GetString() ?? string.Empty
                : string.Empty;

            switch (method)
            {
                case "getVersion":
                    WriteResult(stream, id, $"{{\"protocol\":\"{ProtocolVersion}\"}}");
                    break;
                case "discover":
                    if (!HasFilters(root))
                    {
                        WriteError(stream, id, -32602, "discover requires at least one filter");
                        break;
                    }
                    var filters = root.GetProperty("params").GetProperty("filters");
                    var bridged = _bleBridge.TryScan(filters.GetRawText(), 4500, out var devices,
                        out var bridgeReached, out var bridgeError);
                    Log($"discover bridgeReached={bridgeReached} error={bridgeError ?? "-"} devices={devices.Count}");
                    if (bridged)
                    {
                        if (bridgeError is not null)
                        {
                            WriteError(stream, id, -32000, bridgeError);
                            break;
                        }
                        WriteResult(stream, id, "null");
                        foreach (var device in devices.Where(device => OhosBleBridge.Matches(device, filters)))
                        {
                            WriteText(stream,
                                "{\"jsonrpc\":\"2.0\",\"method\":\"didDiscoverPeripheral\",\"params\":" +
                                $"{{\"peripheralId\":\"{Escape(device.DeviceId)}\",\"name\":\"{Escape(device.Name)}\",\"rssi\":{device.Rssi}}}}}");
                        }
                        break;
                    }
                    WriteResult(stream, id, "null");
                    WriteText(stream,
                        "{\"jsonrpc\":\"2.0\",\"method\":\"didDiscoverPeripheral\",\"params\":" +
                        "{\"peripheralId\":\"tesslo-fake-microbit\",\"name\":\"Tesslo Fake micro:bit\",\"rssi\":-60}}");
                    break;
                case "connect":
                {
                    var deviceId = Param(root, "deviceId");
                    if (deviceId.Length == 0)
                    {
                        WriteError(stream, id, -32602, "connect requires deviceId");
                        break;
                    }
                    if (_bleBridge.Connect(deviceId, out var connectError))
                    {
                        WriteResult(stream, id, "null");
                    }
                    else
                    {
                        WriteError(stream, id, -32000, connectError ?? "connect failed");
                    }
                    break;
                }
                case "getServices":
                {
                    var deviceId = Param(root, "deviceId");
                    if (_bleBridge.GetServices(deviceId, out var services, out var servicesError))
                    {
                        WriteResult(stream, id, "[" + string.Join(",", services.Select(item => $"\"{Escape(item)}\"")) + "]");
                    }
                    else
                    {
                        WriteError(stream, id, -32000, servicesError ?? "getServices failed");
                    }
                    break;
                }
                case "read":
                {
                    var serviceId = Param(root, "serviceId");
                    var characteristicId = Param(root, "characteristicId");
                    if (_bleBridge.Read(Param(root, "deviceId"), serviceId, characteristicId, out var value,
                            out var readError))
                    {
                        WriteResult(stream, id, $"{{\"message\":\"{Escape(value ?? string.Empty)}\",\"encoding\":\"base64\"}}");
                    }
                    else
                    {
                        WriteError(stream, id, -32000, readError ?? "read failed");
                    }
                    break;
                }
                case "write":
                {
                    var message = Param(root, "message");
                    var encoding = Param(root, "encoding");
                    var withResponse = root.TryGetProperty("params", out var writeParams) &&
                                       writeParams.TryGetProperty("withResponse", out var flag) &&
                                       flag.ValueKind == JsonValueKind.True;
                    if (!string.Equals(encoding, "base64", StringComparison.OrdinalIgnoreCase))
                    {
                        message = Convert.ToBase64String(Encoding.UTF8.GetBytes(message));
                    }
                    if (_bleBridge.Write(Param(root, "deviceId"), Param(root, "serviceId"),
                            Param(root, "characteristicId"), message, withResponse, out var length, out var writeError))
                    {
                        WriteResult(stream, id, length.ToString());
                    }
                    else
                    {
                        WriteError(stream, id, -32000, writeError ?? "write failed");
                    }
                    break;
                }
                case "startNotifications":
                {
                    if (_bleBridge.StartNotifications(Param(root, "deviceId"), Param(root, "serviceId"),
                            Param(root, "characteristicId"), out var notificationError))
                    {
                        WriteResult(stream, id, "null");
                    }
                    else
                    {
                        WriteError(stream, id, -32000, notificationError ?? "startNotifications failed");
                    }
                    break;
                }
                case "stopNotifications":
                    _bleBridge.StopNotifications();
                    WriteResult(stream, id, "null");
                    break;
                default:
                    WriteError(stream, id, -32601, $"Method not found: {method}");
                    break;
            }
        }
    }

    private static string Param(JsonElement root, string name) =>
        root.TryGetProperty("params", out var parameters) &&
        parameters.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : string.Empty;

    private static string Escape(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private static bool HasFilters(JsonElement root) =>
        root.TryGetProperty("params", out var parameters) &&
        parameters.TryGetProperty("filters", out var filters) &&
        filters.ValueKind == JsonValueKind.Array &&
        filters.GetArrayLength() > 0;

    private static void WriteResult(NetworkStream stream, string id, string result) =>
        WriteText(stream, $"{{\"jsonrpc\":\"2.0\",\"id\":{id},\"result\":{result}}}");

    private static void WriteError(NetworkStream stream, string id, int code, string message) =>
        WriteText(stream,
            $"{{\"jsonrpc\":\"2.0\",\"id\":{id},\"error\":{{\"code\":{code},\"message\":\"{message}\"}}}}");

    private static (string Path, string? Key)? ReadHttpRequest(NetworkStream stream)
    {
        var buffer = new List<byte>(1024);
        var one = new byte[1];
        while (buffer.Count < 16384)
        {
            if (stream.Read(one, 0, 1) == 0) return null;
            buffer.Add(one[0]);
            if (buffer.Count >= 4 &&
                buffer[^4] == '\r' && buffer[^3] == '\n' &&
                buffer[^2] == '\r' && buffer[^1] == '\n')
            {
                break;
            }
        }

        var request = Encoding.ASCII.GetString(buffer.ToArray());
        var lines = request.Split("\r\n");
        var requestLine = lines[0].Split(' ');
        if (requestLine.Length < 2) return null;
        var keyLine = lines.FirstOrDefault(line =>
            line.TrimStart().StartsWith("Sec-WebSocket-Key", StringComparison.OrdinalIgnoreCase));
        var key = keyLine?.Split(':', 2)[1].Trim();
        return (requestLine[1], key);
    }

    private static void WriteHttpStatus(NetworkStream stream, string status)
    {
        var response = $"HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        var bytes = Encoding.ASCII.GetBytes(response);
        stream.Write(bytes, 0, bytes.Length);
    }

    private static string? ReadTextFrame(NetworkStream stream)
    {
        var header = new byte[2];
        if (!ReadExact(stream, header)) return null;
        var opcode = header[0] & 0x0f;
        var masked = (header[1] & 0x80) != 0;
        long length = header[1] & 0x7f;
        if (length == 126)
        {
            var extended = new byte[2];
            if (!ReadExact(stream, extended)) return null;
            length = (extended[0] << 8) | extended[1];
        }
        else if (length == 127)
        {
            var extended = new byte[8];
            if (!ReadExact(stream, extended)) return null;
            length = 0;
            foreach (var value in extended) length = (length << 8) | value;
        }

        var mask = new byte[4];
        if (masked && !ReadExact(stream, mask)) return null;
        var payload = new byte[length];
        if (!ReadExact(stream, payload)) return null;
        if (masked)
        {
            for (var index = 0; index < payload.Length; index++)
            {
                payload[index] ^= mask[index % 4];
            }
        }

        if (opcode == 0x8) return null;
        if (opcode == 0x9)
        {
            WriteFrame(stream, 0xA, payload);
            return ReadTextFrame(stream);
        }
        if (opcode != 0x1) return ReadTextFrame(stream);
        return Encoding.UTF8.GetString(payload);
    }

    private static void WriteText(NetworkStream stream, string text) =>
        WriteFrame(stream, 0x1, Encoding.UTF8.GetBytes(text));

    private static void WriteFrame(NetworkStream stream, byte opcode, byte[] payload)
    {
        using var frame = new MemoryStream();
        frame.WriteByte((byte)(0x80 | opcode));
        if (payload.Length < 126)
        {
            frame.WriteByte((byte)payload.Length);
        }
        else if (payload.Length <= ushort.MaxValue)
        {
            frame.WriteByte(126);
            frame.WriteByte((byte)(payload.Length >> 8));
            frame.WriteByte((byte)payload.Length);
        }
        else
        {
            frame.WriteByte(127);
            for (var shift = 56; shift >= 0; shift -= 8)
            {
                frame.WriteByte((byte)((long)payload.Length >> shift));
            }
        }
        frame.Write(payload);
        var bytes = frame.ToArray();
        stream.Write(bytes, 0, bytes.Length);
        stream.Flush();
    }

    private static bool ReadExact(NetworkStream stream, byte[] buffer)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = stream.Read(buffer, offset, buffer.Length - offset);
            if (read == 0) return false;
            offset += read;
        }
        return true;
    }

    public void Dispose()
    {
        _stop.Cancel();
        _listener.Stop();
        _stop.Dispose();
    }
}
