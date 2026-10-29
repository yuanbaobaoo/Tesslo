import {EventEmitter} from 'node:events';

const PREFIX = 'TessloBle.';
const CONNECTED = 2;
const DISCONNECTED = 0;

const loadBridge = () => {
    try {
        // eslint-disable-next-line global-require
        const {systemPreferences} = require('electron');
        return typeof systemPreferences?.callArkTSFunction === 'function' ? systemPreferences : null;
    } catch {
        return null;
    }
};

export const hasOhosBle = () => loadBridge() !== null;

const normalize = uuid => String(uuid || '').toLowerCase();

const matchesFilter = (device, filter) => {
    if (!filter || typeof filter !== 'object') return false;
    if (filter.name && device.name !== filter.name) return false;
    if (filter.namePrefix && !device.name?.startsWith(filter.namePrefix)) return false;
    if (Array.isArray(filter.services) && filter.services.length > 0) {
        const advertised = new Set((device.services || []).map(normalize));
        if (!filter.services.some(service => advertised.has(normalize(service)))) return false;
    }
    return true;
};

export class OhosBleAdapter extends EventEmitter {
    constructor ({bridge = loadBridge(), scanMs = 4000} = {}) {
        super();
        this.bridge = bridge;
        this.scanMs = scanMs;
        this.services = new Map();
        this.characteristics = new Set();
        this.scanCallback = null;
        this.connectCallbacks = new Map();
        this.notifyCallbacks = new Map();
        this.deviceId = null;
    }

    async call (name, returnType, args = []) {
        if (!this.bridge) throw new Error('ArkTS bridge unavailable');
        const result = await this.bridge.callArkTSFunction(`${PREFIX}${name}`, returnType, args);
        if (result && typeof result === 'object' && 'value' in result) return result.value;
        return result;
    }

    async requestPermission () {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('bluetooth permission timeout')), 20000);
            this.bridge.callArkTSFunction('PermissionManagerAdapter.RequestPermissionCode', 'void', [
                'bluetooth',
                code => {
                    clearTimeout(timer);
                    if (code === 0) resolve();
                    else reject(new Error(`bluetooth permission denied: ${code}`));
                }
            ]).catch(error => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    async discover (params = {}) {
        const filters = Array.isArray(params.filters) ? params.filters : [];
        if (filters.length === 0) throw new Error('discover requires at least one filter');
        await this.requestPermission();

        const found = new Map();
        let scanError = null;
        const onScan = raw => {
            let event;
            try {
                event = JSON.parse(raw);
            } catch {
                return;
            }
            if (event.kind === 'error') {
                scanError = new Error(event.message || 'Bluetooth scan failed');
                return;
            }
            if (event.kind !== 'scan' || !event.deviceId) return;
            const device = {
                peripheralId: event.deviceId,
                name: event.name || '',
                rssi: event.rssi ?? 0,
                services: event.services || []
            };
            if (!filters.some(filter => matchesFilter(device, filter))) return;
            found.set(device.peripheralId, device);
        };
        this.scanCallback = onScan;
        await this.call('StartScan', 'void', [onScan]);
        await new Promise(resolve => setTimeout(resolve, params.timeoutMs ?? this.scanMs));
        await this.call('StopScan', 'void', []);
        this.scanCallback = null;
        if (scanError) throw scanError;
        return [...found.values()];
    }

    async connect (peripheralId) {
        if (!peripheralId) throw new Error('connect requires peripheralId');
        this.deviceId = String(peripheralId);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('connect timeout')), 10000);
            const onState = raw => {
                let event;
                try {
                    event = JSON.parse(raw);
                } catch {
                    return;
                }
                if (event.kind !== 'state') return;
                if (event.state === CONNECTED) {
                    clearTimeout(timer);
                    resolve();
                } else if (event.state === DISCONNECTED) {
                    clearTimeout(timer);
                    reject(new Error('peripheral disconnected'));
                }
            };
            this.connectCallbacks.set(this.deviceId, onState);
            this.call('Connect', 'void', [this.deviceId, onState]).catch(error => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    async getServices () {
        const result = await this.callWithResult('GetServices', [this.deviceId]);
        if (!result.ok) throw new Error(result.error || 'getServices failed');
        this.services.clear();
        this.characteristics.clear();
        for (const service of result.services) {
            const serviceId = normalize(service.uuid);
            this.services.set(serviceId, service);
            for (const characteristic of service.characteristics || []) {
                const id = normalize(characteristic.uuid);
                this.characteristics.add(`${serviceId}/${id}`);
            }
        }
        return [...this.services.keys()];
    }

    callWithResult (name, args) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${name} timeout`)), 10000);
            const onResult = raw => {
                clearTimeout(timer);
                try {
                    resolve(JSON.parse(raw));
                } catch (error) {
                    reject(error);
                }
            };
            this.call(name, 'void', [...args, onResult]).catch(error => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    requireCharacteristic (serviceId, characteristicId) {
        const service = normalize(serviceId);
        const characteristic = normalize(characteristicId);
        if (!this.characteristics.has(`${service}/${characteristic}`)) {
            throw new Error(`characteristic not found: ${serviceId}/${characteristicId}`);
        }
        return {service, characteristic};
    }

    async read (serviceId, characteristicId) {
        const {service, characteristic} = this.requireCharacteristic(serviceId, characteristicId);
        const result = await this.callWithResult('Read', [this.deviceId, service, characteristic]);
        if (!result.ok) throw new Error(result.error || 'read failed');
        return {message: result.value, encoding: 'base64'};
    }

    async write (serviceId, characteristicId, message, encoding = null) {
        const {service, characteristic} = this.requireCharacteristic(serviceId, characteristicId);
        const value = encoding === 'base64' ? message : Buffer.from(String(message), 'utf8').toString('base64');
        const result = await this.callWithResult('Write', [this.deviceId, service, characteristic, value]);
        if (!result.ok) throw new Error(result.error || 'write failed');
        return result.length;
    }

    async startNotifications (serviceId, characteristicId) {
        const {service, characteristic} = this.requireCharacteristic(serviceId, characteristicId);
        const key = `${service}/${characteristic}`;
        if (this.notifyCallbacks.has(key)) return;
        const onEvent = raw => {
            let event;
            try {
                event = JSON.parse(raw);
            } catch {
                return;
            }
            if (event.kind !== 'notification') return;
            this.emit('notification', 'characteristicDidChange', {
                serviceId: normalize(event.serviceId),
                characteristicId: normalize(event.characteristicId),
                message: event.value,
                encoding: 'base64'
            });
        };
        this.notifyCallbacks.set(key, onEvent);
        await this.call('Subscribe', 'void', [this.deviceId, service, characteristic, onEvent]);
    }

    async stopNotifications (serviceId, characteristicId) {
        const {service, characteristic} = this.requireCharacteristic(serviceId, characteristicId);
        const key = `${service}/${characteristic}`;
        if (!this.notifyCallbacks.has(key)) return;
        this.notifyCallbacks.delete(key);
        await this.callWithResult('Unsubscribe', [this.deviceId, service, characteristic]);
    }

    dispose () {
        try {
            this.call('StopScan', 'void', []).catch(() => {});
            if (this.deviceId) this.call('Disconnect', 'void', [this.deviceId]).catch(() => {});
        } catch {
            // best effort
        }
        this.services.clear();
        this.characteristics.clear();
        this.connectCallbacks.clear();
        this.notifyCallbacks.clear();
        this.removeAllListeners();
    }
}
