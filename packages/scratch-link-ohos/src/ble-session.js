import {EventEmitter} from 'node:events';

import {RpcError, RpcErrorCode} from './jsonrpc.js';
import {FakeBleAdapter} from './fake-ble.js';

const PROTOCOL_VERSION = '1.3';

export class BleSession extends EventEmitter {
    constructor (adapter = new FakeBleAdapter()) {
        super();
        this.adapter = adapter;
        this.state = 'initial';
        this.adapter.on('notification', (method, params) => {
            this.emit('notification', method, params);
        });
    }

    async handle (method, params = {}) {
        switch (method) {
        case 'getVersion':
            return {protocol: PROTOCOL_VERSION};
        case 'discover':
            return this.discover(params);
        case 'connect':
            return this.connect(params);
        case 'getServices':
            this.requireConnected();
            return this.adapter.getServices();        case 'read':
            return this.read(params);
        case 'write':
            return this.write(params);
        case 'startNotifications':
            return this.startNotifications(params);
        case 'stopNotifications':
            return this.stopNotifications(params);
        default:
            throw new RpcError(RpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${method}`);
        }
    }

    async discover (params) {
        if (this.state !== 'initial') {
            throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'discover is only valid in the initial state');
        }
        let devices;
        try {
            devices = await this.adapter.discover(params);
        } catch (error) {
            throw new RpcError(RpcErrorCode.INVALID_PARAMS, error.message);
        }
        this.state = 'discovery';
        setImmediate(() => {
            for (const device of devices) {
                this.emit('notification', 'didDiscoverPeripheral', {
                    peripheralId: device.peripheralId,
                    name: device.name,
                    rssi: device.rssi
                });
            }
        });
        return null;
    }

    async connect (params) {
        if (this.state !== 'discovery') {
            throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'connect is only valid after discover');
        }
        if (params?.peripheralId === undefined) {
            throw new RpcError(RpcErrorCode.INVALID_PARAMS, 'connect requires peripheralId');
        }
        await this.adapter.connect(params.peripheralId);
        this.state = 'connected';
        return null;
    }

    requireConnected () {
        if (this.state !== 'connected') {
            throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'not connected');
        }
    }

    async read (params) {
        this.requireConnected();
        const result = await this.adapter.read(params?.serviceId, params?.characteristicId);
        if (params?.startNotifications) {
            await this.adapter.startNotifications(params.serviceId, params.characteristicId, params.encoding);
        }
        return result;
    }

    async write (params) {
        this.requireConnected();
        return this.adapter.write(
            params?.serviceId,
            params?.characteristicId,
            params?.message,
            params?.encoding
        );
    }

    async startNotifications (params) {
        this.requireConnected();
        await this.adapter.startNotifications(params?.serviceId, params?.characteristicId, params?.encoding);
        return null;
    }

    async stopNotifications (params) {
        this.requireConnected();
        await this.adapter.stopNotifications(params?.serviceId, params?.characteristicId);
        return null;
    }

    dispose () {
        this.adapter.dispose();
        this.removeAllListeners();
    }
}
