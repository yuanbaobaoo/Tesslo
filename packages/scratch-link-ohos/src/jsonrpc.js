export const RpcErrorCode = Object.freeze({
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    SERVER_ERROR: -32000
});

export class RpcError extends Error {
    constructor (code, message, data = undefined) {
        super(message);
        this.name = 'RpcError';
        this.code = code;
        this.data = data;
    }
}

export const rpcResult = (id, result) => ({
    jsonrpc: '2.0',
    id,
    result
});

export const rpcError = (id, code, message, data = undefined) => {
    const error = {code, message};
    if (typeof data !== 'undefined') error.data = data;
    return {
        jsonrpc: '2.0',
        id,
        error
    };
};

export const parseRpcMessage = text => {
    let message;
    try {
        message = JSON.parse(text);
    } catch (error) {
        throw new RpcError(RpcErrorCode.PARSE_ERROR, 'Parse error', {cause: error.message});
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'Invalid Request');
    }
    if (message.jsonrpc !== '2.0') {
        throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'Invalid Request: jsonrpc must be 2.0');
    }
    if (typeof message.method !== 'string') {
        throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'Invalid Request: method must be a string');
    }
    return message;
};
