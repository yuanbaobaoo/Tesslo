import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import {startScratchLinkServer} from '@tesslo/scratch-link-ohos';

const connect = url => new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
});

const request = (socket, id, method, params) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
        socket.off('message', onMessage);
        reject(new Error(`timeout waiting for ${method}`));
    }, 3000);
    const onMessage = raw => {
        const message = JSON.parse(raw.toString());
        if (message.id !== id) return;
        clearTimeout(timer);
        socket.off('message', onMessage);
        if (message.error) reject(Object.assign(new Error(message.error.message), message.error));
        else resolve(message.result);
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify({jsonrpc: '2.0', id, method, params}));
});

const waitFor = (socket, method) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
        socket.off('message', onMessage);
        reject(new Error(`timeout waiting for ${method}`));
    }, 3000);
    const onMessage = raw => {
        const message = JSON.parse(raw.toString());
        if (message.method !== method) return;
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(message.params);
    };
    socket.on('message', onMessage);
});

test('BT path: getVersion, discover, connect, send, didReceiveMessage', async t => {
    const server = await startScratchLinkServer({host: '127.0.0.1', port: 0, logger: {warn() {}, error() {}}});
    const {port} = server.address();
    t.after(async () => {
        await server.stop();
    });

    const socket = await connect(`ws://127.0.0.1:${port}/scratch/bt`);
    t.after(() => socket.close());

    assert.deepEqual(await request(socket, 1, 'getVersion'), {protocol: '1.3'});

    const discoveredPromise = waitFor(socket, 'didDiscoverPeripheral');
    assert.equal(await request(socket, 2, 'discover', {}), null);
    const discovered = await discoveredPromise;
    assert.equal(discovered.peripheralId, 101);

    assert.equal(await request(socket, 3, 'connect', {peripheralId: 101}), null);

    const received = waitFor(socket, 'didReceiveMessage');
    const sent = await request(socket, 4, 'send', {
        message: Buffer.from('ping').toString('base64'),
        encoding: 'base64'
    });
    assert.equal(sent, 4);
    assert.equal(Buffer.from((await received).message, 'base64').toString(), 'ping');
});

test('unsupported WebSocket path is closed', async t => {
    const server = await startScratchLinkServer({host: '127.0.0.1', port: 0, logger: {warn() {}, error() {}}});
    const {port} = server.address();
    t.after(async () => {
        await server.stop();
    });

    const socket = await connect(`ws://127.0.0.1:${port}/not-scratch`);
    const code = await new Promise(resolve => socket.once('close', resolve));
    assert.equal(code, 1008);
});
