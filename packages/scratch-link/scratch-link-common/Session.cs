// <copyright file="Session.cs" company="Scratch Foundation">
// Copyright (c) Scratch Foundation. All rights reserved.
// </copyright>

namespace ScratchLink;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Fleck;
using ScratchLink.Extensions;
using ScratchLink.JsonRpc;
using ScratchLink.JsonRpc.Converters;

using JsonRpcMethodHandler = System.Func<
    string, // method name
    System.Text.Json.JsonElement?, // params / args
    System.Threading.Tasks.Task<object> // return value - must be JSON-serializable
>;

using RequestId = System.UInt32;

/// <summary>
/// Base class for Scratch Link sessions.
/// </summary>
public class Session : IDisposable
{
    /// <summary>
    /// Specifies the Scratch Link network protocol version. Note that this is not the application version.
    /// Keep this in sync with the version number in `NetworkProtocol.md`.
    /// </summary>
    protected const string NetworkProtocolVersion = "1.2";

    /// <summary>
    /// Default timeout for remote requests.
    /// </summary>
    protected static readonly TimeSpan DefaultRequestTimeout = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Default timeout for waiting on a lock, like when trying to send a message while another message is already sending.
    /// </summary>
    protected static readonly TimeSpan DefaultLockTimeout = TimeSpan.FromMilliseconds(500);

    private const int MessageSizeLimit = 1024 * 1024; // 1 MiB

    private readonly IWebSocketConnection webSocket;

#if !SCRATCHLINK_AOT
    private readonly JsonSerializerOptions deserializerOptions = new ()
    {
        Converters = { new JsonRpc2MessageConverter(), new JsonRpc2ValueConverter() },
    };
#endif

    private readonly SemaphoreSlim websocketSendLock = new (1);

    private readonly ConcurrentDictionary<RequestId, PendingRequestRecord> pendingRequests = new ();
    private RequestId nextId = 1; // some clients have trouble with ID=0

    /// <summary>
    /// Initializes a new instance of the <see cref="Session"/> class.
    /// </summary>
    /// <param name="webSocket">The WebSocket which this session will use for communication.</param>
    public Session(IWebSocketConnection webSocket)
    {
        this.webSocket = webSocket;
        this.Handlers["getVersion"] = this.HandleGetVersion;
        this.Handlers["pingMe"] = this.HandlePingMe;
        Trace.WriteLine("session started");
    }

    /// <summary>
    /// Gets a value indicating whether returns true if the backing WebSocket is open for communication.
    /// Returns false if the backing WebSocket is closed or closing, or is in an unknown state.
    /// </summary>
    public bool IsOpen => this.webSocket.IsAvailable;

    /// <summary>
    /// Gets a value indicating whether <see cref="Dispose(bool)"/> has already been called and completed on this session.
    /// </summary>
    protected bool DisposedValue { get; private set; }

    /// <summary>
    /// Gets the mapping from method names to handlers.
    /// </summary>
    protected Dictionary<string, JsonRpcMethodHandler> Handlers { get; } = new ();

    /// <summary>
    /// Tell the session to take ownership of the WebSocket context and begin communication.
    /// The session will do its work on a background thread.
    /// After calling this function, do not use the WebSocket context owned by this session.
    /// </summary>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    public Task Run()
    {
        var runCompletion = new TaskCompletionSource<bool>();

        this.webSocket.OnClose = () =>
        {
            runCompletion.TrySetResult(true);
        };
        this.webSocket.OnMessage = async messageString =>
        {
            await this.HandleIncomingMessage(() => DeserializeMessage(messageString));
        };
        this.webSocket.OnBinary = async messageBytes =>
        {
            await this.HandleIncomingMessage(() => DeserializeMessage(messageBytes));
        };

        Trace.WriteLine("session running");

        // wait for OnClose() to mark the task as completed
        return runCompletion.Task;
    }

    /// <summary>
    /// Decode one JSON-RPC message.
    /// </summary>
    /// <param name="message">UTF-8 JSON text.</param>
    /// <returns>The decoded message, or null if the payload has no message shape.</returns>
    private JsonRpc2Message? DeserializeMessage(string message)
    {
#if SCRATCHLINK_AOT
        return JsonSerializer.Deserialize(
            message,
            JsonRpcSerialization.ReadOptions.GetTypeInfo(typeof(JsonRpc2Message))) as JsonRpc2Message;
#else
        return JsonSerializer.Deserialize<JsonRpc2Message>(message, this.deserializerOptions);
#endif
    }

    /// <summary>
    /// Decode one binary JSON-RPC message.
    /// </summary>
    /// <param name="message">UTF-8 JSON bytes.</param>
    /// <returns>The decoded message, or null if the payload has no message shape.</returns>
    private JsonRpc2Message? DeserializeMessage(ReadOnlySpan<byte> message)
    {
#if SCRATCHLINK_AOT
        return JsonSerializer.Deserialize(
            message,
            JsonRpcSerialization.ReadOptions.GetTypeInfo(typeof(JsonRpc2Message))) as JsonRpc2Message;
#else
        return JsonSerializer.Deserialize<JsonRpc2Message>(message, this.deserializerOptions);
#endif
    }

    /// <summary>
    /// Encode a JSON-RPC request.
    /// </summary>
    /// <param name="request">Request or notification to encode.</param>
    /// <returns>Serialized JSON text.</returns>
    private static string SerializeRequest(JsonRpc2Request request)
    {
#if SCRATCHLINK_AOT
        return JsonSerializer.Serialize(
            request,
            JsonRpcSerialization.WriteOptions.GetTypeInfo(typeof(JsonRpc2Request)));
#else
        return JsonSerializer.Serialize(request);
#endif
    }

    /// <summary>
    /// Encode a JSON-RPC response.
    /// </summary>
    /// <param name="message">Response message to encode.</param>
    /// <returns>Serialized JSON text.</returns>
    private static string SerializeMessage(JsonRpc2Message message)
    {
#if SCRATCHLINK_AOT
        return JsonSerializer.Serialize(
            message,
            JsonRpcSerialization.WriteOptions.GetTypeInfo(typeof(JsonRpc2Message)));
#else
        return JsonSerializer.Serialize(message);
#endif
    }

    /// <summary>
    /// Decode and dispatch one incoming message.
    /// Fleck calls the message callback as async void, so every failure must be contained here:
    /// a malformed or unsupported message becomes a JSON-RPC parse error instead of a process abort.
    /// </summary>
    /// <param name="deserialize">Deserializer bound to the current text or binary message.</param>
    /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
    private async Task HandleIncomingMessage(Func<JsonRpc2Message?> deserialize)
    {
        JsonRpc2Message? message;
        try
        {
            message = deserialize();
        }
        catch (Exception e)
        {
            Trace.WriteLine($"Failed to parse JSON-RPC message: {e}");
            await this.SendResponse(null, null, JsonRpc2Error.ParseError(e.Message));
            return;
        }

        if (message == null)
        {
            await this.SendResponse(null, null, JsonRpc2Error.ParseError("empty JSON-RPC message"));
            return;
        }

        try
        {
            await this.HandleMessage(message);
        }
        catch (Exception e)
        {
            // HandleRequest 已兜底业务异常；这里只防最后一道意外，绝不能冒泡到 async void
            Trace.WriteLine($"Failed to handle JSON-RPC message: {e}");
        }
    }

    /// <summary>
    /// Stop all communication and shut down the session. Do not use the session after this.
    /// </summary>
    public void Dispose()
    {
        // Do not change this code. Put cleanup code in 'Dispose(bool disposing)' method
        this.Dispose(disposing: true);
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// End this session. This will cause Run() to finish, and Run()'s caller should then Dispose() of this instance.
    /// </summary>
    public void EndSession()
    {
        this.webSocket.Close();
        Trace.WriteLine("session ended");
    }

    /// <summary>
    /// Implement the Disposable pattern for this session.
    /// If <paramref name="disposing"/> is true and <see cref="DisposedValue"/> is false, free any managed resources.
    /// In all cases, call <see cref="Dispose(bool)"/> on <c>base</c> as the last step.
    /// </summary>
    /// <param name="disposing">True if called from <see cref="Dispose()"/>.</param>
    protected virtual void Dispose(bool disposing)
    {
        Trace.WriteLine("session disposing");
        if (!this.DisposedValue)
        {
            if (disposing)
            {
                this.webSocket.Close();
            }

            this.DisposedValue = true;
        }
    }

    /// <summary>
    /// In DEBUG builds, wrap an event handler with a try/catch which reports the exception using SendErrorNotifiation.
    /// Otherwise, return the original event handler without modification.
    /// </summary>
    /// <remarks>
    /// This could theoretically leak sensitive information. Use only for debugging.
    /// </remarks>
    /// <param name="original">The original event handler, to be wrapped.</param>
    /// <returns>The wrapped event handler.</returns>
    protected EventHandler WrapEventHandler(EventHandler original)
    {
#if DEBUG
        return (object sender, EventArgs args) =>
        {
            try
            {
                original(sender, args);
            }
            catch (Exception e)
            {
                this.SendEventExceptionNotification(e);
            }
        };
#else
        return original;
#endif
    }

    /// <summary>
    /// In DEBUG builds, wrap an event handler with a try/catch which reports the exception using SendErrorNotifiation.
    /// Otherwise, return the original event handler without modification.
    /// </summary>
    /// <remarks>
    /// This could theoretically leak sensitive information. Use only for debugging.
    /// </remarks>
    /// <typeparam name="T">The type of event args associated with the event handler.</typeparam>
    /// <param name="original">The original event handler, to be wrapped.</param>
    /// <returns>The wrapped event handler.</returns>
    protected EventHandler<T> WrapEventHandler<T>(EventHandler<T> original)
    {
#if DEBUG
        return (object sender, T args) =>
        {
            try
            {
                original(sender, args);
            }
            catch (Exception e)
            {
                this.SendEventExceptionNotification(e);
            }
        };
#else
        return original;
#endif
    }

    /// <summary>
    /// In DEBUG builds, wrap an event handler with a try/catch which reports the exception using SendErrorNotifiation.
    /// Otherwise, return the original event handler without modification.
    /// This version wraps an async handler. Make sure any async handler returns <see cref="Task"/>.
    /// </summary>
    /// <remarks>
    /// This could theoretically leak sensitive information. Use only for debugging.
    /// </remarks>
    /// <typeparam name="T">The type of event args associated with the event handler.</typeparam>
    /// <param name="original">The original event handler, to be wrapped.</param>
    /// <returns>The wrapped event handler.</returns>
    protected EventHandler<T> WrapEventHandler<T>(Func<object, T, Task> original)
    {
#if DEBUG
        return async (object sender, T args) =>
        {
            try
            {
                await original(sender, args);
            }
            catch (Exception e)
            {
                this.SendEventExceptionNotification(e);
            }
        };
#else
        return (object sender, T args) => { original(sender, args); };
#endif
    }

    /// <summary>
    /// Handle a "getVersion" request.
    /// </summary>
    /// <param name="methodName">The name of the method called (expected: "getVersion").</param>
    /// <param name="args">Any arguments passed to the method by the caller (expected: none).</param>
    /// <returns>A string representing the protocol version.</returns>
    protected Task<object> HandleGetVersion(string methodName, JsonElement? args)
    {
        return Task.FromResult<object>(new Dictionary<string, string>
        {
            { "protocol", NetworkProtocolVersion },
        });
    }

    /// <summary>
    /// Handle a "pingMe" request by returning "willPing" and following up with a separate "ping" request.
    /// </summary>
    /// <param name="methodName">The name of the method called (expected: "pingMe").</param>
    /// <param name="args">Any arguments passed to the method by the caller (expected: none).</param>
    /// <returns>The string "willPing".</returns>
    protected Task<object> HandlePingMe(string methodName, JsonElement? args)
    {
        Task.Run(async () =>
        {
            try
            {
                var pingResult = await this.SendRequest("ping", null);
                Trace.WriteLine($"Got result from ping: {pingResult}");
            }
            catch (JsonRpc2Exception e)
            {
                Trace.WriteLine($"Got JSON-RPC error from ping: {e.Error}");
            }
            catch (Exception e)
            {
                Trace.WriteLine($"Got unrecognized exception from ping: {e}");
            }
        });
        return Task.FromResult<object>("willPing");
    }

    /// <summary>
    /// Send a notification to the client. A notification has no return value.
    /// </summary>
    /// <param name="method">The name of the method to call on the client.</param>
    /// <param name="parameters">The optional parameters to pass to the client method.</param>
    /// <returns>A <see cref="Task"/> representing the result of the asynchronous operation.</returns>
    protected async Task SendNotification(string method, object parameters)
    {
        var request = new JsonRpc2Request
        {
            Method = method,
            Params = parameters,
        };

        var message = SerializeRequest(request);

        await this.SocketSend(message);
    }

    /// <summary>
    /// Inform the client of an error. This is sent as an independent notification, not in response to a request.
    /// </summary>
    /// <param name="error">An object containing information about the error.</param>
    /// <returns>A <see cref="Task"/> representing the result of the asynchronous operation.</returns>
    protected async Task SendErrorNotification(JsonRpc2Error error)
    {
        await this.SendResponse(null, null, error);
    }

    /// <summary>
    /// Send a request to the client and return the result.
    /// Cancel the request if DefaultRequestTimeout passes before receiving a response.
    /// </summary>
    /// <param name="method">The name of the method to call on the client.</param>
    /// <param name="parameters">The optional parameters to pass to the client method.</param>
    /// <returns>A <see cref="Task"/> resulting in the value returned by the client.</returns>
    protected async Task<object> SendRequest(string method, object parameters)
    {
        return await this.SendRequest(method, parameters, DefaultRequestTimeout);
    }

    /// <summary>
    /// Send a request to the client and return the result.
    /// </summary>
    /// <param name="method">The name of the method to call on the client.</param>
    /// <param name="parameters">The optional parameters to pass to the client method.</param>
    /// <param name="timeout">Cancel the request if this much time passes before receiving a response.</param>
    /// <returns>A <see cref="Task"/> resulting in the value returned by the client.</returns>
    protected async Task<object> SendRequest(string method, object parameters, TimeSpan timeout)
    {
        var requestId = this.GetNextId();
        var request = new JsonRpc2Request
        {
            Method = method,
            Params = parameters,
            Id = requestId,
        };

        var message = SerializeRequest(request);

        using var pendingRequest = new PendingRequestRecord(timeout);

        // register the pending request BEFORE sending the request, just in case the response comes back before we get back from awaiting `SocketSend`
        this.pendingRequests[requestId] = pendingRequest;

        try
        {
            await this.SocketSend(message);
            return await pendingRequest.Task;
        }
        catch (Exception e)
        {
            Trace.WriteLine($"Exception trying to send request: {method}, params={parameters}");
            pendingRequest.TrySetException(e);
            throw;
        }
        finally
        {
            this.pendingRequests.TryRemove(requestId, out _);
        }
    }

#if DEBUG
    private void SendEventExceptionNotification(Exception e)
    {
        try
        {
            _ = this.SendErrorNotification(JsonRpc2Error.InternalError(e.ToString()));
        }
        catch (Exception)
        {
            // ignored: the socket is probably closed so there's nothing to do
        }
    }
#endif

    private Task<object> HandleUnrecognizedMethod(string methodName, JsonElement? args)
    {
        throw JsonRpc2Error.MethodNotFound(methodName).ToException();
    }

    private async Task HandleRequest(JsonRpc2Request request)
    {
        var handler = this.Handlers.GetValueOrDefault(request.Method, this.HandleUnrecognizedMethod);

        object result = null;
        JsonRpc2Error error = null;

        try
        {
            // Trace.WriteLine($"handling: {request.Method}");
            result = await handler(request.Method, request.Params as JsonElement?);
        }
        catch (JsonRpc2Exception e)
        {
            Trace.WriteLine($"JsonRpc2Exception: {e}", e.StackTrace);
            error = e.Error;
        }
        catch (OperationCanceledException e)
        {
            Trace.WriteLine($"OperationCanceledException: {e}", e.StackTrace);
            error = JsonRpc2Error.ApplicationError("operation canceled");
        }
        catch (TimeoutException e)
        {
            Trace.WriteLine($"TimeoutException: {e}", e.StackTrace);
            error = JsonRpc2Error.ApplicationError("timeout");
        }
        catch (Exception e)
        {
            Trace.WriteLine($"Exception encountered during call: {e}", e.StackTrace);
#if DEBUG
            error = JsonRpc2Error.ApplicationError($"unhandled error encountered during call: {e}");
#else
            error = JsonRpc2Error.ApplicationError($"unhandled error encountered during call");
#endif
        }

        if (request.Id is object requestId)
        {
            await this.SendResponse(requestId, result, error);
        }
    }

    private void HandleResponse(JsonRpc2Response response)
    {
        RequestId responseId;
        try
        {
            // the redundant-looking cast is for unboxing
            responseId = (RequestId)Convert.ChangeType(response.Id, typeof(RequestId));
        }
        catch (Exception)
        {
            Trace.WriteLine($"Response appears to have invalid ID = {response.Id}");
            return;
        }

        var requestRecord = this.pendingRequests.GetValueOrDefault(responseId, null);
        if (requestRecord == null)
        {
            Trace.WriteLine($"Could not find request record with ID = {response.Id}");
            return;
        }

        requestRecord.TrySetResult(response.Error, response.Result);
    }

    private async Task SendResponse(object id, object result, JsonRpc2Error error)
    {
        var response = new JsonRpc2Message
        {
            Id = id,
            ExtraProperties = new (),
        };

        // handling "result" this way, instead of using JsonRpc2Response, means we can send "result: null" iff both result and error are null
        if (error == null)
        {
            response.ExtraProperties["result"] = result;
        }
        else
        {
            response.ExtraProperties["error"] = error;
        }

        try
        {
            var responseString = SerializeMessage(response);

            try
            {
                await this.SocketSend(responseString);
            }
            catch (Exception e)
            {
                Trace.WriteLine($"Failed to send serialized response due to {e}");
            }
        }
        catch (Exception e)
        {
            Trace.WriteLine($"Failed to serialize response: {response} due to {e}");
        }
    }

    private RequestId GetNextId()
    {
        return this.nextId++;
    }

    private async Task SocketSend(string message)
    {
        try
        {
            using (await this.websocketSendLock.WaitDisposableAsync(DefaultLockTimeout))
            {
                if (this.webSocket.IsAvailable)
                {
                    await this.webSocket.Send(message);
                }
            }
        }
        catch (Exception)
        {
            // This might mean the socked closed unexpectedly, or it could mean that it was closed
            // intentionally and a notification just happened to come in before it fully shut down.
            // That happens frequently with BLE change notifications.
            Trace.WriteLine("Failed to send a message to a socket.");
        }
    }

    private async Task HandleMessage(JsonRpc2Message message)
    {
        if (message is JsonRpc2Request request)
        {
            await this.HandleRequest(request);
        }
        else if (message is JsonRpc2Response response)
        {
            this.HandleResponse(response);
        }
        else
        {
            Trace.WriteLine("Received a message which was not recognized as a Request or Response");
        }
    }

    private class PendingRequestRecord : IDisposable
    {
        private readonly TaskCompletionSource<object> completionSource;

        private readonly CancellationTokenSource cancellationTokenSource;
        private readonly CancellationTokenSource timeoutSource;

        public PendingRequestRecord(TimeSpan timeout)
        {
            this.completionSource = new ();
            this.cancellationTokenSource = new CancellationTokenSource();
            this.cancellationTokenSource.Token.Register(() => this.completionSource.TrySetCanceled(), useSynchronizationContext: false);
            if (timeout != Timeout.InfiniteTimeSpan)
            {
                this.timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(this.cancellationTokenSource.Token);
                this.timeoutSource.Token.Register(() => this.completionSource.TrySetException(new TimeoutException()), useSynchronizationContext: false);
                this.timeoutSource.CancelAfter(timeout);
            }
        }

        public Task<object> Task => this.completionSource.Task;

        public void Dispose()
        {
            this.timeoutSource?.Dispose();
            this.cancellationTokenSource.Dispose();
        }

        public void Cancel() => this.cancellationTokenSource.Cancel();

        public void TrySetException(Exception exception) => this.completionSource.TrySetException(exception);

        public void TrySetResult(JsonRpc2Error error, object result)
        {
            if (error != null)
            {
                this.completionSource.TrySetException(new JsonRpc2Exception(error));
            }
            else
            {
                this.completionSource.TrySetResult(result);
            }
        }
    }
}
