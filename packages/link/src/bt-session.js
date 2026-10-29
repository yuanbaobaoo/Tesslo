import {EventEmitter} from 'node:events';

import {RpcError, RpcErrorCode} from './jsonrpc.js';

const PROTOCOL_VERSION = '1.3';

const defaultDevices = () => [{
    peripheralId: 101,
    name: 'Tesslo Fake EV3',
    rssi: -70
}];

export class FakeBtAdapter extends EventEmitter {
    constructor (devices = defaultDevices()) {
        super();
        this.devices = devices;
        this.connected = null;
    }

    discover () {
        return this.devices;
    }

    connect (peripheralId) {
        const device = this.devices.find(candidate => candidate.peripheralId === peripheralId);
        if (!device) throw new Error(`unknown peripheralId: ${peripheralId}`);
        this.connected = device;
        return device;
    }

    requireConnected () {
        if (!this.connected) throw new Error('not connected to a peripheral');
        return this.connected;
    }

    send (message, encoding = null) {
        this.requireConnected();
        const bytes = encoding === 'base64' ?
            Buffer.from(message, 'base64') :
            Buffer.from(String(message), 'utf8');
        setImmediate(() => {
            this.emit('notification', 'didReceiveMessage', {
                message: bytes.toString('base64'),
                encoding: 'base64'
            });
        });
        return bytes.length;
    }

    dispose () {
        this.connected = null;
        this.removeAllListeners();
    }
}

export class BtSession extends EventEmitter {
    constructor (adapter = new FakeBtAdapter()) {
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
        case 'discover': {
            if (this.state !== 'initial') {
                throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'discover is only valid in the initial state');
            }
            const devices = this.adapter.discover(params);
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
        case 'connect': {
            if (this.state !== 'discovery') {
                throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'connect is only valid after discover');
            }
            if (params?.peripheralId === undefined) {
                throw new RpcError(RpcErrorCode.INVALID_PARAMS, 'connect requires peripheralId');
            }
            this.adapter.connect(params.peripheralId);
            this.state = 'connected';
            return null;
        }
        case 'send': {
            if (this.state !== 'connected') {
                throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'not connected');
            }
            return this.adapter.send(params?.message, params?.encoding);
        }
        default:
            throw new RpcError(RpcErrorCode.METHOD_NOT_FOUND, `Method not found: ${method}`);
        }
    }

    dispose () {
        this.adapter.dispose();
        this.removeAllListeners();
    }
}
