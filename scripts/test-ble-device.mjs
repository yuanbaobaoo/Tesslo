import {spawnSync} from 'node:child_process';
import process from 'node:process';

import WebSocket from 'ws';

import {listDevices, resolveToolchain} from './ohos-common.mjs';

const args = process.argv.slice(2);
const getArg = name => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
};
const deviceKind = getArg('--device') ?? 'microbit';
const serialArg = getArg('--serial');
const port = Number(getArg('--port') ?? 20111);

if (!['microbit', 'wedo', 'all'].includes(deviceKind)) {
    console.error('usage: pnpm test:ble -- --device microbit|wedo|all [--serial <hdc>] [--port 20111]');
    process.exit(2);
}

const toolchain = resolveToolchain();
const serials = listDevices(toolchain.hdc);
const serial = serialArg ?? serials[0];
if (!serial) {
    console.error('no HarmonyOS device found by hdc list targets');
    process.exit(2);
}

const forward = spawnSync(toolchain.hdc, ['-t', serial, 'fport', `tcp:${port}`, 'tcp:20111'], {
    encoding: 'utf8'
});
if (forward.status !== 0) {
    console.warn(`hdc fport: ${forward.stderr || forward.stdout}`.trim());
}

const service = {
    microbit: {
        label: 'micro:bit',
        filter: {services: ['0000f005-0000-1000-8000-00805f9b34fb']},
        service: '0000f005-0000-1000-8000-00805f9b34fb',
        rx: '5261da01-fa7e-42ab-850b-7c80220097cc',
        tx: '5261da02-fa7e-42ab-850b-7c80220097cc',
        payload: Buffer.concat([Buffer.from([0x81]), Buffer.from('Tesslo')]).toString('base64')
    },
    wedo: {
        label: 'WeDo 2.0',
        filter: {services: ['00001523-1212-efde-1523-785feabcd123']},
        optionalServices: ['00004f0e-1212-efde-1523-785feabcd123'],
        service: '00004f0e-1212-efde-1523-785feabcd123',
        output: '00001565-1212-efde-1523-785feabcd123',
        battery: '00001528-1212-efde-1523-785feabcd123',
        payload: Buffer.from([6, 4, 3, 0, 255, 0]).toString('base64')
    }
};

class LinkClient {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.nextId = 1;
        this.pending = new Map();
        this.notifications = [];
        this.ws.on('message', raw => {
            const message = JSON.parse(raw.toString());
            if (message.id !== undefined && this.pending.has(message.id)) {
                const {resolve, reject, timer} = this.pending.get(message.id);
                clearTimeout(timer);
                this.pending.delete(message.id);
                if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`));
                else resolve(message.result);
                return;
            }
            if (message.method) this.notifications.push(message);
        });
    }

    async open() {
        if (this.ws.readyState === WebSocket.OPEN) return;
        await new Promise((resolve, reject) => {
            this.ws.once('open', resolve);
            this.ws.once('error', reject);
        });
    }

    request(method, params = {}, timeout = 15000) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out`));
            }, timeout);
            this.pending.set(id, {resolve, reject, timer});
            this.ws.send(JSON.stringify({jsonrpc: '2.0', id, method, params}));
        });
    }

    close() {
        this.ws.close();
    }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function testDevice(kind) {
    const spec = service[kind];
    const client = new LinkClient(`ws://127.0.0.1:${port}/scratch/ble`);
    await client.open();
    console.log(`[ble] ${spec.label}: getVersion`);
    const version = await client.request('getVersion');
    console.log(`[ble] protocol=${version.protocol}`);

    console.log(`[ble] ${spec.label}: discover`);
    const discoverParams = {filters: [spec.filter]};
    if (spec.optionalServices) discoverParams.optionalServices = spec.optionalServices;
    await client.request('discover', discoverParams, 20000);
    await sleep(1500);
    const found = client.notifications
        .filter(message => message.method === 'didDiscoverPeripheral')
        .map(message => message.params);
    if (found.length === 0) {
        throw new Error(`no ${spec.label} found; make sure it is advertising and not paired to another host`);
    }
    const peripheral = found[0];
    console.log(`[ble] ${spec.label}: found ${peripheral.name || '(unnamed)'} (${peripheral.peripheralId})`);

    console.log(`[ble] ${spec.label}: connect`);
    await client.request('connect', {peripheralId: peripheral.peripheralId}, 20000);
    console.log(`[ble] ${spec.label}: getServices`);
    const services = await client.request('getServices', {}, 15000);
    console.log(`[ble] services=${services.join(', ')}`);
    if (!services.some(item => item.toLowerCase().includes(spec.service.slice(4, 8)))) {
        throw new Error(`${spec.label} service ${spec.service} not found`);
    }

    if (kind === 'microbit') {
        console.log('[ble] micro:bit: startNotifications');
        await client.request('startNotifications', {
            serviceId: spec.service,
            characteristicId: spec.tx,
            encoding: 'base64'
        });
        console.log('[ble] micro:bit: displayText "Tesslo"');
        await client.request('write', {
            serviceId: spec.service,
            characteristicId: spec.rx,
            message: spec.payload,
            encoding: 'base64',
            withResponse: true
        });
        await sleep(1500);
        const notifications = client.notifications.filter(message =>
            message.method === 'characteristicDidChange'
        );
        console.log(`[ble] micro:bit: notifications=${notifications.length}`);
    } else {
        console.log('[ble] WeDo: startNotifications ATTACHED_IO');
        await client.request('startNotifications', {
            serviceId: '00001523-1212-efde-1523-785feabcd123',
            characteristicId: '00001527-1212-efde-1523-785feabcd123',
            encoding: 'base64'
        });
        console.log('[ble] WeDo: read LOW_VOLTAGE_ALERT');
        try {
            const battery = await client.request('read', {
                serviceId: '00001523-1212-efde-1523-785feabcd123',
                characteristicId: spec.battery,
                encoding: 'base64'
            });
            console.log(`[ble] WeDo battery=${battery.message}`);
        } catch (error) {
            console.log(`[ble] WeDo battery read failed: ${error.message}`);
        }
        console.log('[ble] WeDo: set LED green');
        await client.request('write', {
            serviceId: spec.service,
            characteristicId: spec.output,
            message: spec.payload,
            encoding: 'base64',
            withResponse: false
        });
    }
    client.close();
    console.log(`[ble] ${spec.label}: PASS`);
}

try {
    const kinds = deviceKind === 'all' ? ['microbit', 'wedo'] : [deviceKind];
    for (const kind of kinds) {
        await testDevice(kind);
    }
} catch (error) {
    console.error(`[ble] FAIL: ${error.message}`);
    process.exit(1);
}
