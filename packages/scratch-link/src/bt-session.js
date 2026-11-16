import {EventEmitter} from 'node:events';

import {RpcError, RpcErrorCode} from './jsonrpc.js';

// Scratch Link BT 经典协议版本（与上游 1.3 对齐）
const PROTOCOL_VERSION = '1.3';

/**
 * 模拟设备清单：默认一台 EV3，满足 BT 路径的最小联调需求。
 */
const defaultDevices = () => [{
  peripheralId: 101,
  name: 'Tesslo Fake EV3',
  rssi: -70
}];

/**
 * BT 经典模拟适配器：回显 send 消息（didReceiveMessage），无真实蓝牙。
 */
export class FakeBtAdapter extends EventEmitter {
  constructor (devices = defaultDevices()) {
    super();
    this.devices = devices;
    this.connected = null;
  }

  /**
   * 返回模拟设备清单。
   */
  discover () {
    return this.devices;
  }

  /**
   * 按 peripheralId 连接；未知设备抛错。
   */
  connect (peripheralId) {
    const device = this.devices.find(candidate => candidate.peripheralId === peripheralId);
    if (!device) throw new Error(`unknown peripheralId: ${peripheralId}`);
    this.connected = device;
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
   * 回显消息：异步以 didReceiveMessage 通知原样发回，返回字节数。
   */
  send (message, encoding = null) {
    this.requireConnected();
    const bytes = encoding === 'base64' ?
      Buffer.from(message, 'base64') :
      Buffer.from(String(message), 'utf8');
    // 通知在响应之后发出：先 resolve 本请求，再回显消息
    setImmediate(() => {
      this.emit('notification', 'didReceiveMessage', {
        message: bytes.toString('base64'),
        encoding: 'base64'
      });
    });
    return bytes.length;
  }

  /**
   * 断开并清空监听。
   */
  dispose () {
    this.connected = null;
    this.removeAllListeners();
  }
}

/**
 * /scratch/bt 会话：initial -> discovery -> connected 状态机，
 * 方法委托给 adapter（当前仅有 fake 实现；OHOS 真机 BT 尚未接通）。
 */
export class BtSession extends EventEmitter {
  constructor (adapter = new FakeBtAdapter()) {
    super();
    this.adapter = adapter;
    this.state = 'initial';
    this.adapter.on('notification', (method, params) => {
      this.emit('notification', method, params);
    });
  }

  /**
   * 分发 JSON-RPC 方法（getVersion/discover/connect/send）。
   */
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

  /**
   * 释放适配器资源并清空监听。
   */
  dispose () {
    this.adapter.dispose();
    this.removeAllListeners();
  }
}
