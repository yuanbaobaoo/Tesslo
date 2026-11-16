// <copyright file="JsonRpc2MessageConverter.cs" company="Scratch Foundation">
// Copyright (c) Scratch Foundation. All rights reserved.
// </copyright>

namespace ScratchLink.JsonRpc.Converters;

using System;
using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>
/// Converter for deserializing JSON-RPC Request, Notification, and Response objects.
/// This converter will inspect the incoming message to determine which kind of object it is, then delegate to deserializing that kind of object.
/// </summary>
internal class JsonRpc2MessageConverter : JsonConverter<JsonRpc2Message>
{
#if SCRATCHLINK_AOT
    /// <summary>
    /// Reads and converts the JSON to a specific kind of message (Request, Notification, or Response).
    /// NativeAOT 禁用反射序列化：用 JsonDocument 判别类型，再按源生成 TypeInfo 反序列化。
    /// </summary>
    /// <inheritdoc/>
    public override JsonRpc2Message Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        // Peek at a copy of the reader: the original must stay at the message start for the typed deserialize below.
        var discriminatorReader = reader;
        using var document = JsonDocument.ParseValue(ref discriminatorReader);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new JsonException("JSON-RPC message must be a JSON object");
        }

        Type? guessedType = null;
        if (root.TryGetProperty("error", out _) || root.TryGetProperty("result", out _))
        {
            guessedType = typeof(JsonRpc2Response);
        }
        else if (root.TryGetProperty("method", out _))
        {
            guessedType = typeof(JsonRpc2Request);
        }

        if (guessedType == null)
        {
            throw new JsonException("could not identify JSON-RPC message type");
        }

        var message = JsonSerializer.Deserialize(ref reader, options.GetTypeInfo(guessedType)) as JsonRpc2Message;
        return message ?? throw new JsonException("could not deserialize JSON-RPC message");
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, JsonRpc2Message value, JsonSerializerOptions options)
    {
        // WriteOptions 不包含本 converter，避免序列化基类消息时再次进入 Read/Write 自身
        JsonSerializer.Serialize(writer, value, JsonRpcSerialization.WriteOptions.GetTypeInfo(value.GetType()));
    }
#else
    /// <summary>
    /// Reads and converts the JSON to a specific kind of message (Request, Notification, or Response).
    /// </summary>
    /// <inheritdoc/>
    public override JsonRpc2Message Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var discriminatorReader = reader;
        var discriminator = JsonSerializer.Deserialize<MessageTypeDiscriminator>(ref discriminatorReader);

        var guessedType = discriminator.GuessMessageType();
        if (guessedType == null)
        {
            throw new JsonException("could not identify JSON-RPC message type");
        }

        // WARNING: implementing CanConvert() too permissively in this class can turn this Deserialize call into infinite recursion!
        return (JsonRpc2Message)JsonSerializer.Deserialize(ref reader, guessedType, options);
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, JsonRpc2Message value, JsonSerializerOptions options) => JsonSerializer.Serialize(writer, value, options);

    private class MessageTypeDiscriminator : JsonRpc2Message
    {
        [JsonPropertyName("error")]
        public JsonRpc2Error Error { get; set; }

        public Type GuessMessageType()
        {
            if (this.Error != null || this.ExtraProperties.ContainsKey("result"))
            {
                return typeof(JsonRpc2Response);
            }

            if (this.ExtraProperties.ContainsKey("method"))
            {
                return typeof(JsonRpc2Request);
            }

            return null;
        }
    }
#endif
}
