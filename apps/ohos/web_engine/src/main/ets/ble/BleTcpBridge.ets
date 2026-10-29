import socket from '@ohos.net.socket';
import util from '@ohos.util';
import ble from '@ohos.bluetooth.ble';
import access from '@ohos.bluetooth.access';

import Inject from '../common/InjectModule';
import { BluetoothLowEnergyAdapter } from '../adapter/BluetoothLowEnergyAdapter';
import type { CharacteristicInfo, ServiceInfo } from '../adapter/BluetoothLowEnergyAdapter';
import { PermissionManagerAdapter } from '../adapter/PermissionManagerAdapter';
import LogUtil from '../utils/LogUtil';

const TAG: string = 'TessloBleBridge';
const SCAN_MS: number = 4000;
const CONNECTED: number = 2;
const DISCONNECTED: number = 0;

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

function implBle(): BluetoothLowEnergyAdapter {
  return Inject.getOrCreate(BluetoothLowEnergyAdapter);
}

function toBase64(value: ArrayBuffer): string {
  return new util.Base64Helper().encodeToStringSync(new Uint8Array(value));
}

function fromBase64(value: string): ArrayBuffer {
  const bytes: Uint8Array = new util.Base64Helper().decodeSync(value);
  return bytes.buffer as ArrayBuffer;
}

function characteristicId(deviceId: string, serviceId: string, characteristic: string): string {
  return `${deviceId}_${serviceId}_${characteristic}`;
}

function send(client: socket.TCPSocketConnection, payload: BridgeEvent): void {
  client.send({ data: JSON.stringify(payload) + '\n' }).catch((error: Error) => {
    LogUtil.warn(TAG, `send failed: ${error.message}`);
  });
}

function withPermission(callback: () => void): void {
  Inject.getOrCreate(PermissionManagerAdapter).requestPermissions('bluetooth', (granted: number) => {
    if (granted === 0) {
      callback();
    } else {
      LogUtil.error(TAG, `bluetooth permission denied: ${granted}`);
    }
  });
}

function handleCommand(client: socket.TCPSocketConnection, command: BridgeCommand): void {
  if (command.op === 'connect') {
    withPermission(() => {
      const deviceId = command.deviceId ?? '';
      if (deviceId.length === 0) {
        send(client, { event: 'error', id: command.id, error: 'connect requires deviceId' });
        return;
      }
      if (BluetoothLowEnergyAdapter.GATT_MAP.hasKey(deviceId)) {
        send(client, { event: 'connect', id: command.id, ok: true });
        return;
      }
      implBle().createGattClientDevice(deviceId, (state: number) => {
        if (state === CONNECTED) {
          send(client, { event: 'connect', id: command.id, ok: true });
        } else if (state === DISCONNECTED) {
          send(client, { event: 'disconnect', id: command.id, deviceId: deviceId });
        }
      });
    });
    return;
  }

  if (command.op === 'disconnect') {
    implBle().disconnectGatt(command.deviceId ?? '');
    send(client, { event: 'disconnect', id: command.id, deviceId: command.deviceId });
    return;
  }

  if (command.op === 'getServices') {
    const deviceId = command.deviceId ?? '';
    implBle().startGattDiscovery(deviceId, (discovered: Array<ServiceInfo>) => {
      const output: Array<BridgeService> = [];
      if (discovered.length === 0) {
        send(client, { event: 'services', id: command.id, ok: true, serviceList: output });
        return;
      }
      let pending: number = discovered.length;
      discovered.forEach((service: ServiceInfo) => {
        implBle().createCharacteristic(service.identifier, deviceId, (chars: Array<CharacteristicInfo>) => {
          output.push({
            uuid: service.service_uuid,
            characteristics: chars.map((item: CharacteristicInfo): BridgeCharacteristic => ({
              uuid: item.characteristic_uuid,
              properties: item.properties
            }))
          });
          pending -= 1;
          if (pending === 0) {
            send(client, { event: 'services', id: command.id, ok: true, serviceList: output });
          }
        });
      });
    });
    return;
  }

  if (command.op === 'read') {
    const deviceId = command.deviceId ?? '';
    const serviceId = command.serviceId ?? '';
    const characteristic = command.characteristicId ?? '';
    implBle().readCharacteristic(characteristicId(deviceId, serviceId, characteristic), deviceId,
      (code: Number, value: ArrayBuffer) => {
        if (code.valueOf() === -1) {
          send(client, { event: 'read', id: command.id, ok: true, value: toBase64(value) });
        } else {
          send(client, { event: 'read', id: command.id, ok: false, error: `read failed: ${code}` });
        }
      });
    return;
  }

  if (command.op === 'write') {
    const deviceId = command.deviceId ?? '';
    const serviceId = command.serviceId ?? '';
    const characteristic = command.characteristicId ?? '';
    const value = fromBase64(command.message ?? '');
    implBle().writeCharacteristic(characteristicId(deviceId, serviceId, characteristic), deviceId,
      command.withResponse === true ? 1 : 2, value, (code: number) => {
        if (code === -1) {
          send(client, { event: 'write', id: command.id, ok: true, length: value.byteLength });
        } else {
          send(client, { event: 'write', id: command.id, ok: false, error: `write failed: ${code}` });
        }
      });
    return;
  }

  if (command.op === 'subscribe') {
    const deviceId = command.deviceId ?? '';
    const serviceId = command.serviceId ?? '';
    const characteristic = command.characteristicId ?? '';
    implBle().subscribeToNotifications(characteristicId(deviceId, serviceId, characteristic), deviceId,
      (value: ArrayBuffer, code: number) => {
        if (code !== -1) {
          LogUtil.warn(TAG, `notification error: ${code}`);
          return;
        }
        send(client, {
          event: 'notification',
          serviceId: serviceId,
          characteristicId: characteristic,
          value: toBase64(value)
        });
      });
    send(client, { event: 'subscribed', id: command.id, ok: true });
    return;
  }

  if (command.op === 'unsubscribe') {
    const deviceId = command.deviceId ?? '';
    const serviceId = command.serviceId ?? '';
    const characteristic = command.characteristicId ?? '';
    implBle().unsubscribeFromNotifications(characteristicId(deviceId, serviceId, characteristic), deviceId,
      (code: number) => {
        send(client, { event: 'unsubscribed', id: command.id, ok: code === -1 });
      });
    return;
  }

  send(client, { event: 'error', id: command.id, error: `unsupported op: ${command.op}` });
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

const MICROBIT_SERVICE: string = '0000f005-0000-1000-8000-00805f9b34fb';
const MICROBIT_RX: string = '5261da01-fa7e-42ab-850b-7c80220097cc';
const MICROBIT_TX: string = '5261da02-fa7e-42ab-850b-7c80220097cc';
const WEDO_DEVICE_SERVICE: string = '00001523-1212-efde-1523-785feabcd123';
const WEDO_IO_SERVICE: string = '00004f0e-1212-efde-1523-785feabcd123';
const WEDO_ATTACHED: string = '00001527-1212-efde-1523-785feabcd123';
const WEDO_BATTERY: string = '00001528-1212-efde-1523-785feabcd123';
const WEDO_INPUT: string = '00001560-1212-efde-1523-785feabcd123';
const WEDO_INPUT_COMMAND: string = '00001563-1212-efde-1523-785feabcd123';
const WEDO_OUTPUT_COMMAND: string = '00001565-1212-efde-1523-785feabcd123';

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
            {uuid: WEDO_INPUT, properties: 16, value: new ArrayBuffer(0)},
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

function simNotification(client: socket.TCPSocketConnection, serviceId: string, characteristicId: string,
  bytes: number[]): void {
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
    if (characteristic.uuid === MICROBIT_RX && value.length > 0 && value[0] === 0x81) {
      const text = String.fromCharCode(...Array.from(value.slice(1)));
      LogUtil.info(TAG, `sim micro:bit displayText="${text}"`);
    }
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

export async function startTessloBleBridge(port: number = 20113, simulate: boolean = false): Promise<void> {
  const simContext: SimContext = {connected: null, subscriptions: new Map()};
  const server = socket.constructTCPSocketServerInstance();
  await server.listen({ address: '127.0.0.1', port: port, family: 1 });
  LogUtil.info(TAG, `listening on 127.0.0.1:${port}`);
  server.on('connect', (client: socket.TCPSocketConnection) => {
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
      try {
        implBle().stopDiscoveryMonitor();
        implBle().stopBluetoothDiscovery();
      } catch (error) {
        LogUtil.warn(TAG, `stop scan failed: ${error.message}`);
      }
      send(client, { event: 'scanEnd' });
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
          send(client, { event: 'error', error: 'invalid json' });
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
            if (scanTimer !== -1) clearTimeout(scanTimer);
            scanning = false;
            send(client, {event: 'scanEnd'});
            continue;
          }
          handleSimulatedCommand(client, command, simContext);
          continue;
        }
        if (command.op === 'scan') {
          if (scanning) continue;
          withPermission(() => {
            try {
              if (access.getState() !== access.BluetoothState.STATE_ON) {
                send(client, { event: 'error', error: 'Bluetooth is off' });
                return;
              }
              scanning = true;
              const adapter = implBle();
              adapter.startBluetoothDiscovery();
              adapter.startDiscoveryMonitor((_data: ArrayBuffer, scan: ble.ScanResult) => {
                send(client, {
                  event: 'scan',
                  deviceId: scan.deviceId,
                  name: scan.deviceName ?? '',
                  rssi: scan.rssi,
                  services: scan.serviceUuids ?? []
                });
              });
              scanTimer = setTimeout(stopScan, SCAN_MS);
            } catch (error) {
              scanning = false;
              send(client, { event: 'error', error: `scan failed: ${error.message}` });
            }
          });
          continue;
        }
        if (command.op === 'stopScan') {
          stopScan();
          continue;
        }
        handleCommand(client, command);
      }
    });

    client.on('close', () => {
      stopScan();
    });
  });
}
