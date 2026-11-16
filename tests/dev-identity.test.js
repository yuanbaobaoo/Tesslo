import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import JSON5 from 'json5';

import { bundleName, devBundleName, mergeDevProduct, readDebugProfile } from '../scripts/ohos-common.ts';

const appRoot = new URL('../apps/tesslo/', import.meta.url);

/**
 * 读取 apps/tesslo 下的 JSON5 配置。
 */
const readJson5 = relative => JSON5.parse(fs.readFileSync(new URL(relative, appRoot), 'utf8'));

/**
 * 取 string.json 中指定资源的值。
 */
const stringValue = (relative, name) =>
  readJson5(relative).string.find(item => item.name === name)?.value;

/**
 * devecocli 回写后的本机配置形态：只有 default/release，没有 dev。
 */
const localProfile = () => ({
  app: {
    products: [
      { name: 'default', signingConfig: 'default', compatibleSdkVersion: '26.0.0', runtimeOS: 'HarmonyOS' },
      { name: 'release', signingConfig: 'release', compatibleSdkVersion: '26.0.0', runtimeOS: 'HarmonyOS' }
    ],
    signingConfigs: [{ name: 'default' }, { name: 'release' }]
  },
  modules: [
    { name: 'entry', srcPath: './entry', targets: [{ name: 'default', applyToProducts: ['default', 'release'] }] }
  ]
});

test('template gives the dev product its own bundle name and Tesslo-dev labels', () => {
  const template = readJson5('build-profile.template.json5');
  const dev = template.app.products.find(item => item.name === 'dev');
  assert.equal(dev.bundleName, devBundleName);
  assert.equal(dev.label, '$string:app_name_dev');
  // 签名配置由 devecocli 回填，模板里不能预置
  assert.equal(dev.signingConfig, undefined);
  const targets = template.modules.find(item => item.name === 'entry').targets;
  assert.deepEqual(targets.find(item => item.name === 'dev').applyToProducts, ['dev']);
  assert.ok(!targets.find(item => item.name === 'default').applyToProducts.includes('dev'));

  const entryTarget = readJson5('entry/build-profile.json5').targets.find(item => item.name === 'dev');
  assert.deepEqual(entryTarget.source.abilities, [
    { name: 'EntryAbility', label: '$string:EntryAbility_label_dev' }
  ]);
  assert.equal(stringValue('AppScope/resources/base/element/string.json', 'app_name_dev'), 'Tesslo-dev');
  assert.equal(
    stringValue('entry/src/main/resources/base/element/string.json', 'EntryAbility_label_dev'),
    'Tesslo-dev'
  );
});

test('resources_dev only overrides the shortcuts profile, rebound to the dev bundle', () => {
  // hvigor 只替换模块级 metadata 里快捷方式的包名，EntryAbility 上的这份靠覆盖目录：
  // 覆盖目录须排在前面，且只放这一个文件，避免意外遮蔽其它资源
  const target = readJson5('entry/build-profile.json5').targets.find(item => item.name === 'dev');
  assert.deepEqual(target.resource.directories, ['./src/main/resources_dev', './src/main/resources']);
  const overrides = fs.readdirSync(new URL('entry/src/main/resources_dev/', appRoot), { recursive: true })
    .filter(name => fs.statSync(new URL(`entry/src/main/resources_dev/${name}`, appRoot)).isFile());
  assert.deepEqual(overrides.map(name => name.split(path.sep).join('/')), ['base/profile/shortcuts_config.json']);

  // dev 副本须与正式版逐项一致、仅包名不同：改了正式版的快捷方式要同步这里
  const main = readJson5('entry/src/main/resources/base/profile/shortcuts_config.json');
  const dev = readJson5('entry/src/main/resources_dev/base/profile/shortcuts_config.json');
  assert.deepEqual(
    dev,
    JSON.parse(JSON.stringify(main).replaceAll(`"${bundleName}"`, `"${devBundleName}"`))
  );
  assert.ok(JSON.stringify(main).includes(`"${bundleName}"`));
});

test('mergeDevProduct adds the dev product and target from the template once', () => {
  const template = readJson5('build-profile.template.json5');
  const profile = localProfile();
  assert.deepEqual(mergeDevProduct(profile, template), ['dev product', 'entry 的 dev target']);
  assert.equal(profile.app.products.find(item => item.name === 'dev').bundleName, devBundleName);
  assert.deepEqual(profile.modules[0].targets.find(item => item.name === 'dev').applyToProducts, ['dev']);
  // 已有条目（default/release 的签名配置）原样保留，再次合并不改动
  assert.equal(profile.app.products.find(item => item.name === 'release').signingConfig, 'release');
  assert.deepEqual(mergeDevProduct(profile, template), []);
});

test('mergeDevProduct keeps a signingConfig backfilled by devecocli', () => {
  const template = readJson5('build-profile.template.json5');
  const profile = localProfile();
  mergeDevProduct(profile, template);
  profile.app.products.find(item => item.name === 'dev').signingConfig = 'dev';
  mergeDevProduct(profile, template);
  assert.equal(profile.app.products.find(item => item.name === 'dev').signingConfig, 'dev');
});

test('mergeDevProduct rejects a dev product bound to another bundle name', () => {
  const template = readJson5('build-profile.template.json5');
  const profile = localProfile();
  profile.app.products.push({ name: 'dev', bundleName: 'io.github.yuanbaobaoo.tesslo' });
  assert.throws(() => mergeDevProduct(profile, template), /应为 io\.github\.yuanbaobaoo\.tesslo\.dev/);
});

test('readDebugProfile extracts the embedded profile JSON from DER bytes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tesslo-p7b-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const json = JSON.stringify({
    'version-name': '2.0.0',
    // 字符串里的括号不能打断配对
    'bundle-info': { 'bundle-name': devBundleName, 'development-certificate': 'AB}C{D' },
    validity: { 'not-after': 1824792226 },
    'debug-info': { 'device-ids': ['454d55'.padEnd(64, 'a')] }
  });
  const file = path.join(dir, 'dev.p7b');
  // DER 头里混入 0x7B（'{'）字节，尾部混入括号字节
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x30, 0x82, 0x13, 0x7b, 0x06]),
    Buffer.from(json, 'latin1'),
    Buffer.from([0xa0, 0x7d, 0x7b, 0x00])
  ]));
  assert.deepEqual(readDebugProfile(file), {
    bundleName: devBundleName,
    notAfter: 1824792226,
    deviceIds: ['454D55'.padEnd(64, 'A')]
  });

  const garbage = path.join(dir, 'garbage.p7b');
  fs.writeFileSync(garbage, Buffer.from([0x30, 0x82, 0x01, 0x02]));
  assert.equal(readDebugProfile(garbage), null);
});
