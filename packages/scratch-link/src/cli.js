#!/usr/bin/env node
// 本地联调入口：在桌面 Node 里起一个 fake BLE/BT 的 Scratch Link 服务，
// 真机设备走 EntryAbility 内嵌的 C# 宿主，不用本文件。
import {startScratchLinkServer} from './server.js';

// 监听地址/端口可用环境变量覆盖，默认与 C# 宿主一致的回环 20111
const host = process.env.TESSLO_LINK_HOST || '127.0.0.1';
const port = Number(process.env.TESSLO_LINK_PORT || 20111);

const server = await startScratchLinkServer({host, port});
const address = server.address();
console.log(`[tesslo] Scratch Link listening on ws://${address.address}:${address.port}`);
console.log('[tesslo] paths: /scratch/ble /scratch/bt');
console.log('[tesslo] transport: fake BLE/BT (replace with ArkTS bridge for device builds)');

/**
 * 收到退出信号时优雅停机：先关服务器再退出。
 */
const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
