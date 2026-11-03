// <copyright file="JsonRpcJsonContext.cs" company="Scratch Foundation">
// Copyright (c) Scratch Foundation. All rights reserved.
// </copyright>

#if SCRATCHLINK_AOT

namespace ScratchLink.JsonRpc;

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using ScratchLink.BLE;
using ScratchLink.BT;

/// <summary>
/// Source-generated JSON metadata for JSON-RPC envelopes and outgoing payloads.
/// NativeAOT disables reflection-based serialization, so every runtime type that can
/// appear in a JSON-RPC message must be registered here.
/// </summary>
[JsonSourceGenerationOptions(DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(JsonRpc2Message))]
[JsonSerializable(typeof(JsonRpc2Request))]
[JsonSerializable(typeof(JsonRpc2Response))]
[JsonSerializable(typeof(JsonRpc2Error))]
[JsonSerializable(typeof(BLEPeripheralDiscovered))]
[JsonSerializable(typeof(BTPeripheralDiscovered))]
[JsonSerializable(typeof(BTMessageReceived))]
[JsonSerializable(typeof(Dictionary<string, string>))]
[JsonSerializable(typeof(List<string>))]
[JsonSerializable(typeof(JsonElement))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(bool))]
[JsonSerializable(typeof(sbyte))]
[JsonSerializable(typeof(byte))]
[JsonSerializable(typeof(short))]
[JsonSerializable(typeof(ushort))]
[JsonSerializable(typeof(int))]
[JsonSerializable(typeof(uint))]
[JsonSerializable(typeof(long))]
[JsonSerializable(typeof(ulong))]
[JsonSerializable(typeof(float))]
[JsonSerializable(typeof(double))]
[JsonSerializable(typeof(decimal))]
[JsonSerializable(typeof(Guid))]
[JsonSerializable(typeof(byte[]))]
internal sealed partial class JsonRpcJsonContext : JsonSerializerContext;

#endif
