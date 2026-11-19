// MiniHttp：回环 HTTP 服务公共框架（抽自 AssetServer 模式，规范 §10.3）。
// 职责：仅绑定 127.0.0.1、解析请求（含 Content-Length body）、路径 `..` 拦截、
// 统一信封 {ok:true,data} | {ok:false,error} 响应；业务路由由各服务注入。
import socket from '@ohos.net.socket';
import util from '@ohos.util';

import { log } from './AppLog';

// 解析后的请求（路径已 decode + 去 query；body 为 UTF-8 文本）
export interface HttpRequest {
  method: string;
  path: string;
  query: Map<string, string>;
  body: string;
}

// 信封错误体（与 web 侧 PlatformError 对齐）
export interface HttpErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

// 业务处理器返回值：ok 时 payload 进 data 字段
export interface HttpResult {
  status: number;
  ok: boolean;
  payload?: Object;
  error?: HttpErrorBody;
}

// 业务路由函数
export type HttpHandler = (request: HttpRequest) => Promise<HttpResult>;

// 每个具名服务的监听实例与活跃连接（成对启停）
interface ServiceEntry {
  server: socket.TCPSocketServer;
  clients: Set<socket.TCPSocketConnection>;
}

// 已启动服务表：服务名 -> 实例
const services: Map<string, ServiceEntry> = new Map();

// listen 撞 TIME_WAIT 时的重试参数（仅自己的旧实例会占端口）
const LISTEN_RETRY: number = 5;
const LISTEN_RETRY_DELAY_MS: number = 1000;
// 响应后等对端关闭的兜底时长
const RESPONSE_CLOSE_GUARD_MS: number = 5000;

/**
 * 构造 200 信封结果。
 *
 * @param payload - data 字段内容（interface / 数组 / Record 均可）。
 * @returns HttpResult。
 */
export function ok(payload?: Object): HttpResult {
  return {status: 200, ok: true, payload: payload};
}

/**
 * 构造错误信封结果。
 *
 * @param status - HTTP 状态码。
 * @param code - 稳定错误码（web 侧映射 PlatformError.code）。
 * @param message - 诊断信息。
 * @param retryable - 是否可重试。
 * @returns HttpResult。
 */
export function fail(status: number, code: string, message: string,
  retryable: boolean = false): HttpResult {
  return {status: status, ok: false, error: {code: code, message: message, retryable: retryable}};
}

/**
 * 序列化信封响应报文。
 */
function envelopeResponse(result: HttpResult): Uint8Array {
  // 用 deprecated 的 encode 而非 encodeInto：后者在 SDK d.ts 中单参/双参两个签名并存，
  // ArkTS 运行时重载绑定错位（真机崩在 encodeInto(x).byteLength，JS_ERROR 杀进程，2026-11-17）
  const encoder: util.TextEncoder = new util.TextEncoder();
  // ArkTS 无对象字面量动态键：分别构造两种信封
  let bodyText: string;
  if (result.ok) {
    bodyText = result.payload === undefined
      ? '{"ok":true}'
      : `{"ok":true,"data":${JSON.stringify(result.payload)}}`;
  } else {
    const error: HttpErrorBody = result.error ?? {code: 'E_IO', message: 'unknown', retryable: false};
    bodyText = `{"ok":false,"error":${JSON.stringify(error)}}`;
  }
  const body: Uint8Array = encoder.encode(bodyText);
  const headers: string = `HTTP/1.1 ${result.status} ${result.status === 200 ? 'OK' : 'Error'}\r\n` +
    'Content-Type: application/json; charset=utf-8\r\n' +
    `Content-Length: ${body.byteLength}\r\n` +
    'Access-Control-Allow-Origin: *\r\n' +
    'Connection: close\r\n\r\n';
  const head: Uint8Array = encoder.encode(headers);
  const output: Uint8Array = new Uint8Array(head.byteLength + body.byteLength);
  output.set(head, 0);
  output.set(body, head.byteLength);
  return output;
}

/**
 * 解析请求行 + 头 + body；返回 null 表示还需继续收数据。
 *
 * @param raw - 累计收到的文本。
 * @param receivedBytes - 累计收到的字节数（HTTP 头是 ASCII，可精确推算 body 起点）。
 * @returns 完整请求或 null。
 */
function parseRequest(raw: string, receivedBytes: number): HttpRequest | null {
  const headerEnd: number = raw.indexOf('\r\n\r\n');
  if (headerEnd < 0) {
    return null;
  }
  const headerText: string = raw.substring(0, headerEnd);
  const lines: Array<string> = headerText.split('\r\n');
  const requestLine: Array<string> = (lines[0] ?? '').split(' ');
  if (requestLine.length < 2) {
    return null;
  }
  const method: string = requestLine[0];
  const rawTarget: string = requestLine[1];
  const queryStart: number = rawTarget.indexOf('?');
  let path: string = queryStart >= 0 ? rawTarget.substring(0, queryStart) : rawTarget;
  const query: Map<string, string> = new Map();
  if (queryStart >= 0) {
    const pairs: Array<string> = rawTarget.substring(queryStart + 1).split('&');
    for (const pair of pairs) {
      const equal: number = pair.indexOf('=');
      if (equal > 0) {
        query.set(pair.substring(0, equal), decodeURIComponent(pair.substring(equal + 1)));
      }
    }
  }
  try {
    path = decodeURIComponent(path);
  } catch (error) {
    // 非法转义保持原样，交给路由白名单拒绝
  }
  // Content-Length 定长读取 body
  let contentLength: number = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const line: string = lines[index];
    const colon: number = line.indexOf(':');
    if (colon > 0 && line.substring(0, colon).trim().toLowerCase() === 'content-length') {
      const parsed: number = Number(line.substring(colon + 1).trim());
      if (!Number.isNaN(parsed) && parsed >= 0) {
        contentLength = parsed;
      }
    }
  }
  // body 完整性：头部与分隔符均为 ASCII 单字节，字节数即字符数
  const bodyStart: number = headerEnd + 4;
  const receivedBodyBytes: number = receivedBytes - bodyStart;
  if (receivedBodyBytes < contentLength) {
    return null; // body 未收全
  }
  const body: string = contentLength > 0 ? raw.substring(bodyStart, bodyStart + contentLength) : '';
  // 安全线：路径逃逸一律交给路由层判断，这里仅暴露原文
  return {method: method, path: path, query: query, body: body};
}

/**
 * 响应完成后的连接收尾：等对端读到响应并主动关闭（Connection: close 语义），
 * 服务端不先发 FIN——服务端主动 close 会让监听端口进入 TIME_WAIT，
 * Ability 销毁重建后重 listen 会 EEXIST（真机复现过，2026-11-17）。
 * 对端不守规矩时由兜底定时器关闭。
 */
const finishResponse = (name: string, client: socket.TCPSocketConnection): void => {
  const guardTimer: number = setTimeout(() => {
    client.close();
  }, RESPONSE_CLOSE_GUARD_MS);
  client.on('close', () => {
    clearTimeout(guardTimer);
  });
};

/**
 * 启动一个具名回环 HTTP 服务（幂等：已启动则先停再启，
 * 覆盖 Ability 销毁重建时 onCreate 重跑的常态场景）。
 *
 * @param name - 服务名（日志与停止时标识，须唯一）。
 * @param port - 监听端口（Ports.ets 登记）。
 * @param handler - 业务路由。
 * @returns 监听就绪后 resolve。
 */
export async function startMiniHttp(name: string, port: number, handler: HttpHandler): Promise<void> {
  if (services.has(name)) {
    log(`mini-http [${name}] already started; restarting for ability re-create`);
    await stopMiniHttp(name);
  }
  const server: socket.TCPSocketServer = socket.constructTCPSocketServerInstance();
  // TIME_WAIT 残留（上一生命周期服务端连接未完全释放）时延迟重试：
  // 端口只属于本服务（Ports.ets 登记），占用者只会是自己的旧实例
  let lastError: Error | null = null;
  for (let attempt: number = 0; attempt < LISTEN_RETRY; attempt += 1) {
    try {
      await server.listen({address: '127.0.0.1', port: port, family: 1});
      lastError = null;
      break;
    } catch (error) {
      lastError = error as Error;
      log(`mini-http [${name}] listen attempt ${attempt + 1} failed: ${lastError.message}`);
      await new Promise<void>(resolve => setTimeout(resolve, LISTEN_RETRY_DELAY_MS));
    }
  }
  if (lastError !== null) {
    throw lastError;
  }
  services.set(name, {server: server, clients: new Set()});
  log(`mini-http [${name}] listening on 127.0.0.1:${port}`);
  server.on('connect', (client: socket.TCPSocketConnection) => {
    const entry: ServiceEntry | undefined = services.get(name);
    if (entry === undefined) {
      client.close();
      return;
    }
    entry.clients.add(client);
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
    let pending: string = '';
    let pendingBytes: number = 0;
    client.on('message', (info: socket.SocketMessageInfo) => {
      const chunk: Uint8Array = new Uint8Array(info.message);
      pendingBytes += chunk.byteLength;
      pending += decoder.decodeToString(chunk);
      const request: HttpRequest | null = parseRequest(pending, pendingBytes);
      if (request === null) {
        return;
      }
      // CORS 预检：ArkWeb fetch 的 JSON POST 会先发 OPTIONS（非简单请求），
      // 不回预检会导致页面侧全部写请求失败（真机实测 2026-11-18；
      // GET 是简单请求无预检，curl 无 CORS，故此前仅页面 POST 失败）
      if (request.method === 'OPTIONS') {
        const preflight: Uint8Array = new util.TextEncoder().encodeInto(
          'HTTP/1.1 204 No Content\r\n' +
          'Access-Control-Allow-Origin: *\r\n' +
          'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n' +
          'Access-Control-Allow-Headers: Content-Type\r\n' +
          'Access-Control-Max-Age: 86400\r\n' +
          'Content-Length: 0\r\n' +
          'Connection: close\r\n\r\n');
        client.send({data: preflight.buffer}).then(() => {
          client.close(); // 预检连接即关（无 TIME_WAIT 顾虑：客户端发起的下一个请求是新连接）
        }).catch(() => {
          client.close();
        });
        return;
      }
      handler(request).then((result: HttpResult) => {
        client.send({data: envelopeResponse(result).buffer}).then(() => {
          finishResponse(name, client);
        }).catch((error: Error) => {
          log(`mini-http [${name}] response failed: ${error.message}`);
          client.close();
        });
      }).catch((error: Error) => {
        log(`mini-http [${name}] handler failed: ${error.message}`);
        const fallback: Uint8Array = envelopeResponse(fail(500, 'E_IO', error.message));
        client.send({data: fallback.buffer}).then(() => {
          finishResponse(name, client);
        }).catch(() => {
          client.close();
        });
      });
    });
    client.on('close', () => {
      entry.clients.delete(client);
    });
  });
}

/**
 * 停止一个具名服务：关闭全部客户端连接并停止监听；可重复调用。
 *
 * @param name - 服务名。
 * @returns 全部资源关闭后 resolve。
 */
export async function stopMiniHttp(name: string): Promise<void> {
  const entry: ServiceEntry | undefined = services.get(name);
  if (entry === undefined) {
    return;
  }
  services.delete(name);
  for (const client of entry.clients) {
    try {
      await client.close();
    } catch (error) {
      log(`mini-http [${name}] client close failed: ${(error as Error).message}`);
    }
  }
  entry.clients.clear();
  try {
    await entry.server.close();
  } catch (error) {
    log(`mini-http [${name}] server close failed: ${(error as Error).message}`);
  }
}
