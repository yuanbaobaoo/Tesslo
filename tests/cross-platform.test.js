import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {firstExecutable, prepareSpawn, resolveDevecoEntry} from '../scripts/ohos-common.ts';

test('prepareSpawn passes through plain executables on every platform', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.deepEqual(prepareSpawn('/tools/hdc', ['list', 'targets'], platform), {
      command: '/tools/hdc',
      args: ['list', 'targets'],
      shell: false
    });
  }
  // win32 的普通 .exe 同样直启（只有批处理需要 shell）
  assert.equal(prepareSpawn('C:\\tools\\hdc.exe', ['-t', 'x'], 'win32').shell, false);
});

test('prepareSpawn routes windows batch files through a quoted shell command line', () => {
  // Node 对 CVE-2024-27980 的修复禁用了 .cmd/.bat 直启：必须合成单条命令行并开 shell
  const routed = prepareSpawn('pnpm.cmd', ['exec', 'devecocli', 'auth', 'login'], 'win32');
  assert.equal(routed.command, 'pnpm.cmd exec devecocli auth login');
  assert.deepEqual(routed.args, []);
  assert.equal(routed.shell, true);

  // 含空格/括号的命令与参数要按 cmd 规则加引号
  const quoted = prepareSpawn('C:\\Program Files\\hvigorw.bat', ['--os-version', 'HarmonyOS 6.0.1(21)'], 'win32');
  assert.equal(
    quoted.command,
    '"C:\\Program Files\\hvigorw.bat" --os-version "HarmonyOS 6.0.1(21)"'
  );
  assert.equal(quoted.shell, true);
});

test('firstExecutable probes candidates in order per platform layout', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tesslo-exec-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  // win32 布局只有 .exe：原始名不命中，第二个候选命中
  fs.writeFileSync(path.join(dir, 'hdc.exe'), '');
  assert.equal(firstExecutable(dir, ['hdc', 'hdc.exe']), path.join(dir, 'hdc.exe'));
  // unix 布局命中第一个候选
  fs.writeFileSync(path.join(dir, 'hvigorw'), '');
  assert.equal(firstExecutable(dir, ['hvigorw', 'hvigorw.bat']), path.join(dir, 'hvigorw'));
  assert.equal(firstExecutable(dir, ['missing']), null);
});

test('resolveDevecoEntry reads the bin field without assuming package layout', t => {
  // 真实 workspace：bin 指向 dist/cli.js 且存在
  const real = resolveDevecoEntry();
  assert.ok(real);
  assert.equal(real.node, process.execPath);
  assert.ok(real.script.endsWith('cli.js'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tesslo-deveco-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  // bin 为对象形态（{devecocli: "dist/cli.js"}）
  const objectForm = path.join(dir, 'object');
  fs.mkdirSync(path.join(objectForm, 'dist'), {recursive: true});
  fs.writeFileSync(path.join(objectForm, 'package.json'), '{"bin":{"devecocli":"dist/cli.js"}}');
  fs.writeFileSync(path.join(objectForm, 'dist/cli.js'), '');
  assert.equal(resolveDevecoEntry(objectForm)?.script, path.join(objectForm, 'dist/cli.js'));
  // bin 为字符串形态
  const stringForm = path.join(dir, 'string');
  fs.mkdirSync(stringForm, {recursive: true});
  fs.writeFileSync(path.join(stringForm, 'package.json'), '{"bin":"cli.mjs"}');
  fs.writeFileSync(path.join(stringForm, 'cli.mjs'), '');
  assert.equal(resolveDevecoEntry(stringForm)?.script, path.join(stringForm, 'cli.mjs'));
  // 包缺失 / bin 缺失 → null（调用方回退 pnpm exec）
  assert.equal(resolveDevecoEntry(path.join(dir, 'absent')), null);
  const noBin = path.join(dir, 'nobin');
  fs.mkdirSync(noBin, {recursive: true});
  fs.writeFileSync(path.join(noBin, 'package.json'), '{"name":"x"}');
  assert.equal(resolveDevecoEntry(noBin), null);
});
