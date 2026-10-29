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

export async function startTessloBleBridge(port: number = 20113): Promise<void> {
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
