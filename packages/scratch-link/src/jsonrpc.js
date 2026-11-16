// JSON-RPC 2.0 保留错误码；SERVER_ERROR 为 Scratch Link 约定的实现层错误码
export const RpcErrorCode = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000
});

/**
 * 携带 JSON-RPC 错误码的异常；server 捕获后转成 error 响应。
 */
export class RpcError extends Error {
  constructor (code, message, data = undefined) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

/**
 * 构造 JSON-RPC 成功响应报文。
 */
export const rpcResult = (id, result) => ({
  jsonrpc: '2.0',
  id,
  result
});

/**
 * 构造 JSON-RPC 错误响应报文；data 仅在提供时附带。
 */
export const rpcError = (id, code, message, data = undefined) => {
  const error = {code, message};
  if (typeof data !== 'undefined') error.data = data;
  return {
    jsonrpc: '2.0',
    id,
    error
  };
};

/**
 * 解析并校验入站报文：不合法时抛 RpcError（PARSE_ERROR / INVALID_REQUEST）。
 */
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
