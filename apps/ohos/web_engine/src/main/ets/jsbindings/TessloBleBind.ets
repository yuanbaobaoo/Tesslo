import util from '@ohos.util';
import ble from '@ohos.bluetooth.ble';
import access from '@ohos.bluetooth.access';

import JsBindingUtils from '../utils/JsBindingUtils';
import Inject from '../common/InjectModule';
import lazy { BluetoothLowEnergyAdapter } from '../adapter/BluetoothLowEnergyAdapter';
import type { CharacteristicInfo, ServiceInfo } from '../adapter/BluetoothLowEnergyAdapter';
import LogUtil from '../utils/LogUtil';

const TAG = 'TessloBle';

interface CharacteristicOut {
  uuid: string;
  properties: number;
}

interface ServiceOut {
  uuid: string;
  characteristics: Array<CharacteristicOut>;
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

function characteristicId(deviceId: string, serviceUuid: string, characteristicUuid: string): string {
  return `${deviceId}_${serviceUuid}_${characteristicUuid}`;
}

function startScan(onEvent: (event: string) => void): void {
  try {
    if (access.getState() !== access.BluetoothState.STATE_ON) {
      onEvent(JSON.stringify({kind: 'error', message: 'Bluetooth is off'}));
      return;
    }
  } catch (error) {
    onEvent(JSON.stringify({kind: 'error', message: `Bluetooth unavailable: ${error.message}`}));
    return;
  }
  const adapter = implBle();
  adapter.startBluetoothDiscovery();
  adapter.startDiscoveryMonitor((_data: ArrayBuffer, scan: ble.ScanResult) => {
    onEvent(JSON.stringify({
      kind: 'scan',
      deviceId: scan.deviceId,
      name: scan.deviceName ?? '',
      rssi: scan.rssi,
      services: scan.serviceUuids ?? []
    }));
  });
}

function stopScan(): void {
  const adapter = implBle();
  adapter.stopDiscoveryMonitor();
  adapter.stopBluetoothDiscovery();
}

function connect(deviceId: string, onEvent: (event: string) => void): void {
  implBle().createGattClientDevice(deviceId, (state: number) => {
    onEvent(JSON.stringify({kind: 'state', state}));
  });
}

function disconnect(deviceId: string): void {
  implBle().disconnectGatt(deviceId);
}

function getServices(deviceId: string, onResult: (result: string) => void): void {
  const adapter = implBle();
  adapter.startGattDiscovery(deviceId, (services: Array<ServiceInfo>) => {
    const out: Array<ServiceOut> = [];
    let pending = services.length;
    if (pending === 0) {
      onResult(JSON.stringify({ok: true, services: []}));
      return;
    }
    services.forEach((service: ServiceInfo) => {
      adapter.createCharacteristic(service.identifier, deviceId, (chars: Array<CharacteristicInfo>) => {
        const characteristics: Array<CharacteristicOut> = chars.map((char: CharacteristicInfo): CharacteristicOut => ({
          uuid: char.characteristic_uuid,
          properties: char.properties
        }));
        out.push({uuid: service.service_uuid, characteristics} as ServiceOut);
        pending -= 1;
        if (pending === 0) {
          onResult(JSON.stringify({ok: true, services: out}));
        }
      });
    });
  });
}

function readCharacteristic(deviceId: string, serviceUuid: string, characteristicUuid: string,
  onResult: (result: string) => void): void {
  const id = characteristicId(deviceId, serviceUuid, characteristicUuid);
  implBle().readCharacteristic(id, deviceId, (code: Number, value: ArrayBuffer) => {
    if (code.valueOf() === -1) {
      onResult(JSON.stringify({ok: true, value: toBase64(value)}));
    } else {
      onResult(JSON.stringify({ok: false, error: `read failed: ${code}`}));
    }
  });
}

function writeCharacteristic(deviceId: string, serviceUuid: string, characteristicUuid: string,
  valueBase64: string, onResult: (result: string) => void): void {
  const id = characteristicId(deviceId, serviceUuid, characteristicUuid);
  const value = fromBase64(valueBase64);
  implBle().writeCharacteristic(id, deviceId, 1, value, (code: number) => {
    if (code === -1) {
      onResult(JSON.stringify({ok: true, length: new Uint8Array(value).length}));
    } else {
      onResult(JSON.stringify({ok: false, error: `write failed: ${code}`}));
    }
  });
}

function subscribe(deviceId: string, serviceUuid: string, characteristicUuid: string,
  onEvent: (event: string) => void): void {
  const id = characteristicId(deviceId, serviceUuid, characteristicUuid);
  implBle().subscribeToNotifications(id, deviceId, (value: ArrayBuffer, code: number) => {
    if (code !== -1) {
      LogUtil.error(TAG, `notification error: ${code}`);
      return;
    }
    onEvent(JSON.stringify({
      kind: 'notification',
      serviceId: serviceUuid,
      characteristicId: characteristicUuid,
      value: toBase64(value)
    }));
  });
}

function unsubscribe(deviceId: string, serviceUuid: string, characteristicUuid: string,
  onResult: (result: string) => void): void {
  const id = characteristicId(deviceId, serviceUuid, characteristicUuid);
  implBle().unsubscribeFromNotifications(id, deviceId, (code: number) => {
    onResult(JSON.stringify({ok: code === -1, error: code === -1 ? undefined : `unsubscribe failed: ${code}`}));
  });
}

export class TessloBleBind {
  static bind(): void {
    JsBindingUtils.bindFunction('TessloBle.StartScan', startScan);
    JsBindingUtils.bindFunction('TessloBle.StopScan', stopScan);
    JsBindingUtils.bindFunction('TessloBle.Connect', connect);
    JsBindingUtils.bindFunction('TessloBle.Disconnect', disconnect);
    JsBindingUtils.bindFunction('TessloBle.GetServices', getServices);
    JsBindingUtils.bindFunction('TessloBle.Read', readCharacteristic);
    JsBindingUtils.bindFunction('TessloBle.Write', writeCharacteristic);
    JsBindingUtils.bindFunction('TessloBle.Subscribe', subscribe);
    JsBindingUtils.bindFunction('TessloBle.Unsubscribe', unsubscribe);
  }
}
