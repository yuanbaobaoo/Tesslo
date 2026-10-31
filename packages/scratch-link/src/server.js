import {WebSocketServer} from 'ws';

import {BleSession} from './ble-session.js';
import {BtSession} from './bt-session.js';
import {OhosBleAdapter, hasOhosBle} from './ohos-ble.js';
import {RpcError, RpcErrorCode, parseRpcMessage, rpcError, rpcResult} from './jsonrpc.js';

// 与 C# 宿主（上游 ScratchLinkApp）一致：仅监听本机回环、固定 20111
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 20111;

/**
 * 按路径类型创建会话：ble 优先真桥适配器，环境不支持时回退 fake；bt 走 fake。
 */
const createSession = type => {
  if (type === 'ble') {
    return new BleSession(hasOhosBle() ? new OhosBleAdapter() : undefined);
  }
  return new BtSession();
};

/**
 * 创建 Scratch Link WebSocket 服务：/scratch/ble 与 /scratch/bt 两条路径，
 * 报文按 JSON-RPC 解析并分发给会话，会话通知转发给客户端。
 * @param {object} options - {host, port, logger}，默认回环 20111。
 * @returns {{wss: WebSocketServer, start: Function, stop: Function, address: Function}}
 *   start/stop 均返回 Promise；address 返回当前监听地址。
 */
export const createScratchLinkServer = ({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  logger = console
} = {}) => {
  const wss = new WebSocketServer({host, port});

  wss.on('connection', (socket, request) => {
    const pathname = new URL(request.url, `ws://${host}`).pathname;
    let type;
    if (pathname === '/scratch/ble') type = 'ble';
    else if (pathname === '/scratch/bt') type = 'bt';
    else {
      socket.close(1008, `unsupported path: ${pathname}`);
      return;
    }

    const session = createSession(type);
    // await session.handle 期间客户端可能已断开：所有出站报文统一做 readyState 守卫
    const sendRpc = payload => {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify(payload));
      }
    };
    session.on('notification', (method, params) => {
      sendRpc({jsonrpc: '2.0', method, params});
    });

    socket.on('message', async raw => {
      let message;
      try {
        message = parseRpcMessage(raw.toString());
      } catch (error) {
        const id = null;
        const code = error instanceof RpcError ? error.code : RpcErrorCode.PARSE_ERROR;
        sendRpc(rpcError(id, code, error.message));
        return;
      }

      // Notifications from the client have no id; Scratch Link does not need to answer them.
      if (message.id === undefined) return;

      try {
        const result = await session.handle(message.method, message.params);
        sendRpc(rpcResult(message.id, result));
      } catch (error) {
        const code = error instanceof RpcError ? error.code : RpcErrorCode.SERVER_ERROR;
        const data = error instanceof RpcError ? error.data : undefined;
        sendRpc(rpcError(message.id, code, error.message, data));
      }
    });

    socket.on('close', () => session.dispose());
    socket.on('error', error => logger.warn?.(`[scratch-link] socket error: ${error.message}`));
  });

  wss.on('error', error => logger.error?.(`[scratch-link] server error: ${error.message}`));

  return {
    wss,
    start: () => new Promise((resolve, reject) => {
      if (wss.address()) return resolve(wss.address());
      wss.once('listening', () => resolve(wss.address()));
      wss.once('error', reject);
    }),
    stop: () => new Promise(resolve => {
      for (const client of wss.clients) client.terminate();
      wss.close(() => resolve());
    }),
    address: () => wss.address()
  };
};

/**
 * 创建并立即启动服务；resolve 已就绪的 server 句柄。
 */
export const startScratchLinkServer = async options => {
  const server = createScratchLinkServer(options);
  await server.start();
  return server;
};
