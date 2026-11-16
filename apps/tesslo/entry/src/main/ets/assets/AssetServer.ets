import socket from '@ohos.net.socket';
import util from '@ohos.util';
import { common } from '@kit.AbilityKit';

import { log } from '../common/AppLog';
import { ASSET_SERVER_PORT } from '../common/Ports';

// Web 侧直接取素材的路径前缀（对应 web/src/constants.js 的 ASSET_ORIGIN）
const ASSET_PREFIX: string = '/static/fetched/';
// scratch-gui 经 scratch-storage 请求素材的历史路径前缀
const INTERNAL_ASSET_PREFIX: string = '/internalapi/asset/';
// rawfile 素材的扩展名 -> Content-Type
const MIME: Map<string, string> = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['svg', 'image/svg+xml'],
  ['wav', 'audio/wav'],
  ['mp3', 'audio/mpeg'],
  ['json', 'application/json']
]);

// 当前监听实例与活跃连接，供 stopAssetServer 成对释放
let assetServer: socket.TCPSocketServer | null = null;
const assetClients: Set<socket.TCPSocketConnection> = new Set();

/**
 * 按扩展名取 Content-Type；未知类型回退 application/octet-stream。
 */
function mimeType(path: string): string {
  const dot: number = path.lastIndexOf('.');
  const extension: string = dot >= 0 ? path.substring(dot + 1).toLowerCase() : '';
  return MIME.get(extension) ?? 'application/octet-stream';
}

/**
 * 拼一个最小的 HTTP/1.1 响应报文（状态行 + 头 + 二进制 body）。
 */
function response(status: string, contentType: string, body: Uint8Array): Uint8Array {
  const headers: string = `HTTP/1.1 ${status}\r\n` +
    `Content-Type: ${contentType}\r\n` +
    `Content-Length: ${body.byteLength}\r\n` +
    'Access-Control-Allow-Origin: *\r\n' +
    'Connection: close\r\n\r\n';
  const head: Uint8Array = new util.TextEncoder().encodeInto(headers);
  const output: Uint8Array = new Uint8Array(head.byteLength + body.byteLength);
  output.set(head, 0);
  output.set(body, head.byteLength);
  return output;
}

/**
 * 处理单个 GET 请求：只允许 rawfile 内的白名单路径（含 `..` 目录逃逸拦截）。
 */
function handleRequest(client: socket.TCPSocketConnection, context: common.UIAbilityContext,
  request: string): void {
  const line: string = request.split('\r\n')[0] ?? '';
  const parts: Array<string> = line.split(' ');
  const path: string = parts.length > 1 ? decodeURIComponent(parts[1].split('?')[0]) : '';
  let rawPath: string = '';
  if (path.startsWith(INTERNAL_ASSET_PREFIX)) {
    const rest: string = path.substring(INTERNAL_ASSET_PREFIX.length);
    const slash: number = rest.indexOf('/');
    if (slash > 0) rawPath = `static/fetched/${rest.substring(0, slash)}`;
  } else if (path.startsWith(ASSET_PREFIX)) {
    rawPath = path.substring(1);
  }
  let body: Uint8Array;
  let status: string;
  let type: string;
  if (parts.length > 1 && parts[0] === 'GET' && rawPath.length > 0 &&
    !rawPath.includes('..')) {
    try {
      const content: Uint8Array = context.resourceManager.getRawFileContentSync(rawPath);
      body = new Uint8Array(content.length);
      body.set(content);
      status = '200 OK';
      type = mimeType(rawPath);
    } catch (error) {
      body = new util.TextEncoder().encodeInto('not found');
      status = '404 Not Found';
      type = 'text/plain';
    }
  } else {
    body = new util.TextEncoder().encodeInto('not found');
    status = '404 Not Found';
    type = 'text/plain';
  }
  client.send({data: response(status, type, body).buffer}).then(() => {
    client.close();
  }).catch((error: Error) => {
    log(`asset response failed: ${error.message}`);
    client.close();
  });
}

/**
 * 启动离线素材服务：从 rawfile 读取静态素材响应 GET。
 * @param context UIAbility 上下文，用于 resourceManager 读 rawfile
 * @param port 监听端口，默认取 common/Ports 的 ASSET_SERVER_PORT
 * @returns 监听就绪后 resolve
 */
export async function startAssetServer(context: common.UIAbilityContext,
  port: number = ASSET_SERVER_PORT): Promise<void> {
  const server = socket.constructTCPSocketServerInstance();
  await server.listen({address: '127.0.0.1', port: port, family: 1});
  assetServer = server;
  log(`asset server listening on 127.0.0.1:${port}`);
  server.on('connect', (client: socket.TCPSocketConnection) => {
    assetClients.add(client);
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
    let pending: string = '';
    client.on('message', (info: socket.SocketMessageInfo) => {
      pending += decoder.decode(new Uint8Array(info.message));
      if (!pending.includes('\r\n\r\n')) return;
      handleRequest(client, context, pending);
    });
    client.on('close', () => {
      assetClients.delete(client);
    });
  });
}

/**
 * 停止素材服务：关闭全部客户端连接并停止监听；可重复调用。
 * @returns 全部资源关闭后 resolve
 */
export async function stopAssetServer(): Promise<void> {
  for (const client of assetClients) {
    try {
      await client.close();
    } catch (error) {
      log(`asset client close failed: ${error.message}`);
    }
  }
  assetClients.clear();
  const server: socket.TCPSocketServer | null = assetServer;
  assetServer = null;
  if (server !== null) {
    try {
      await server.close();
    } catch (error) {
      log(`asset server close failed: ${error.message}`);
    }
  }
}
