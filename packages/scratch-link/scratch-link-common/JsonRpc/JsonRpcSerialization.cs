// <copyright file="JsonRpcSerialization.cs" company="Scratch Foundation">
// Copyright (c) Scratch Foundation. All rights reserved.
// </copyright>

#if SCRATCHLINK_AOT

namespace ScratchLink.JsonRpc;

using System.Text.Json;
using ScratchLink.JsonRpc.Converters;

/// <summary>
/// Shared JSON options for JSON-RPC I/O.
/// Reading needs the message-type discriminator converter; writing must not reuse it,
/// otherwise serializing a base <see cref="JsonRpc2Message"/> re-enters the converter.
/// </summary>
internal static class JsonRpcSerialization
{
    /// <summary>
    /// Options for decoding incoming messages.
    /// </summary>
    public static readonly JsonSerializerOptions ReadOptions = new ()
    {
        Converters = { new JsonRpc2MessageConverter(), new JsonRpc2ValueConverter() },
        TypeInfoResolver = JsonRpcJsonContext.Default,
    };

    /// <summary>
    /// Options for encoding outgoing messages.
    /// </summary>
    public static readonly JsonSerializerOptions WriteOptions = new ()
    {
        Converters = { new JsonRpc2ValueConverter() },
        TypeInfoResolver = JsonRpcJsonContext.Default,
    };
}

#endif
