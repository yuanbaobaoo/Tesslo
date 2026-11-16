import {EventEmitter} from 'node:events';

// ArkTS 侧桥对象的方法名前缀（systemPreferences.callArkTSFunction）
const PREFIX = 'TessloBle.';
// GATT 连接状态枚举（ohos.bluetooth.constant.ProfileConnectionState）
const CONNECTED = 2;
const DISCONNECTED = 0;

// Electron 原生模块仅在设备端 OHOS 运行时存在；桌面/测试环境 require 抛错，
// 返回 null 后由 server.js 回退到 FakeBleAdapter。用 require 而非 import 做可选依赖探测。
const loadBridge = () => {
  try {
    // eslint-disable-next-line global-require
    const {systemPreferences} = require('electron');
    return typeof systemPreferences?.callArkTSFunction === 'function' ? systemPreferences : null;
  } catch {
    return null;
  }
};

/**
 * 当前运行环境是否具备 OHOS ArkTS 桥（决定 server 用真适配器还是 fake）。
 */
export const hasOhosBle = () => loadBridge() !== null;

/**
 * UUID 统一小写，屏蔽桥两端大小写差异。
 */
const normalize = uuid => String(uuid || '').toLowerCase();

/**
 * Web Bluetooth 风格的扫描过滤器：name/namePrefix/services 任一不满足即淘汰。
 */
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

/**
 * 设备内 ArkTS BLE 桥的 JS 侧适配器：实现 discover/connect/GATT 读写与通知，
 * 向 BleSession 发出 'notification' 事件。测试可注入 bridge mock。
 */
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

  /**
   * 调用 ArkTS 桥方法；桥返回 {value} 包装时自动解包。
   */
  async call (name, returnType, args = []) {
    if (!this.bridge) throw new Error('ArkTS bridge unavailable');
    const result = await this.bridge.callArkTSFunction(`${PREFIX}${name}`, returnType, args);
    if (result && typeof result === 'object' && 'value' in result) return result.value;
    return result;
  }

  /**
   * 请求蓝牙权限（20s 超时）；授权码非 0 视为拒绝并 reject。
   */
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

  /**
   * 扫描 scanMs 毫秒，按过滤器去重收集设备；扫描期间桥报错会缓存到扫描结束后抛出。
   */
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
    // StopScan 失败也要清掉回调，避免悬挂引用继续收扫描事件
    try {
      await this.call('StopScan', 'void', []);
    } finally {
      this.scanCallback = null;
    }
    if (scanError) throw scanError;
    return [...found.values()];
  }

  /**
   * 连接外设（10s 超时）；连接中收到 DISCONNECTED 视为失败。
   */
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

  /**
   * 拉取 GATT 服务表并刷新本地 service/characteristic 索引。
   */
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

  /**
   * 请求-应答式桥调用：在 args 末尾附加回调，10s 内等桥回 JSON 结果。
   */
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

  /**
   * 校验 service/characteristic 在已连接设备的 GATT 表内；未收录直接抛错。
   */
  requireCharacteristic (serviceId, characteristicId) {
    const service = normalize(serviceId);
    const characteristic = normalize(characteristicId);
    if (!this.characteristics.has(`${service}/${characteristic}`)) {
      throw new Error(`characteristic not found: ${serviceId}/${characteristicId}`);
    }
    return {service, characteristic};
  }

  /**
   * 读特征值，返回 base64 消息（Scratch Link 协议约定的编码）。
   */
  async read (serviceId, characteristicId) {
    const {service, characteristic} = this.requireCharacteristic(serviceId, characteristicId);
    const result = await this.callWithResult('Read', [this.deviceId, service, characteristic]);
    if (!result.ok) throw new Error(result.error || 'read failed');
    return {message: result.value, encoding: 'base64'};
  }

  /**
   * 写特征值；非 base64 入参先按 UTF-8 转码，返回写入字节数。
   */
  async write (serviceId, characteristicId, message, encoding = null) {
    const {service, characteristic} = this.requireCharacteristic(serviceId, characteristicId);
    const value = encoding === 'base64' ? message : Buffer.from(String(message), 'utf8').toString('base64');
    const result = await this.callWithResult('Write', [this.deviceId, service, characteristic, value]);
    if (!result.ok) throw new Error(result.error || 'write failed');
    return result.length;
  }

  /**
   * 订阅特征变化并转发为 'notification' 事件；重复订阅同一特征是幂等操作。
   */
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

  /**
   * 取消订阅；未订阅过则直接返回。
   */
  async stopNotifications (serviceId, characteristicId) {
    const {service, characteristic} = this.requireCharacteristic(serviceId, characteristicId);
    const key = `${service}/${characteristic}`;
    if (!this.notifyCallbacks.has(key)) return;
    this.notifyCallbacks.delete(key);
    await this.callWithResult('Unsubscribe', [this.deviceId, service, characteristic]);
  }

  /**
   * 释放全部状态并尽力通知桥停止扫描/断开；socket close 时由 server 调用。
   */
  dispose () {
    // 尽力清理：dispose 阶段的桥调用失败只记录、不再上抛
    this.call('StopScan', 'void', []).catch(error =>
      console.warn(`[ohos-ble] stopScan during dispose failed: ${error.message}`)
    );
    if (this.deviceId) {
      this.call('Disconnect', 'void', [this.deviceId]).catch(error =>
        console.warn(`[ohos-ble] disconnect during dispose failed: ${error.message}`)
      );
    }
    this.services.clear();
    this.characteristics.clear();
    this.connectCallbacks.clear();
    this.notifyCallbacks.clear();
    this.removeAllListeners();
  }
}
