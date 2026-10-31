// 桥协议 JSON 的源生成序列化上下文：NativeAOT 下不依赖运行时反射序列化。
// 仅覆盖出站请求；入站事件用 JsonDocument 手工解析（无反射）。

namespace ScratchLink.Ohos.BLE;

using System.Text.Json.Serialization;

[JsonSourceGenerationOptions(DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(BridgeRequest))]
internal sealed partial class BridgeJsonContext : JsonSerializerContext;
