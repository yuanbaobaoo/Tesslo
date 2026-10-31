import test from 'node:test';
import assert from 'node:assert/strict';

import {OhosBleAdapter} from '../src/ohos-ble.js';

// micro:bit UUID，与 src/ohos-ble.js 的桥协议测试共用
const MICROBIT = '0000f005-0000-1000-8000-00805f9b34fb';
const WRITE = '0000f002-0000-1000-8000-00805f9b34fb';
const NOTIFY = '0000f004-0000-1000-8000-00805f9b34fb';

/**
 * 桥 mock：记录每次调用，并按 handlers 表把回调参数回放给被测代码。
 */
const makeBridge = handlers => ({
  calls: [],
  async callArkTSFunction (name, returnType, args = []) {
    this.calls.push({name, returnType, args});
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected bridge call: ${name}`);
    const value = handler(args, this);
    return {type: returnType, value: value ?? 0};
  }
});

/**
 * 权限回调直接回授权码 0（已授权）。
 */
const permissionGranted = args => {
  args[1](0);
};

test('discover filters scan events by advertised service', async () => {
  const bridge = makeBridge({
    'PermissionManagerAdapter.RequestPermissionCode': permissionGranted,
    'TessloBle.StartScan': args => {
      const onScan = args[0];
      onScan(JSON.stringify({kind: 'scan', deviceId: 'AA:BB', name: 'micro:bit', rssi: -40, services: [MICROBIT]}));
      onScan(JSON.stringify({kind: 'scan', deviceId: 'CC:DD', name: 'other', rssi: -70, services: ['0000180f-0000-1000-8000-00805f9b34fb']}));
    },
    'TessloBle.StopScan': () => {}
  });
  const adapter = new OhosBleAdapter({bridge, scanMs: 10});
  const devices = await adapter.discover({filters: [{services: [MICROBIT]}]});
  assert.deepEqual(devices.map(device => device.peripheralId), ['AA:BB']);
  assert.equal(devices[0].name, 'micro:bit');
  adapter.dispose();
});

test('connect, services, read, write and notifications', async () => {
  let notifyCallback;
  const bridge = makeBridge({
    'TessloBle.Connect': args => {
      args[1](JSON.stringify({kind: 'state', state: 2}));
    },
    'TessloBle.Disconnect': () => {},
    'TessloBle.StopScan': () => {},
    'TessloBle.GetServices': args => {
      args[1](JSON.stringify({
        ok: true,
        services: [{
          uuid: '0000F005-0000-1000-8000-00805F9B34FB',
          characteristics: [
            {uuid: '0000F002-0000-1000-8000-00805F9B34FB', properties: 8},
            {uuid: '0000F004-0000-1000-8000-00805F9B34FB', properties: 4}
          ]
        }]
      }));
    },
    'TessloBle.Read': args => {
      args[3](JSON.stringify({ok: true, value: Buffer.from('pong').toString('base64')}));
    },
    'TessloBle.Write': args => {
      assert.equal(Buffer.from(args[3], 'base64').toString(), 'ping');
      args[4](JSON.stringify({ok: true, length: 4}));
    },
    'TessloBle.Subscribe': args => {
      notifyCallback = args[3];
    },
    'TessloBle.Unsubscribe': args => {
      args[3](JSON.stringify({ok: true}));
    }
  });
  const adapter = new OhosBleAdapter({bridge, scanMs: 10});

  await adapter.connect('AA:BB');
  assert.deepEqual(await adapter.getServices(), [MICROBIT]);
  assert.deepEqual(await adapter.read(MICROBIT, WRITE), {
    message: Buffer.from('pong').toString('base64'),
    encoding: 'base64'
  });
  assert.equal(await adapter.write(MICROBIT, WRITE, 'ping', 'utf8'), 4);

  await adapter.startNotifications(MICROBIT, NOTIFY);
  const event = new Promise(resolve => adapter.once('notification', (method, params) => resolve({method, params})));
  notifyCallback(JSON.stringify({
    kind: 'notification',
    serviceId: MICROBIT,
    characteristicId: NOTIFY,
    value: Buffer.from('tick').toString('base64')
  }));
  const {method, params} = await event;
  assert.equal(method, 'characteristicDidChange');
  assert.equal(params.characteristicId, NOTIFY);
  assert.equal(Buffer.from(params.message, 'base64').toString(), 'tick');

  await adapter.stopNotifications(MICROBIT, NOTIFY);
  adapter.dispose();
});

test('discover rejects when permission is denied', async () => {
  const bridge = makeBridge({
    'PermissionManagerAdapter.RequestPermissionCode': args => {
      args[1](1);
    }
  });
  const adapter = new OhosBleAdapter({bridge, scanMs: 10});
  await assert.rejects(
    adapter.discover({filters: [{services: [MICROBIT]}]}),
    /permission denied/
  );
  adapter.dispose();
});

test('discover surfaces a Bluetooth-off error from the scan', async () => {
  const bridge = makeBridge({
    'PermissionManagerAdapter.RequestPermissionCode': permissionGranted,
    'TessloBle.StartScan': args => {
      args[0](JSON.stringify({kind: 'error', message: 'Bluetooth is off'}));
    },
    'TessloBle.StopScan': () => {}
  });
  const adapter = new OhosBleAdapter({bridge, scanMs: 10});
  await assert.rejects(
    adapter.discover({filters: [{services: [MICROBIT]}]}),
    /Bluetooth is off/
  );
  adapter.dispose();
});
