import {EventEmitter} from 'node:events';

import {RpcError, RpcErrorCode} from './jsonrpc.js';
import {FakeBleAdapter} from './fake-ble.js';

// Scratch Link BLE 协议版本（与上游 1.3 对齐）
const PROTOCOL_VERSION = '1.3';

/**
 * /scratch/ble 会话：initial -> discovery -> connected 状态机，
 * 把 JSON-RPC 方法委托给 adapter（真桥 OhosBleAdapter 或 fake），通知透传给 server。
 */
export class BleSession extends EventEmitter {
  constructor (adapter = new FakeBleAdapter()) {
    super();
    this.adapter = adapter;
    this.state = 'initial';
    this.adapter.on('notification', (method, params) => {
      this.emit('notification', method, params);
    });
  }

  /**
   * 分发 JSON-RPC 方法；状态不合法抛 INVALID_REQUEST，未知方法抛 METHOD_NOT_FOUND。
   */
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
      return this.adapter.getServices();
    case 'read':
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

  /**
   * 仅 initial 状态可扫描；发现结果经 didDiscoverPeripheral 通知异步发出。
   */
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
    // 通知在响应之后发出：先 resolve 本请求，再投递发现结果
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

  /**
   * 仅 discovery 状态可连接；成功后进入 connected。
   */
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

  /**
   * 未连接时抛 INVALID_REQUEST；GATT 操作前的前置校验。
   */
  requireConnected () {
    if (this.state !== 'connected') {
      throw new RpcError(RpcErrorCode.INVALID_REQUEST, 'not connected');
    }
  }

  /**
   * 读特征值；params.startNotifications 为真时顺带开启订阅。
   */
  async read (params) {
    this.requireConnected();
    const result = await this.adapter.read(params?.serviceId, params?.characteristicId);
    if (params?.startNotifications) {
      await this.adapter.startNotifications(params.serviceId, params.characteristicId, params.encoding);
    }
    return result;
  }

  /**
   * 写特征值，返回写入长度。
   */
  async write (params) {
    this.requireConnected();
    return this.adapter.write(
      params?.serviceId,
      params?.characteristicId,
      params?.message,
      params?.encoding
    );
  }

  /**
   * 开启特征变化订阅，变化经 characteristicDidChange 通知转发。
   */
  async startNotifications (params) {
    this.requireConnected();
    await this.adapter.startNotifications(params?.serviceId, params?.characteristicId, params?.encoding);
    return null;
  }

  /**
   * 关闭特征变化订阅。
   */
  async stopNotifications (params) {
    this.requireConnected();
    await this.adapter.stopNotifications(params?.serviceId, params?.characteristicId);
    return null;
  }

  /**
   * 释放适配器资源并清空监听；socket close 时由 server 调用。
   */
  dispose () {
    this.adapter.dispose();
    this.removeAllListeners();
  }
}
