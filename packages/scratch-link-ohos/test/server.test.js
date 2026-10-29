import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

import {
    MICROBIT_NOTIFY_CHARACTERISTIC,
    MICROBIT_SERVICE,
    MICROBIT_WRITE_CHARACTERISTIC,
    startScratchLinkServer
} from '../src/index.js';

const connect = url => new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
});

class Client {
    constructor (socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        this.notifications = [];
        this.waiters = [];

        socket.on('message', raw => {
            const message = JSON.parse(raw.toString());
            if (message.id !== undefined && this.pending.has(message.id)) {
                const {resolve, reject} = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) reject(Object.assign(new Error(message.error.message), message.error));
                else resolve(message.result);
                return;
            }
            if (message.method) {
                const waiterIndex = this.waiters.findIndex(waiter => waiter.method === message.method);
                if (waiterIndex >= 0) {
                    const [waiter] = this.waiters.splice(waiterIndex, 1);
                    clearTimeout(waiter.timer);
                    waiter.resolve(message.params);
                } else {
                    this.notifications.push(message);
                }
            }
        });
    }

    request (method, params) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`timeout waiting for ${method}`));
            }, 3000);
            this.pending.set(id, {
                resolve: value => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: error => {
                    clearTimeout(timer);
                    reject(error);
                }
            });
            this.socket.send(JSON.stringify({jsonrpc: '2.0', id, method, params}));
        });
    }

    waitNotification (method, timeout = 3000) {
        const index = this.notifications.findIndex(notification => notification.method === method);
        if (index >= 0) {
            const [notification] = this.notifications.splice(index, 1);
            return Promise.resolve(notification.params);
        }
        return new Promise((resolve, reject) => {
            const waiter = {method, resolve, reject};
            waiter.timer = setTimeout(() => {
                this.waiters = this.waiters.filter(candidate => candidate !== waiter);
                reject(new Error(`timeout waiting for notification ${method}`));
            }, timeout);
            this.waiters.push(waiter);
        });
    }

    close () {
        this.socket.close();
    }
}

const setup = async t => {
    const server = await startScratchLinkServer({host: '127.0.0.1', port: 0, logger: {warn() {}, error() {}}});
    const {port} = server.address();
    t.after(async () => {
        await server.stop();
    });
    return {server, port};
};

test('BLE: getVersion, discover, connect, read, write, notify', async t => {
    const {port} = await setup(t);
    const socket = await connect(`ws://127.0.0.1:${port}/scratch/ble`);
    const client = new Client(socket);
    t.after(() => client.close());

    assert.deepEqual(await client.request('getVersion'), {protocol: '1.3'});

    assert.equal(await client.request('discover', {
        filters: [{name: 'Tesslo Fake micro:bit'}]
    }), null);

    const discovered = await client.waitNotification('didDiscoverPeripheral');
    assert.equal(discovered.name, 'Tesslo Fake micro:bit');
    assert.equal(discovered.peripheralId, 1);
    assert.equal(typeof discovered.rssi, 'number');

    assert.equal(await client.request('connect', {peripheralId: discovered.peripheralId}), null);

    const services = await client.request('getServices');
    assert.ok(services.includes(MICROBIT_SERVICE));

    const read = await client.request('read', {
        serviceId: MICROBIT_SERVICE,
        characteristicId: MICROBIT_NOTIFY_CHARACTERISTIC
    });
    assert.equal(read.encoding, 'base64');
    assert.equal(Buffer.from(read.message, 'base64').toString(), 'ping');

    const written = await client.request('write', {
        serviceId: MICROBIT_SERVICE,
        characteristicId: MICROBIT_WRITE_CHARACTERISTIC,
        message: Buffer.from('pong').toString('base64'),
        encoding: 'base64',
        withResponse: true
    });
    assert.equal(written, 4);

    assert.equal(await client.request('startNotifications', {
        serviceId: MICROBIT_SERVICE,
        characteristicId: MICROBIT_NOTIFY_CHARACTERISTIC,
        encoding: 'base64'
    }), null);

    const change = await client.waitNotification('characteristicDidChange');
    assert.equal(change.serviceId, MICROBIT_SERVICE);
    assert.equal(change.characteristicId, MICROBIT_NOTIFY_CHARACTERISTIC);
    assert.ok(Buffer.from(change.message, 'base64').toString().startsWith('tick-'));

    assert.equal(await client.request('stopNotifications', {
        serviceId: MICROBIT_SERVICE,
        characteristicId: MICROBIT_NOTIFY_CHARACTERISTIC
    }), null);
});

test('BLE: discover rejects empty filters', async t => {
    const {port} = await setup(t);
    const socket = await connect(`ws://127.0.0.1:${port}/scratch/ble`);
    const client = new Client(socket);
    t.after(() => client.close());

    await assert.rejects(
        client.request('discover', {filters: []}),
        error => error.code === -32602
    );
});

test('BLE: unknown method returns METHOD_NOT_FOUND', async t => {
    const {port} = await setup(t);
    const socket = await connect(`ws://127.0.0.1:${port}/scratch/ble`);
    const client = new Client(socket);
    t.after(() => client.close());

    await assert.rejects(
        client.request('doesNotExist'),
        error => error.code === -32601
    );
});
