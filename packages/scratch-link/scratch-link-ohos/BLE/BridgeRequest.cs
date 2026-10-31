// 发往设备内 BLE 桥（BleTcpBridge.ets）的请求行 DTO，字段与桥的 BridgeCommand 对应；
// null 字段序列化时省略，桥侧按缺省值处理。

namespace ScratchLink.Ohos.BLE;

using System.Text.Json.Serialization;

internal sealed class BridgeRequest
{
    [JsonPropertyName("op")]
    public string? Op { get; set; }

    [JsonPropertyName("deviceId")]
    public string? DeviceId { get; set; }

    [JsonPropertyName("serviceId")]
    public string? ServiceId { get; set; }

    [JsonPropertyName("characteristicId")]
    public string? CharacteristicId { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("withResponse")]
    public bool? WithResponse { get; set; }
}
