import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAuthStatus,
  parseEmulatorArgs,
  parseEmulatorImages,
  parseEmulatorList,
  selectStartableEmulator,
  suggestEmulatorName
} from '../scripts/ohos-common.ts';

test('parseAuthStatus tells logged-in and logged-out apart by output text', () => {
  // 两种状态退出码都是 0，只能靠输出区分
  assert.deepEqual(parseAuthStatus('Not logged in\n'), {loggedIn: false, userName: null});
  assert.deepEqual(parseAuthStatus('Current user: 天府盐****\n'), {
    loggedIn: true,
    userName: '天府盐****'
  });
  // 异常输出按未登录处理，由调用方复查后报错
  assert.deepEqual(parseAuthStatus(''), {loggedIn: false, userName: null});
  assert.deepEqual(parseAuthStatus('something unexpected'), {loggedIn: false, userName: null});
});

test('parseEmulatorList maps instances and keeps null for unusable output', () => {
  const output = JSON.stringify([
    {name: 'MateBook Pro', status: 'running', serial: '127.0.0.1:5555', deviceType: '2in1', osVersion: 'HarmonyOS 6.0.1(21)'},
    {name: 'Dev Tablet', status: 'stopped', serial: null, deviceType: 'tablet', osVersion: null}
  ]);
  assert.deepEqual(parseEmulatorList(output), [
    {
      name: 'MateBook Pro',
      status: 'running',
      serial: '127.0.0.1:5555',
      deviceType: '2in1',
      osVersion: 'HarmonyOS 6.0.1(21)'
    },
    {name: 'Dev Tablet', status: 'stopped', serial: null, deviceType: 'tablet', osVersion: null}
  ]);
  // 无实例是空数组，与能力不可用（null）区分
  assert.deepEqual(parseEmulatorList('[]\n'), []);
  assert.equal(parseEmulatorList('Error: DevEco Studio installation not found.'), null);
  assert.equal(parseEmulatorList('{"not":"an array"}'), null);
  assert.equal(parseEmulatorList(''), null);
  // 条目缺 name 或 status 视为形态异常，整体拒绝
  assert.equal(parseEmulatorList(JSON.stringify([{status: 'stopped'}])), null);
});

test('parseEmulatorList tolerates pnpm noise around the JSON array', () => {
  const payload = JSON.stringify([{name: 'Dev Tablet', status: 'stopped', serial: null, deviceType: 'tablet', osVersion: null}]);
  const instances = parseEmulatorList(`some preamble\n${payload}\ntrailing text`);
  assert.equal(instances?.length, 1);
  assert.equal(instances[0].name, 'Dev Tablet');
});

test('parseEmulatorImages normalizes field-name variants and downloaded flags', () => {
  const output = JSON.stringify([
    {osVersion: 'HarmonyOS 6.0.1(21)', deviceType: '2in1', downloaded: true},
    {OsVersion: 'HarmonyOS 5.1.1(19)', DeviceType: '2in1', Downloaded: 'false'},
    {os_version: 'HarmonyOS 7.0.0(26)', device_type: 'tablet', isDownloaded: 'true'},
    {osVersion: 'HarmonyOS 4.0(1)', deviceType: '2in1'}
  ]);
  assert.deepEqual(parseEmulatorImages(output), [
    {deviceType: '2in1', osVersion: 'HarmonyOS 6.0.1(21)', downloaded: true},
    {deviceType: '2in1', osVersion: 'HarmonyOS 5.1.1(19)', downloaded: false},
    {deviceType: 'tablet', osVersion: 'HarmonyOS 7.0.0(26)', downloaded: true},
    // downloaded 缺失按未下载处理
    {deviceType: '2in1', osVersion: 'HarmonyOS 4.0(1)', downloaded: false}
  ]);
  assert.deepEqual(parseEmulatorImages('[]'), []);
  assert.equal(parseEmulatorImages('No matching system images found.'), null);
});

test('parseEmulatorImages skips records without osVersion or deviceType', () => {
  const output = JSON.stringify([
    {osVersion: '', deviceType: '2in1', downloaded: true},
    {osVersion: 'HarmonyOS 6.0.1(21)', downloaded: true},
    {deviceType: 'tablet', downloaded: false}
  ]);
  assert.deepEqual(parseEmulatorImages(output), []);
});

test('selectStartableEmulator picks the first stopped instance of a supported type', () => {
  const instances = [
    {name: 'a', status: 'running', serial: 's', deviceType: '2in1', osVersion: null},
    {name: 'b', status: 'stopped', serial: null, deviceType: 'phone', osVersion: null},
    {name: 'c', status: 'stopped', serial: null, deviceType: 'tablet', osVersion: null},
    {name: 'd', status: 'stopped', serial: null, deviceType: '2in1', osVersion: null}
  ];
  // 运行中的、类型不支持的都跳过，取第一个可启动的
  assert.equal(selectStartableEmulator(instances, ['2in1', 'tablet']).name, 'c');
  assert.equal(selectStartableEmulator(instances, ['tv']), null);
  assert.equal(selectStartableEmulator([], ['2in1']), null);
});

test('suggestEmulatorName slugs the version and numbers duplicates', () => {
  const suggested = suggestEmulatorName('2in1', 'HarmonyOS 6.0.1(21)', []);
  assert.equal(suggested, 'tesslo-2in1-harmonyos-6-0-1-21');
  // 与现有实例重名时追加序号
  assert.equal(suggestEmulatorName('2in1', 'HarmonyOS 6.0.1(21)', [suggested]), `${suggested}-2`);
  assert.equal(
    suggestEmulatorName('2in1', 'HarmonyOS 6.0.1(21)', [suggested, `${suggested}-2`]),
    `${suggested}-3`
  );
  assert.equal(suggestEmulatorName('tablet', 'HarmonyOS 7.0.0(26)', []), 'tesslo-tablet-harmonyos-7-0-0-26');
});

test('parseEmulatorArgs reads the four flags and validates their combination', () => {
  assert.deepEqual(parseEmulatorArgs([]), {
    emulator: undefined,
    deviceType: undefined,
    osVersion: undefined,
    disabled: false
  });
  assert.deepEqual(
    parseEmulatorArgs(['--emulator', 'tesslo-2in1', '--ble-sim']),
    {emulator: 'tesslo-2in1', deviceType: undefined, osVersion: undefined, disabled: false}
  );
  assert.deepEqual(
    parseEmulatorArgs(['--emulator-device-type', 'tablet', '--emulator-os-version', 'HarmonyOS 6.0.1(21)']),
    {emulator: undefined, deviceType: 'tablet', osVersion: 'HarmonyOS 6.0.1(21)', disabled: false}
  );
  assert.equal(parseEmulatorArgs(['--no-emulator']).disabled, true);
});

test('parseEmulatorArgs rejects conflicting or half-specified flags', () => {
  assert.throws(() => parseEmulatorArgs(['--no-emulator', '--emulator', 'x']), /--no-emulator 不能与/);
  assert.throws(
    () => parseEmulatorArgs(['--no-emulator', '--emulator-os-version', 'v']),
    /--no-emulator 不能与/
  );
  assert.throws(
    () => parseEmulatorArgs(['--emulator-device-type', 'tablet']),
    /--emulator-device-type 与 --emulator-os-version 必须成对使用/
  );
  assert.throws(
    () => parseEmulatorArgs(['--emulator-os-version', 'HarmonyOS 6.0.1(21)']),
    /必须成对使用/
  );
  // 取值参数缺失或把下一个 flag 当取值都要拒绝
  assert.throws(() => parseEmulatorArgs(['--emulator']), /需要一个取值参数/);
  assert.throws(() => parseEmulatorArgs(['--emulator', '--ble-sim']), /需要一个取值参数/);
});
