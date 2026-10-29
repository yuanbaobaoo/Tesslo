import socket from '@ohos.net.socket';
import util from '@ohos.util';
import { common } from '@kit.AbilityKit';

import { log } from '../common/AppLog';

const ASSET_PREFIX: string = '/static/fetched/';
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

function mimeType(path: string): string {
  const dot: number = path.lastIndexOf('.');
  const extension: string = dot >= 0 ? path.substring(dot + 1).toLowerCase() : '';
  return MIME.get(extension) ?? 'application/octet-stream';
}

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

function handleRequest(client: socket.TCPSocketConnection, context: common.UIAbilityContext,
  request: string): void {
  const line: string = request.split('\r\n')[0] ?? '';
  const parts: Array<string> = line.split(' ');
  const path: string = parts.length > 1 ? decodeURIComponent(parts[1].split('?')[0]) : '';
  let rawPath: string = '';
  if (path.startsWith('/internalapi/asset/')) {
    const rest: string = path.substring('/internalapi/asset/'.length);
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

export async function startAssetServer(context: common.UIAbilityContext,
  port: number = 20114): Promise<void> {
  const server = socket.constructTCPSocketServerInstance();
  await server.listen({address: '127.0.0.1', port: port, family: 1});
  log(`asset server listening on 127.0.0.1:${port}`);
  server.on('connect', (client: socket.TCPSocketConnection) => {
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
    let pending: string = '';
    client.on('message', (info: socket.SocketMessageInfo) => {
      pending += decoder.decode(new Uint8Array(info.message));
      if (!pending.includes('\r\n\r\n')) return;
      handleRequest(client, context, pending);
    });
  });
}
