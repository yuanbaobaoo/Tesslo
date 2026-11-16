import {EventEmitter} from 'node:events';

// micro:bit 官方服务与写/通知特征 UUID（16-bit 别名按 Bluetooth base UUID 展开）
export const MICROBIT_SERVICE = '0000f005-0000-1000-8000-00805f9b34fb';
export const MICROBIT_WRITE_CHARACTERISTIC = '0000f002-0000-1000-8000-00805f9b34fb';
export const MICROBIT_NOTIFY_CHARACTERISTIC = '0000f004-0000-1000-8000-00805f9b34fb';

/**
 * UUID 归一化：数字/4 位十六进制/0x 前缀统一展开为 128 位小写字符串。
 */
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

/**
 * 模拟设备清单：默认一台 micro:bit，写/通知特征覆盖最小联调路径。
 */
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

/**
 * BLE 模拟适配器：内存 GATT 表 + 定时通知，行为对齐 Web Bluetooth 语义
 * （服务白名单、过滤器匹配），供桌面/CI 环境联调与测试。
 */
export class FakeBleAdapter extends EventEmitter {
  constructor (devices = defaultDevices()) {
    super();
    this.devices = devices;
    this.connected = null;
    // Web Bluetooth 语义：只有显式请求/发现过的服务才允许访问
    this.allowedServices = new Set();
    this.notifyTimers = new Map();
    this.notifyCounter = 0;
  }

  /**
   * UUID 归一化的静态出口，便于测试复用。
   */
  static normalizeUuid (value) {
    return normalizeUuid(value);
  }

  /**
   * Web Bluetooth 风格过滤器匹配：name/namePrefix/services/manufacturerData 全过才命中。
   */
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

  /**
   * 按过滤器筛选设备，并把请求过的服务收进白名单。
   */
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

  /**
   * 连接后把设备全部服务收进白名单（与 Web Bluetooth 连接后可达语义一致）。
   */
  connect (peripheralId) {
    const device = this.devices.find(candidate => candidate.peripheralId === peripheralId);
    if (!device) throw new Error(`unknown peripheralId: ${peripheralId}`);
    this.connected = device;
    for (const service of device.services) {
      this.allowedServices.add(normalizeUuid(service.uuid));
    }
    return device;
  }

  /**
   * 未连接时抛错；返回当前连接设备。
   */
  requireConnected () {
    if (!this.connected) throw new Error('not connected to a peripheral');
    return this.connected;
  }

  /**
   * 在白名单服务里定位特征；找不到或不在白名单内统一抛错。
   */
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

  /**
   * 返回白名单内的服务 UUID 列表。
   */
  getServices () {
    const device = this.requireConnected();
    return device.services
      .map(service => normalizeUuid(service.uuid))
      .filter(serviceId => this.allowedServices.has(serviceId));
  }

  /**
   * 读特征值，返回 base64 消息（协议约定编码）。
   */
  read (serviceId, characteristicId) {
    const {characteristic} = this.findCharacteristic(serviceId, characteristicId);
    return {
      message: characteristic.value.toString('base64'),
      encoding: 'base64'
    };
  }

  /**
   * 写特征值：更新内存值，返回写入字节数。
   */
  write (serviceId, characteristicId, message, encoding = null) {
    const {characteristic} = this.findCharacteristic(serviceId, characteristicId);
    const bytes = encoding === 'base64' ?
      Buffer.from(message, 'base64') :
      Buffer.from(String(message), 'utf8');
    characteristic.value = bytes;
    return bytes.length;
  }

  /**
   * 开启订阅：每 150ms 回一条递增的 tick 值，模拟真实外设的持续上报。
   */
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

  /**
   * 关闭订阅并清掉对应定时器。
   */
  stopNotifications (serviceId, characteristicId) {
    const {service, characteristic} = this.findCharacteristic(serviceId, characteristicId);
    const key = `${normalizeUuid(service.uuid)}/${normalizeUuid(characteristic.uuid)}`;
    const timer = this.notifyTimers.get(key);
    if (timer) clearInterval(timer);
    this.notifyTimers.delete(key);
  }

  /**
   * 清掉全部订阅定时器并断开；测试结束必须调用，防止定时器悬挂。
   */
  dispose () {
    for (const timer of this.notifyTimers.values()) clearInterval(timer);
    this.notifyTimers.clear();
    this.connected = null;
    this.removeAllListeners();
  }
}

export {normalizeUuid};
