// 设备内 BLE 桥：为 C# Scratch Link（scratch-link-ohos）提供 BLE 能力。
// 协议：TCP 行式 JSON——客户端发 {"op":...} 请求行，桥按行回 {"event":...} 事件。
// simulate 模式用内置模拟外设，供模拟器/无蓝牙环境调试。

import socket from '@ohos.net.socket';
import util from '@ohos.util';
import ble from '@ohos.bluetooth.ble';
import access from '@ohos.bluetooth.access';
import constant from '@ohos.bluetooth.constant';
import { abilityAccessCtrl, Permissions, common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

import { log } from '../common/AppLog';
import { BLE_BRIDGE_PORT } from '../common/Ports';

// 单轮扫描窗口时长（毫秒），窗口结束自动 stopScan 并下发 scanEnd
const SCAN_MS: number = 4000;
// 扫描结果上报周期（毫秒）
const SCAN_REPORT_INTERVAL_MS: number = 500;
// 蓝牙扫描/连接所需的最小权限集合
const BLUETOOTH_PERMISSIONS: Array<Permissions> = ['ohos.permission.ACCESS_BLUETOOTH'];

// GATT 特征属性位（Bluetooth Core Spec 位定义，原样上报给 C# 侧做能力判断）
const PROPERTY_READ: number = 1 << 1; // 0x02
const PROPERTY_WRITE_NO_RESPONSE: number = 1 << 2; // 0x04
const PROPERTY_WRITE: number = 1 << 3; // 0x08
const PROPERTY_NOTIFY: number = 1 << 4; // 0x10
const PROPERTY_INDICATE: number = 1 << 5; // 0x20

// micro:bit 与 WeDo 2.0 的服务/特征 UUID：模拟设备与真实设备共用同一协议路径
const MICROBIT_SERVICE: string = '0000f005-0000-1000-8000-00805f9b34fb';
const MICROBIT_RX: string = '5261da01-fa7e-42ab-850b-7c80220097cc';
const MICROBIT_TX: string = '5261da02-fa7e-42ab-850b-7c80220097cc';
const WEDO_DEVICE_SERVICE: string = '00001523-1212-efde-1523-785feabcd123';
const WEDO_IO_SERVICE: string = '00004f0e-1212-efde-1523-785feabcd123';
const WEDO_ATTACHED: string = '00001527-1212-efde-1523-785feabcd123';
const WEDO_BATTERY: string = '00001528-1212-efde-1523-785feabcd123';
const WEDO_INPUT_COMMAND: string = '00001563-1212-efde-1523-785feabcd123';
const WEDO_OUTPUT_COMMAND: string = '00001565-1212-efde-1523-785feabcd123';

// 桥协议请求行；字段与 C# 侧 OhosBleClient.BridgeRequest 一一对应，改动需两侧同步
interface BridgeCommand {
  op: string;
  id?: number;
  deviceId?: string;
  serviceId?: string;
  characteristicId?: string;
  message?: string;
  withResponse?: boolean;
}

// 上报给客户端的特征：uuid + GATT 属性位掩码
interface BridgeCharacteristic {
  uuid: string;
  properties: number;
}

// 上报给客户端的服务及其特征列表
interface BridgeService {
  uuid: string;
  characteristics: Array<BridgeCharacteristic>;
}

// 桥协议事件行：按 event 字段路由，可选字段因事件类型而异
interface BridgeEvent {
  event: string;
  id?: number;
  ok?: boolean;
  error?: string;
  message?: string;
  deviceId?: string;
  name?: string;
  rssi?: number;
  services?: Array<string>;
  serviceId?: string;
  characteristicId?: string;
  value?: string;
  length?: number;
  serviceList?: Array<BridgeService>;
}

// 一台已连接外设的会话状态：客户端句柄 + 特征缓存 + 订阅集合
interface GattSession {
  device: ble.GattClientDevice;
  characteristics: Map<string, ble.BLECharacteristic>;
  notifications: Set<string>;
  // true 表示 connect 尚未完成：此阶段收到 DISCONNECTED 视为连接失败而非正常断开
  connecting: boolean;
}

// 模拟外设的特征：value 保存可读写的当前值
interface SimCharacteristic {
  uuid: string;
  properties: number;
  value: ArrayBuffer;
}

// 模拟外设的服务
interface SimService {
  uuid: string;
  characteristics: Array<SimCharacteristic>;
}

// 模拟外设（扫描结果与连接对象）
interface SimDevice {
  id: string;
  name: string;
  rssi: number;
  services: Array<SimService>;
}

// 模拟模式的连接上下文：当前连接的外设 + 已订阅特征
interface SimContext {
  connected: string | null;
  subscriptions: Map<string, SimCharacteristic>;
}

// 单客户端约定：C# Scratch Link 是本桥唯一 TCP 客户端；
// sessions/scanCallback 按单连接设计，多客户端并发会互相覆盖扫描回调
const sessions: Map<string, GattSession> = new Map();
// 当前扫描回调（单槽位）：stopScan 时据此反注册
let scanCallback: ((results: Array<ble.ScanResult>) => void) | null = null;
// 权限授权后缓存，避免每次扫描/连接都弹窗
let blePermissionGranted: boolean = false;
// 当前监听实例与活跃连接，供 stopTessloBleBridge 成对释放
let bridgeServer: socket.TCPSocketServer | null = null;
const bridgeClients: Set<socket.TCPSocketConnection> = new Set();

/**
 * 首次扫描/连接前向用户申请蓝牙权限；授权结果缓存，重复调用不重复弹窗。
 * @param context 用于弹权限框的 UIAbility 上下文
 * @returns 用户是否授权
 */
async function ensureBlePermission(context: common.UIAbilityContext): Promise<boolean> {
  if (blePermissionGranted) return true;
  try {
    const result = await abilityAccessCtrl.createAtManager()
      .requestPermissionsFromUser(context, BLUETOOTH_PERMISSIONS);
    const granted = result.authResults.every(status => status === 0);
    if (granted) {
      blePermissionGranted = true;
    } else {
      log('bluetooth permission denied by user');
    }
    return granted;
  } catch (error) {
    log(`bluetooth permission request failed: ${(error as BusinessError).message ?? error}`);
    return false;
  }
}

/**
 * ArrayBuffer 编码为 base64（桥协议里二进制统一走 base64 文本）。
 */
function toBase64(value: ArrayBuffer): string {
  return new util.Base64Helper().encodeToStringSync(new Uint8Array(value));
}

/**
 * base64 解码为 ArrayBuffer。
 */
function fromBase64(value: string): ArrayBuffer {
  // decodeSync 返回的 Uint8Array 独占自己的 buffer，断言为 ArrayBuffer 是安全的
  const bytes: Uint8Array = new util.Base64Helper().decodeSync(value);
  return bytes.buffer as ArrayBuffer;
}

/**
 * 下发一行 JSON 事件；连接已断等失败只记录，不向上抛。
 */
function send(client: socket.TCPSocketConnection, payload: BridgeEvent): void {
  client.send({data: JSON.stringify(payload) + '\n'}).catch((error: Error) => {
    log(`send failed: ${error.message}`);
  });
}

/**
 * 服务/特征复合键：统一小写，屏蔽桥两端 UUID 大小写差异。
 */
function key(serviceId: string, characteristicId: string): string {
  return `${serviceId.toLowerCase()}/${characteristicId.toLowerCase()}`;
}

/**
 * 把平台属性结构折叠成 GATT 位掩码，供 C# 侧判断读写/通知能力。
 */
function propertiesOf(characteristic: ble.BLECharacteristic): number {
  let properties: number = 0;
  if (characteristic.properties?.write) properties |= PROPERTY_WRITE;
  if (characteristic.properties?.read) properties |= PROPERTY_READ;
  if (characteristic.properties?.notify) properties |= PROPERTY_NOTIFY;
  if (characteristic.properties?.writeNoResponse) properties |= PROPERTY_WRITE_NO_RESPONSE;
  if (characteristic.properties?.indicate) properties |= PROPERTY_INDICATE;
  return properties;
}

/**
 * 枚举 GATT 服务并刷新 session.characteristics 缓存（read/write 依赖该缓存）。
 */
async function loadServices(session: GattSession): Promise<Array<BridgeService>> {
  const services: Array<ble.GattService> = await session.device.getServices();
  const output: Array<BridgeService> = [];
  session.characteristics.clear();
  for (const service of services) {
    const characteristics: Array<BridgeCharacteristic> = [];
    for (const characteristic of service.characteristics) {
      session.characteristics.set(
        key(service.serviceUuid, characteristic.characteristicUuid),
        characteristic
      );
      characteristics.push({
        uuid: characteristic.characteristicUuid,
        properties: propertiesOf(characteristic)
      });
    }
    output.push({uuid: service.serviceUuid, characteristics: characteristics});
  }
  return output;
}

/**
 * 处理单条桥命令；任何失败都以 error 事件回执，绝不静默丢命令。
 */
async function handleCommand(client: socket.TCPSocketConnection, command: BridgeCommand,
  context: common.UIAbilityContext): Promise<void> {
  try {
    if (command.op === 'connect') {
      const deviceId: string = command.deviceId ?? '';
      if (deviceId.length === 0) {
        send(client, {event: 'error', id: command.id, error: 'connect requires deviceId'});
        return;
      }
      if (sessions.has(deviceId)) {
        send(client, {event: 'connect', id: command.id, ok: true});
        return;
      }
      const permitted: boolean = await ensureBlePermission(context);
      if (!permitted) {
        send(client, {event: 'error', id: command.id, error: 'bluetooth permission denied'});
        return;
      }
      const device: ble.GattClientDevice = ble.createGattClientDevice(deviceId);
      const session: GattSession = {
        device: device,
        characteristics: new Map(),
        notifications: new Set(),
        connecting: true
      };
      device.on('BLEConnectionStateChange', (state: ble.BLEConnectionChangeState) => {
        if (state.state === constant.ProfileConnectionState.STATE_CONNECTED) {
          session.connecting = false;
          sessions.set(deviceId, session);
          send(client, {event: 'connect', id: command.id, ok: true});
        } else if (state.state === constant.ProfileConnectionState.STATE_DISCONNECTED) {
          sessions.delete(deviceId);
          session.notifications.clear();
          if (session.connecting) {
            // 连接尚未建立就断开：回 error 而不是 disconnect，让调用方立即失败
            session.connecting = false;
            send(client, {event: 'error', id: command.id,
              error: 'connect failed: device disconnected'});
          } else {
            send(client, {event: 'disconnect', id: command.id, deviceId: deviceId});
          }
        }
      });
      device.on('BLECharacteristicChange', (characteristic: ble.BLECharacteristic) => {
        const id = key(characteristic.serviceUuid, characteristic.characteristicUuid);
        if (!session.notifications.has(id)) return;
        send(client, {
          event: 'notification',
          serviceId: characteristic.serviceUuid,
          characteristicId: characteristic.characteristicUuid,
          value: toBase64(characteristic.characteristicValue)
        });
      });
      device.connect();
      return;
    }

    const deviceId: string = command.deviceId ?? '';
    const session: GattSession | undefined = sessions.get(deviceId);
    if (command.op === 'disconnect') {
      if (session) {
        session.device.disconnect();
        session.notifications.clear();
        sessions.delete(deviceId);
      }
      send(client, {event: 'disconnect', id: command.id, deviceId: deviceId});
      return;
    }
    if (command.op === 'getServices') {
      if (!session) throw new Error('peripheral is not connected');
      const serviceList: Array<BridgeService> = await loadServices(session);
      send(client, {event: 'services', id: command.id, ok: true, serviceList: serviceList});
      return;
    }
    if (!session) throw new Error('peripheral is not connected');
    const characteristic = session.characteristics.get(key(
      command.serviceId ?? '', command.characteristicId ?? ''
    ));
    if (!characteristic) throw new Error('characteristic not found');

    if (command.op === 'read') {
      const result: ble.BLECharacteristic = await session.device.readCharacteristicValue(characteristic);
      send(client, {
        event: 'read',
        id: command.id,
        ok: true,
        value: toBase64(result.characteristicValue ?? characteristic.characteristicValue)
      });
      return;
    }
    if (command.op === 'write') {
      const value: ArrayBuffer = fromBase64(command.message ?? '');
      characteristic.characteristicValue = value;
      const writeType: ble.GattWriteType = command.withResponse === false ?
        ble.GattWriteType.WRITE_NO_RESPONSE : ble.GattWriteType.WRITE;
      await session.device.writeCharacteristicValue(characteristic, writeType);
      send(client, {event: 'write', id: command.id, ok: true, length: value.byteLength});
      return;
    }
    if (command.op === 'subscribe') {
      await session.device.setCharacteristicChangeNotification(characteristic, true);
      session.notifications.add(key(characteristic.serviceUuid, characteristic.characteristicUuid));
      send(client, {event: 'subscribed', id: command.id, ok: true});
      return;
    }
    if (command.op === 'unsubscribe') {
      await session.device.setCharacteristicChangeNotification(characteristic, false);
      session.notifications.delete(key(characteristic.serviceUuid, characteristic.characteristicUuid));
      send(client, {event: 'unsubscribed', id: command.id, ok: true});
      return;
    }
    send(client, {event: 'error', id: command.id, error: `unsupported op: ${command.op}`});
  } catch (error) {
    send(client, {event: 'error', id: command.id, error: `${error.message ?? error}`});
  }
}

/**
 * 模拟外设清单：micro:bit + WeDo 2.0，覆盖订阅即回包的最小行为。
 */
function simDevices(): Array<SimDevice> {
  return [
    {
      id: 'sim-microbit-1',
      name: 'BBC micro:bit [tesslo]',
      rssi: -45,
      services: [{
        uuid: MICROBIT_SERVICE,
        characteristics: [
          {uuid: MICROBIT_RX, properties: PROPERTY_WRITE, value: new ArrayBuffer(0)},
          {uuid: MICROBIT_TX, properties: PROPERTY_NOTIFY, value: new ArrayBuffer(0)}
        ]
      }]
    },
    {
      id: 'sim-wedo-1',
      name: 'LEGO WeDo 2.0 [tesslo]',
      rssi: -50,
      services: [
        {
          uuid: WEDO_DEVICE_SERVICE,
          characteristics: [
            {uuid: WEDO_ATTACHED, properties: PROPERTY_NOTIFY, value: new ArrayBuffer(0)},
            {uuid: WEDO_BATTERY, properties: PROPERTY_READ,
              value: new Uint8Array([100]).buffer as ArrayBuffer}
          ]
        },
        {
          uuid: WEDO_IO_SERVICE,
          characteristics: [
            {uuid: WEDO_INPUT_COMMAND, properties: PROPERTY_WRITE, value: new ArrayBuffer(0)},
            {uuid: WEDO_OUTPUT_COMMAND, properties: PROPERTY_WRITE, value: new ArrayBuffer(0)}
          ]
        }
      ]
    }
  ];
}

/**
 * 模拟设备的 GATT 表转成桥协议的 serviceList 结构。
 */
function simServices(device: SimDevice): Array<BridgeService> {
  return device.services.map((service: SimService): BridgeService => ({
    uuid: service.uuid,
    characteristics: service.characteristics.map((item: SimCharacteristic): BridgeCharacteristic => ({
      uuid: item.uuid,
      properties: item.properties
    }))
  }));
}

/**
 * 按服务/特征 UUID（忽略大小写）查找模拟特征；找不到返回 null。
 */
function simFind(device: SimDevice, serviceId: string, characteristicId: string): SimCharacteristic | null {
  const service = device.services.find((item: SimService) =>
    item.uuid.toLowerCase() === serviceId.toLowerCase());
  if (!service) return null;
  return service.characteristics.find((item: SimCharacteristic) =>
    item.uuid.toLowerCase() === characteristicId.toLowerCase()) ?? null;
}

/**
 * 模拟通知：把字节序列以 notification 事件发给客户端。
 */
function simNotification(client: socket.TCPSocketConnection, serviceId: string,
  characteristicId: string, bytes: number[]): void {
  send(client, {
    event: 'notification',
    serviceId: serviceId,
    characteristicId: characteristicId,
    value: toBase64(new Uint8Array(bytes).buffer as ArrayBuffer)
  });
}

/**
 * 模拟模式下处理非 scan 类命令：内存状态机应答，不触碰任何蓝牙接口。
 */
function handleSimulatedCommand(client: socket.TCPSocketConnection, command: BridgeCommand,
  context: SimContext): void {
  const devices = simDevices();
  if (command.op === 'connect') {
    const device = devices.find((item: SimDevice) => item.id === command.deviceId);
    if (!device) {
      send(client, {event: 'error', id: command.id, error: 'simulated peripheral not found'});
      return;
    }
    context.connected = device.id;
    send(client, {event: 'connect', id: command.id, ok: true});
    return;
  }
  if (command.op === 'disconnect') {
    context.connected = null;
    context.subscriptions.clear();
    send(client, {event: 'disconnect', id: command.id, deviceId: command.deviceId});
    return;
  }
  const device = devices.find((item: SimDevice) => item.id === context.connected) ?? null;
  if (!device) {
    send(client, {event: 'error', id: command.id, error: 'not connected'});
    return;
  }
  if (command.op === 'getServices') {
    send(client, {event: 'services', id: command.id, ok: true, serviceList: simServices(device)});
    return;
  }
  const characteristic = simFind(device, command.serviceId ?? '', command.characteristicId ?? '');
  if (!characteristic) {
    send(client, {event: 'error', id: command.id, error: 'characteristic not found'});
    return;
  }
  if (command.op === 'read') {
    send(client, {event: 'read', id: command.id, ok: true, value: toBase64(characteristic.value)});
    return;
  }
  if (command.op === 'write') {
    const value = new Uint8Array(fromBase64(command.message ?? ''));
    send(client, {event: 'write', id: command.id, ok: true, length: value.byteLength});
    return;
  }
  if (command.op === 'subscribe') {
    context.subscriptions.set(characteristic.uuid, characteristic);
    send(client, {event: 'subscribed', id: command.id, ok: true});
    // 订阅关键特征后立即回一条通知，让上层立刻拿到初始状态（模拟器专用行为）
    if (characteristic.uuid === MICROBIT_TX) {
      simNotification(client, MICROBIT_SERVICE, MICROBIT_TX, [0x01, 0x00]);
    } else if (characteristic.uuid === WEDO_ATTACHED) {
      simNotification(client, WEDO_DEVICE_SERVICE, WEDO_ATTACHED, [1, 1]);
    }
    return;
  }
  if (command.op === 'unsubscribe') {
    context.subscriptions.delete(characteristic.uuid);
    send(client, {event: 'unsubscribed', id: command.id, ok: true});
    return;
  }
  send(client, {event: 'error', id: command.id, error: `unsupported simulated op: ${command.op}`});
}

/**
 * 处理单个客户端连接：按行拆包分发命令，扫描窗口到点自动收尾。
 */
async function handleConnection(client: socket.TCPSocketConnection, simulate: boolean,
  simContext: SimContext, context: common.UIAbilityContext): Promise<void> {
  const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
  let pending: string = '';
  // 本连接的扫描状态：scanTimer >= 0 表示窗口定时器在跑
  let scanTimer: number = -1;
  let scanning: boolean = false;

  /**
   * 结束扫描：清定时器、反注册回调、关系统扫描，并下发 scanEnd。
   */
  const stopScan = (): void => {
    if (scanTimer !== -1) {
      clearTimeout(scanTimer);
      scanTimer = -1;
    }
    if (!scanning) return;
    scanning = false;
    if (!simulate) {
      try {
        if (scanCallback) {
          ble.off('BLEDeviceFind', scanCallback);
          scanCallback = null;
        }
        ble.stopBLEScan();
      } catch (error) {
        log(`stop scan failed: ${error.message}`);
      }
    }
    send(client, {event: 'scanEnd'});
  };

  // 首次真实扫描前申请蓝牙权限；授权前不触碰任何蓝牙接口
  const startScan = async (): Promise<void> => {
    try {
      const permitted: boolean = await ensureBlePermission(context);
      if (!permitted) {
        scanning = false;
        send(client, {event: 'error', error: 'bluetooth permission denied'});
        return;
      }
      if (access.getState() !== access.BluetoothState.STATE_ON) {
        scanning = false;
        send(client, {event: 'error', error: 'Bluetooth is off'});
        return;
      }
      scanCallback = (results: Array<ble.ScanResult>): void => {
        for (const result of results) {
          send(client, {
            event: 'scan',
            deviceId: result.deviceId,
            name: result.deviceName ?? '',
            rssi: result.rssi,
            services: result.serviceUuids ?? []
          });
        }
      };
      ble.on('BLEDeviceFind', scanCallback);
      const filter: ble.ScanFilter = {};
      ble.startBLEScan([filter], {
        interval: SCAN_REPORT_INTERVAL_MS,
        dutyMode: ble.ScanDuty.SCAN_MODE_LOW_POWER,
        matchMode: ble.MatchMode.MATCH_MODE_AGGRESSIVE
      });
      scanTimer = setTimeout(stopScan, SCAN_MS);
    } catch (error) {
      scanning = false;
      send(client, {event: 'error', error: `scan failed: ${error.message}`});
    }
  };

  client.on('message', (info: socket.SocketMessageInfo) => {
    pending += decoder.decode(new Uint8Array(info.message));
    let newline: number = pending.indexOf('\n');
    while (newline >= 0) {
      const line: string = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
      if (line.length === 0) continue;
      let command: BridgeCommand;
      try {
        command = JSON.parse(line) as BridgeCommand;
      } catch (error) {
        send(client, {event: 'error', error: 'invalid json'});
        continue;
      }
      // JSON 边界校验（§6）：op 是路由判别字段，必须先验证；其余字段在使用处用 ?? 收窄
      if (typeof command.op !== 'string' || command.op.length === 0) {
        send(client, {event: 'error', error: 'op must be a non-empty string'});
        continue;
      }
      if (simulate) {
        if (command.op === 'scan') {
          if (scanning) continue;
          scanning = true;
          for (const device of simDevices()) {
            send(client, {
              event: 'scan',
              deviceId: device.id,
              name: device.name,
              rssi: device.rssi,
              services: device.services.map((item: SimService) => item.uuid)
            });
          }
          scanTimer = setTimeout((): void => {
            scanning = false;
            scanTimer = -1;
            send(client, {event: 'scanEnd'});
          }, 500);
          continue;
        }
        if (command.op === 'stopScan') {
          stopScan();
          continue;
        }
        handleSimulatedCommand(client, command, simContext);
        continue;
      }
      if (command.op === 'scan') {
        if (scanning) continue;
        scanning = true;
        // startScan 内部已兜底发送 error 事件；再挂 catch 防 floating promise（§5）
        startScan().catch((error: Error) => {
          log(`scan dispatch failed: ${error.message}`);
        });
        continue;
      }
      if (command.op === 'stopScan') {
        stopScan();
        continue;
      }
      // handleCommand 内部已兜底；同上挂 catch 防 floating promise
      handleCommand(client, command, context).catch((error: Error) => {
        log(`command failed: ${error.message}`);
      });
    }
  });

  client.on('close', () => {
    bridgeClients.delete(client);
    stopScan();
  });
}

/**
 * 启动 BLE 桥；simulate 为真时用内置模拟外设，不触碰蓝牙。
 * @param port 监听端口，默认取 common/Ports 的 BLE_BRIDGE_PORT
 * @param simulate 是否使用模拟外设（模拟器/无蓝牙调试）
 * @param context UIAbility 上下文，用于按需申请蓝牙权限
 * @returns 监听就绪后 resolve
 */
export async function startTessloBleBridge(port: number = BLE_BRIDGE_PORT, simulate: boolean = false,
  context: common.UIAbilityContext): Promise<void> {
  const server = socket.constructTCPSocketServerInstance();
  const simContext: SimContext = {connected: null, subscriptions: new Map()};
  await server.listen({address: '127.0.0.1', port: port, family: 1});
  bridgeServer = server;
  log(`BLE bridge listening on 127.0.0.1:${port} (simulate=${simulate})`);
  server.on('connect', (client: socket.TCPSocketConnection) => {
    bridgeClients.add(client);
    handleConnection(client, simulate, simContext, context).catch((error: Error) => {
      log(`connection failed: ${error.message}`);
    });
  });
}

/**
 * 停止 BLE 桥：关闭全部客户端连接并停止监听；可重复调用。
 * @returns 全部资源关闭后 resolve
 */
export async function stopTessloBleBridge(): Promise<void> {
  for (const client of bridgeClients) {
    try {
      await client.close();
    } catch (error) {
      log(`bridge client close failed: ${error.message}`);
    }
  }
  bridgeClients.clear();
  const server: socket.TCPSocketServer | null = bridgeServer;
  bridgeServer = null;
  if (server !== null) {
    try {
      await server.close();
    } catch (error) {
      log(`bridge server close failed: ${error.message}`);
    }
  }
}
