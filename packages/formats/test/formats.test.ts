// formats 单测：.tess 往返 / tesslo.json 校验 / sb3 互通（node:test，规范 §11）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSb3, createTessloMeta, detectFormat, readTess, readTessMeta,
    sb3ToTess, TessFormatError, writeTess} from '../src/index.ts';

// 最小合法 Scratch 项目 JSON（语义完整性由兼容回归语料覆盖，这里只测容器）
const sampleProject = (): unknown => ({
    targets: [
        {
            isStage: true,
            name: 'Stage',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [
                {
                    assetId: 'f9a1c175e2a407db2d1417f1c4cdcf73',
                    name: '背景1',
                    md5ext: 'f9a1c175e2a407db2d1417f1c4cdcf73.svg',
                    dataFormat: 'svg',
                    rotationCenterX: 240,
                    rotationCenterY: 180
                }
            ],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'off',
            textToSpeechLanguage: null
        }
    ],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '2.3.0', agent: 'tesslo-test'}
});

// 素材成员（内容任意，容器层不校验 md5 与内容一致性）
const sampleAssets = (): Map<string, Uint8Array> => new Map([
    ['f9a1c175e2a407db2d1417f1c4cdcf73.svg', new Uint8Array([60, 63, 120, 109, 108])]
]);

test('writeTess → readTess 往返：元数据 / 项目 / 素材完整', async () => {
    const meta = createTessloMeta('我的游戏', 'proj-001');
    const bytes = await writeTess({meta, project: sampleProject(), assets: sampleAssets()});

    const container = await readTess(bytes);
    assert.equal(container.meta.projectId, 'proj-001');
    assert.equal(container.meta.name, '我的游戏');
    assert.deepEqual(container.project, sampleProject());
    assert.deepEqual(container.assets.get('f9a1c175e2a407db2d1417f1c4cdcf73.svg'),
        new Uint8Array([60, 63, 120, 109, 108]));
});

test('readTess 拒绝未知成员与非法 zip', async () => {
    const meta = createTessloMeta('x', 'proj-x');
    const bytes = await writeTess({meta, project: sampleProject(), assets: sampleAssets()});

    await assert.rejects(() => readTess(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer),
        TessFormatError);

    // 注入未知成员：手工构造
    const {default: JSZip} = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    zip.file('notes.txt', 'hello');
    const dirty = await zip.generateAsync({type: 'arraybuffer'});
    await assert.rejects(() => readTess(dirty), /unexpected member/);
});

test('readTessMeta 轻量读取与完整读取一致', async () => {
    const meta = createTessloMeta('轻量', 'proj-002');
    const bytes = await writeTess({meta, project: sampleProject(), assets: sampleAssets()});
    assert.equal((await readTessMeta(bytes)).projectId, 'proj-002');
});

test('formatVersion 前向不兼容被拒绝', async () => {
    const meta = {...createTessloMeta('未来', 'proj-003'), formatVersion: 99};
    const bytes = await writeTess({meta, project: sampleProject(), assets: sampleAssets()});
    await assert.rejects(() => readTess(bytes), /unsupported formatVersion/);
});

test('sb3 互通：tess → sb3 → tess 元数据无损（静默成员）', async () => {
    const meta = createTessloMeta('互通测试', 'proj-004');
    const tessBytes = await writeTess({meta, project: sampleProject(), assets: sampleAssets()});
    const sb3Bytes = await buildSb3(await readTess(tessBytes));

    // 回程：带静默成员 → 元数据完整恢复
    const back = await sb3ToTess(sb3Bytes, '不重要', 'new-id');
    assert.equal(back.meta.projectId, 'proj-004');
    assert.equal(back.meta.name, '互通测试');
    assert.deepEqual(back.project, sampleProject());
    assert.equal(back.assets.size, 1);
});

test('sb3 互通：官方 sb3（无静默成员）按文件名派生身份', async () => {
    const meta = createTessloMeta('来源', 'proj-005');
    const tessBytes = await writeTess({meta, project: sampleProject(), assets: sampleAssets()});
    const sb3Bytes = await buildSb3(await readTess(tessBytes));

    // 剥离静默成员，模拟官方 Scratch 重存
    const {default: JSZip} = await import('jszip');
    const zip = await JSZip.loadAsync(sb3Bytes);
    zip.remove('tesslo.json');
    const official = await zip.generateAsync({type: 'arraybuffer'});

    const imported = await sb3ToTess(official, '官方项目', 'generated-id');
    assert.equal(imported.meta.projectId, 'generated-id');
    assert.equal(imported.meta.name, '官方项目');
    assert.deepEqual(imported.project, sampleProject());
});

test('detectFormat 按扩展名分流', () => {
    assert.equal(detectFormat('作品.tess'), 'tess');
    assert.equal(detectFormat('WORK.SB3'), 'sb3');
    assert.throws(() => detectFormat('readme.txt'), TessFormatError);
});
