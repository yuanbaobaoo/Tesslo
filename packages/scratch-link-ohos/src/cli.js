#!/usr/bin/env node
import {startScratchLinkServer} from './server.js';

const host = process.env.TESSLO_LINK_HOST || '127.0.0.1';
const port = Number(process.env.TESSLO_LINK_PORT || 20111);

const server = await startScratchLinkServer({host, port});
const address = server.address();
console.log(`[tesslo] Scratch Link listening on ws://${address.address}:${address.port}`);
console.log('[tesslo] paths: /scratch/ble /scratch/bt');
console.log('[tesslo] transport: fake BLE/BT (replace with ArkTS bridge for device builds)');

const shutdown = async () => {
    await server.stop();
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
