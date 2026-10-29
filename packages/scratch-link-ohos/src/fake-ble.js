import {EventEmitter} from 'node:events';

export const MICROBIT_SERVICE = '0000f005-0000-1000-8000-00805f9b34fb';
export const MICROBIT_WRITE_CHARACTERISTIC = '0000f002-0000-1000-8000-00805f9b34fb';
export const MICROBIT_NOTIFY_CHARACTERISTIC = '0000f004-0000-1000-8000-00805f9b34fb';

const normalizeUuid = value => {
    if (typeof value === 'number') {
        return `0000${value.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
    }
    if (typeof value !== 'string') return value;
    const trimmed = value.trim().toLowerCase();
    if (/^[0-9a-f]{4}$/.test(trimmed)) {
        return `0000${trimmed}-0000-1000-8000-00805f9b34fb`;
    }
    if (/^0x[0-9a-f]{4}$/.test(trimmed)) {
        return `0000${trimmed.slice(2)}-0000-1000-8000-00805f9b34fb`;
    }
    return trimmed;
};

const defaultDevices = () => [{
    peripheralId: 1,
    name: 'Tesslo Fake micro:bit',
    rssi: -61,
    manufacturerData: {},
    services: [{
        uuid: MICROBIT_SERVICE,
        characteristics: [
            {uuid: MICROBIT_WRITE_CHARACTERISTIC, value: Buffer.from('')},
            {uuid: MICROBIT_NOTIFY_CHARACTERISTIC, value: Buffer.from('ping'), notify: true}
        ]
    }]
}];

export class FakeBleAdapter extends EventEmitter {
    constructor (devices = defaultDevices()) {
        super();
        this.devices = devices;
        this.connected = null;
        this.allowedServices = new Set();
        this.notifyTimers = new Map();
        this.notifyCounter = 0;
    }

    static normalizeUuid (value) {
        return normalizeUuid(value);
    }

    matchesFilter (device, filter) {
        if (!filter || typeof filter !== 'object') return false;
        if (filter.name && device.name !== filter.name) return false;
        if (filter.namePrefix && !device.name.startsWith(filter.namePrefix)) return false;
        if (filter.services) {
            const advertised = new Set(device.services.map(service => normalizeUuid(service.uuid)));
            for (const service of filter.services) {
                if (!advertised.has(normalizeUuid(service))) return false;
            }
        }
        if (filter.manufacturerData) {
            for (const [id, expected] of Object.entries(filter.manufacturerData)) {
                const actual = device.manufacturerData?.[id];
                if (actual === undefined) return false;
                if (expected && typeof expected === 'object' && expected.dataPrefix) {
                    const bytes = Buffer.from(actual);
                    const prefix = Buffer.from(expected.dataPrefix);
                    const mask = expected.mask ? Buffer.from(expected.mask) : Buffer.alloc(prefix.length, 0xff);
                    for (let i = 0; i < prefix.length; i++) {
                        if ((bytes[i] & mask[i]) !== (prefix[i] & mask[i])) return false;
                    }
                }
            }
        }
        return true;
    }

    discover (params) {
        const filters = params?.filters;
        if (!Array.isArray(filters) || filters.length === 0) {
            throw new Error('discover requires at least one filter');
        }
        for (const service of params.optionalServices ?? []) {
            this.allowedServices.add(normalizeUuid(service));
        }
        for (const filter of filters) {
            for (const service of filter?.services ?? []) {
                this.allowedServices.add(normalizeUuid(service));
            }
        }
        return this.devices.filter(device =>
            filters.some(filter => this.matchesFilter(device, filter))
        );
    }

    connect (peripheralId) {
        const device = this.devices.find(candidate => candidate.peripheralId === peripheralId);
        if (!device) throw new Error(`unknown peripheralId: ${peripheralId}`);
        this.connected = device;
        for (const service of device.services) {
            this.allowedServices.add(normalizeUuid(service.uuid));
        }
        return device;
    }

    requireConnected () {
        if (!this.connected) throw new Error('not connected to a peripheral');
        return this.connected;
    }

    findCharacteristic (serviceId, characteristicId) {
        const device = this.requireConnected();
        const services = device.services.filter(service =>
            !serviceId || normalizeUuid(service.uuid) === normalizeUuid(serviceId)
        );
        for (const service of services) {
            if (!this.allowedServices.has(normalizeUuid(service.uuid))) continue;
            const characteristic = service.characteristics.find(candidate =>
                normalizeUuid(candidate.uuid) === normalizeUuid(characteristicId)
            );
            if (characteristic) return {service, characteristic};
        }
        throw new Error(`characteristic not found or not allowed: ${serviceId}/${characteristicId}`);
    }

    getServices () {
        const device = this.requireConnected();
        return device.services
            .map(service => normalizeUuid(service.uuid))
            .filter(serviceId => this.allowedServices.has(serviceId));
    }

    read (serviceId, characteristicId) {
        const {characteristic} = this.findCharacteristic(serviceId, characteristicId);
        return {
            message: characteristic.value.toString('base64'),
            encoding: 'base64'
        };
    }

    write (serviceId, characteristicId, message, encoding = null) {
        const {characteristic} = this.findCharacteristic(serviceId, characteristicId);
        const bytes = encoding === 'base64' ?
            Buffer.from(message, 'base64') :
            Buffer.from(String(message), 'utf8');
        characteristic.value = bytes;
        return bytes.length;
    }

    startNotifications (serviceId, characteristicId, encoding = 'base64') {
        const {service, characteristic} = this.findCharacteristic(serviceId, characteristicId);
        const key = `${normalizeUuid(service.uuid)}/${normalizeUuid(characteristic.uuid)}`;
        if (this.notifyTimers.has(key)) return;

        const timer = setInterval(() => {
            this.notifyCounter += 1;
            const value = Buffer.from(`tick-${this.notifyCounter}`);
            characteristic.value = value;
            this.emit('notification', 'characteristicDidChange', {
                serviceId: normalizeUuid(service.uuid),
                characteristicId: normalizeUuid(characteristic.uuid),
                message: value.toString(encoding === 'base64' ? 'base64' : 'utf8'),
                encoding
            });
        }, 150);
        this.notifyTimers.set(key, timer);
    }

    stopNotifications (serviceId, characteristicId) {
        const {service, characteristic} = this.findCharacteristic(serviceId, characteristicId);
        const key = `${normalizeUuid(service.uuid)}/${normalizeUuid(characteristic.uuid)}`;
        const timer = this.notifyTimers.get(key);
        if (timer) clearInterval(timer);
        this.notifyTimers.delete(key);
    }

    dispose () {
        for (const timer of this.notifyTimers.values()) clearInterval(timer);
        this.notifyTimers.clear();
        this.connected = null;
        this.removeAllListeners();
    }
}

export {normalizeUuid};
