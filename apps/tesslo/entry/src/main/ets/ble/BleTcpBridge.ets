import socket from '@ohos.net.socket';
import util from '@ohos.util';
import ble from '@ohos.bluetooth.ble';
import access from '@ohos.bluetooth.access';
import constant from '@ohos.bluetooth.constant';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { abilityAccessCtrl, Permissions, common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

const TAG: string = 'TessloBleBridge';
const DOMAIN: number = 0x0000;
const SCAN_MS: number = 4000;
const BLUETOOTH_PERMISSIONS: Array<Permissions> = ['ohos.permission.ACCESS_BLUETOOTH'];

const MICROBIT_SERVICE: string = '0000f005-0000-1000-8000-00805f9b34fb';
const MICROBIT_RX: string = '5261da01-fa7e-42ab-850b-7c80220097cc';
const MICROBIT_TX: string = '5261da02-fa7e-42ab-850b-7c80220097cc';
const WEDO_DEVICE_SERVICE: string = '00001523-1212-efde-1523-785feabcd123';
const WEDO_IO_SERVICE: string = '00004f0e-1212-efde-1523-785feabcd123';
const WEDO_ATTACHED: string = '00001527-1212-efde-1523-785feabcd123';
const WEDO_BATTERY: string = '00001528-1212-efde-1523-785feabcd123';
const WEDO_INPUT_COMMAND: string = '00001563-1212-efde-1523-785feabcd123';
const WEDO_OUTPUT_COMMAND: string = '00001565-1212-efde-1523-785feabcd123';

interface BridgeCommand {
  op: string;
  id?: number;
  deviceId?: string;
  serviceId?: string;
  characteristicId?: string;
  message?: string;
  withResponse?: boolean;
}

interface BridgeCharacteristic {
  uuid: string;
  properties: number;
}

interface BridgeService {
  uuid: string;
  characteristics: Array<BridgeCharacteristic>;
}

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

interface GattSession {
  device: ble.GattClientDevice;
  characteristics: Map<string, ble.BLECharacteristic>;
  notifications: Set<string>;
}

interface SimCharacteristic {
  uuid: string;
  properties: number;
  value: ArrayBuffer;
}

interface SimService {
  uuid: string;
  characteristics: Array<SimCharacteristic>;
}

interface SimDevice {
  id: string;
  name: string;
  rssi: number;
  services: Array<SimService>;
}

interface SimContext {
  connected: string | null;
  subscriptions: Map<string, SimCharacteristic>;
}

const sessions: Map<string, GattSession> = new Map();
let scanCallback: ((results: Array<ble.ScanResult>) => void) | null = null;
let blePermissionGranted: boolean = false;

function log(level: string, message: string): void {
  if (level === 'error') {
    hilog.error(DOMAIN, TAG, '%{public}s', message);
  } else if (level === 'warn') {
    hilog.warn(DOMAIN, TAG, '%{public}s', message);
  } else {
    hilog.info(DOMAIN, TAG, '%{public}s', message);
  }
}

// 仅在真正需要蓝牙（scan/connect）时才向用户申请权限；授权后缓存，避免重复弹窗
async function ensureBlePermission(context: common.UIAbilityContext): Promise<boolean> {
  if (blePermissionGranted) return true;
  try {
    const result = await abilityAccessCtrl.createAtManager()
      .requestPermissionsFromUser(context, BLUETOOTH_PERMISSIONS);
    const granted = result.authResults.every(status => status === 0);
    if (granted) {
      blePermissionGranted = true;
    } else {
      log('warn', 'bluetooth permission denied by user');
    }
    return granted;
  } catch (error) {
    log('warn', `bluetooth permission request failed: ${(error as BusinessError).message ?? error}`);
    return false;
  }
}

function toBase64(value: ArrayBuffer): string {
  return new util.Base64Helper().encodeToStringSync(new Uint8Array(value));
}

function fromBase64(value: string): ArrayBuffer {
  const bytes: Uint8Array = new util.Base64Helper().decodeSync(value);
  return bytes.buffer as ArrayBuffer;
}

function send(client: socket.TCPSocketConnection, payload: BridgeEvent): void {
  client.send({data: JSON.stringify(payload) + '\n'}).catch((error: Error) => {
    log('warn', `send failed: ${error.message}`);
  });
}

function key(serviceId: string, characteristicId: string): string {
  return `${serviceId.toLowerCase()}/${characteristicId.toLowerCase()}`;
}

function propertiesOf(characteristic: ble.BLECharacteristic): number {
  let properties: number = 0;
  if (characteristic.properties?.write) properties |= 1 << 3;
  if (characteristic.properties?.read) properties |= 1 << 1;
  if (characteristic.properties?.notify) properties |= 1 << 4;
  if (characteristic.properties?.writeNoResponse) properties |= 1 << 2;
  if (characteristic.properties?.indicate) properties |= 1 << 5;
  return properties;
}

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
        notifications: new Set()
      };
      device.on('BLEConnectionStateChange', (state: ble.BLEConnectionChangeState) => {
        if (state.state === constant.ProfileConnectionState.STATE_CONNECTED) {
          sessions.set(deviceId, session);
          send(client, {event: 'connect', id: command.id, ok: true});
        } else if (state.state === constant.ProfileConnectionState.STATE_DISCONNECTED) {
          sessions.delete(deviceId);
          session.notifications.clear();
          send(client, {event: 'disconnect', id: command.id, deviceId: deviceId});
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

function simDevices(): Array<SimDevice> {
  return [
    {
      id: 'sim-microbit-1',
      name: 'BBC micro:bit [tesslo]',
      rssi: -45,
      services: [{
        uuid: MICROBIT_SERVICE,
        characteristics: [
          {uuid: MICROBIT_RX, properties: 8, value: new ArrayBuffer(0)},
          {uuid: MICROBIT_TX, properties: 16, value: new ArrayBuffer(0)}
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
            {uuid: WEDO_ATTACHED, properties: 16, value: new ArrayBuffer(0)},
            {uuid: WEDO_BATTERY, properties: 2, value: new Uint8Array([100]).buffer as ArrayBuffer}
          ]
        },
        {
          uuid: WEDO_IO_SERVICE,
          characteristics: [
            {uuid: WEDO_INPUT_COMMAND, properties: 8, value: new ArrayBuffer(0)},
            {uuid: WEDO_OUTPUT_COMMAND, properties: 8, value: new ArrayBuffer(0)}
          ]
        }
      ]
    }
  ];
}

function simServices(device: SimDevice): Array<BridgeService> {
  return device.services.map((service: SimService): BridgeService => ({
    uuid: service.uuid,
    characteristics: service.characteristics.map((item: SimCharacteristic): BridgeCharacteristic => ({
      uuid: item.uuid,
      properties: item.properties
    }))
  }));
}

function simFind(device: SimDevice, serviceId: string, characteristicId: string): SimCharacteristic | null {
  const service = device.services.find((item: SimService) =>
    item.uuid.toLowerCase() === serviceId.toLowerCase());
  if (!service) return null;
  return service.characteristics.find((item: SimCharacteristic) =>
    item.uuid.toLowerCase() === characteristicId.toLowerCase()) ?? null;
}

function simNotification(client: socket.TCPSocketConnection, serviceId: string,
  characteristicId: string, bytes: number[]): void {
  send(client, {
    event: 'notification',
    serviceId: serviceId,
    characteristicId: characteristicId,
    value: toBase64(new Uint8Array(bytes).buffer as ArrayBuffer)
  });
}

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

async function handleConnection(client: socket.TCPSocketConnection, simulate: boolean,
  simContext: SimContext, context: common.UIAbilityContext): Promise<void> {
  const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
  let pending: string = '';
  let scanTimer: number = -1;
  let scanning: boolean = false;

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
        log('warn', `stop scan failed: ${error.message}`);
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
        interval: 500,
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
        startScan();
        continue;
      }
      if (command.op === 'stopScan') {
        stopScan();
        continue;
      }
      handleCommand(client, command, context);
    }
  });

  client.on('close', () => {
    stopScan();
  });
}

export async function startTessloBleBridge(port: number = 20113, simulate: boolean = false,
  context: common.UIAbilityContext): Promise<void> {
  const server = socket.constructTCPSocketServerInstance();
  const simContext: SimContext = {connected: null, subscriptions: new Map()};
  await server.listen({address: '127.0.0.1', port: port, family: 1});
  log('info', `listening on 127.0.0.1:${port} (simulate=${simulate})`);
  server.on('connect', (client: socket.TCPSocketConnection) => {
    handleConnection(client, simulate, simContext, context).catch((error: Error) => {
      log('error', `connection failed: ${error.message}`);
    });
  });
}
