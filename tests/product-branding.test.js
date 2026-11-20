import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');

const DP = 'packages/engine/scratch/scratch-gui/src/lib/default-project/';
const ELEPHANT_COSTUMES = [
  '039aff3bfeec3e420639d6e79114e22d',
  'ff63c0403802825b0b58a1f739ff36f1'
];
// Scratch 默认猫的两个造型；产品默认作品不应再引用它们
const CAT_COSTUMES = [
  'bcf454acf82e4504149f7ffe07081dbc',
  '0fb9be3e8397c983338cb71dc84d0b25'
];

test('default project uses Tesslo elephant costumes, not the Scratch cat', () => {
  const projectData = read(`${DP}project-data.ts`);
  for (const id of ELEPHANT_COSTUMES) {
    assert.ok(projectData.includes(id), `default project missing elephant costume ${id}`);
  }
  for (const id of CAT_COSTUMES) {
    assert.ok(!projectData.includes(id), `default project still references Scratch cat ${id}`);
  }
  const first = read(`${DP}039aff3bfeec3e420639d6e79114e22d.svg`);
  assert.match(first, /Tesslo Elephant/);
});

test('WebGL modal uses Tesslo branding and has no Scratch 3.0 copy', () => {
  const modal = read('packages/engine/scratch/scratch-gui/src/components/webgl-modal/webgl-modal.jsx');
  assert.ok(modal.includes('gui.webglModal.description'),
    'WebGL modal must render the branded description');
  assert.ok(modal.includes('Tesslo needs WebGL'),
    'WebGL modal default copy should mention Tesslo, not Scratch');

  const brand = read('packages/engine/scratch/scratch-gui/src/lib/tesslo-brand.ts');
  assert.ok(brand.includes("'gui.webglModal.label': 'Tesslo 需要 WebGL'"),
    'brand overlay must replace the WebGL modal title');
  assert.ok(brand.includes('当前浏览器未启用 WebGL，Tesslo 无法绘制舞台'),
    'brand overlay must provide the Chinese Tesslo description');
  assert.ok(!brand.includes('Scratch 3.0'),
    'brand overlay must not retain Scratch 3.0 copy');
});
