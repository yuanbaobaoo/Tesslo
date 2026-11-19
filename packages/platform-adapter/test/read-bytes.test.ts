// harmony adapter 契约测试（v5 目录工作区）：
// - readProject 解包 bundle（meta/project/assets base64 → ArrayBuffer）；
// - pickProjectDir 解开 {dirUri, persisted}；
// - void 端点 {ok:true} 按成功处理；
// - findExistingProject 解包 {found, project}；
// - readLegacyTess 解包 {tessBase64}（旧 .tess 迁移）；
// - exportHtmlProject 请求宿主侧组装端点（v7，void 成功）。
import test from 'node:test';
import assert from 'node:assert/strict';

const envelope = (data: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ok: true, data})
});

const sampleBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x7f]);
const sampleBase64 = Buffer.from(sampleBytes).toString('base64');
const md5ext = '0123456789abcdef0123456789abcdef.svg';

const meta = {
    formatVersion: 1,
    projectId: 'p-1',
    name: '测试作品',
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
    thumbnail: null,
    fingerprint: 'aabbccddeeff0011'
};

const summary = {
    id: 'p-1',
    name: '测试作品',
    updatedAt: '2026-11-19T00:00:00.000Z',
    location: 'sandbox',
    favorite: false,
    missing: false
};

const calls: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (init?.method === 'DELETE') {
        return {ok: true, status: 200, json: async () => ({ok: true})};
    }
    if (url.endsWith('/pick-dir')) {
        return envelope({dirUri: 'file://docs/storage/Users/currentUser/Desktop', persisted: true});
    }
    if (url.endsWith('/projects/find')) {
        return envelope({found: true, project: summary});
    }
    if (url.endsWith('/projects/p-1/legacy')) {
        return envelope({tessBase64: sampleBase64});
    }
    if (url.endsWith('/projects/p-1/snapshots/snap-1')) {
        return envelope({kind: 'bundle', meta, project: {targets: []}});
    }
    if (url.endsWith('/projects/p-1') && init?.method === 'PUT') {
        return envelope(summary);
    }
    if (url.endsWith('/projects/p-1')) {
        return envelope({
            meta,
            project: {targets: [{isStage: true}]},
            assets: [{md5ext, bytesBase64: sampleBase64}]
        });
    }
    return envelope({});
}) as typeof fetch;

const {harmonyAdapter} = await import('../src/harmony.ts');

test('readProject：解包 bundle 并把素材 base64 还原为字节', async () => {
    const bundle = await harmonyAdapter.projects.readProject('p-1');
    assert.equal(bundle.meta.projectId, 'p-1');
    assert.deepEqual(bundle.project, {targets: [{isStage: true}]});
    assert.equal(bundle.assets.length, 1);
    const asset = bundle.assets[0];
    assert.ok(asset);
    assert.equal(asset.md5ext, md5ext);
    assert.deepEqual(new Uint8Array(asset.bytes), sampleBytes);
});

test('saveProject：bundle 素材编码为 base64 并请求 PUT', async () => {
    const saved = await harmonyAdapter.projects.saveProject('p-1', {
        meta,
        project: {targets: []},
        assets: [{md5ext, bytes: sampleBytes.slice().buffer}]
    });
    assert.equal(saved.id, 'p-1');
    assert.ok(calls.some(url => url.endsWith('/projects/p-1')), '请求了保存端点');
});

test('pickProjectDir：解开 {dirUri, persisted} 信封', async () => {
    const dirUri = await harmonyAdapter.pickProjectDir();
    assert.equal(dirUri, 'file://docs/storage/Users/currentUser/Desktop');
});

test('deleteProject：成功信封无 data 时按 void 成功', async () => {
    await assert.doesNotReject(harmonyAdapter.projects.deleteProject('p-1', {deleteDir: true}));
});

test('findExistingProject：解包 {found, project}', async () => {
    const existing = await harmonyAdapter.projects.findExistingProject({fingerprint: 'x'});
    assert.equal(existing?.id, 'p-1');
});

test('readSnapshot：bundle 快照解包', async () => {
    const content = await harmonyAdapter.projects.readSnapshot('p-1', 'snap-1');
    assert.equal(content.kind, 'bundle');
    if (content.kind === 'bundle') {
        assert.equal(content.meta.projectId, 'p-1');
    }
});

test('readLegacyTess：解包 {tessBase64}', async () => {
    const bytes = await harmonyAdapter.projects.readLegacyTess('p-1');
    assert.deepEqual(new Uint8Array(bytes), sampleBytes);
});

test('exportHtmlProject：请求宿主侧组装端点并按 void 成功', async () => {
    await assert.doesNotReject(harmonyAdapter.projects.exportHtmlProject?.('p-1'));
    assert.ok(calls.some(url => url.endsWith('/projects/p-1/export-html')), '请求了 HTML 导出端点');
});
