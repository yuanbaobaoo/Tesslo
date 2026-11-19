// 导出 HTML 组装协议单测（纯字符串逻辑，node:test）。
import test from 'node:test';
import assert from 'node:assert/strict';
// 深路径 import：barrel（index.ts）引到 .tsx，node 原生 strip-types 不支持
import {assetsToDataUriMap, buildExportedHtml, PLAYER_DATA_ELEMENT_ID,
    PLAYER_PLACEHOLDER_DATA, PLAYER_PLACEHOLDER_TITLE} from '../src/export/exported-html.ts';

// 最小模板（模拟 inline-player-template 产物的占位结构）
const sampleTemplate: string = `<!DOCTYPE html><html><head><title>${PLAYER_PLACEHOLDER_TITLE}</title></head>` +
    `<body><div id="app"></div>` +
    `<script type="application/json" id="${PLAYER_DATA_ELEMENT_ID}">${PLAYER_PLACEHOLDER_DATA}</script>` +
    `<script>console.log('player-bundle');</script></body></html>`;

test('buildExportedHtml：占位符替换 + 数据内嵌', () => {
    const html = buildExportedHtml(sampleTemplate, {
        meta: {name: '我的游戏', projectId: 'p-1'},
        project: {targets: []},
        assets: {}
    });
    assert.ok(html.includes('<title>我的游戏</title>'), 'title 注入');
    assert.ok(!html.includes(PLAYER_PLACEHOLDER_DATA), '数据占位符已消费');
    assert.ok(!html.includes(PLAYER_PLACEHOLDER_TITLE), '标题占位符已消费');
    // 数据块可被 player 端 JSON.parse 等价还原
    const match = html.match(new RegExp(
        `<script type="application/json" id="${PLAYER_DATA_ELEMENT_ID}">(.*?)</script>`, 's'));
    assert.ok(match, '数据块存在');
    const parsed = JSON.parse(match[1] ?? '');
    assert.equal(parsed.meta.projectId, 'p-1');
});

test('buildExportedHtml：内容含 </script> 不截断数据块', () => {
    const html = buildExportedHtml(sampleTemplate, {
        meta: {name: 'x</title><script>alert(1)</script>', projectId: 'p-2'},
        project: {evil: '</script><script>alert(1)</script>'},
        assets: {}
    });
    // 数据块必须完整闭合且 parse 后原样保留恶意串（作为数据而非标签）
    const match = html.match(new RegExp(
        `<script type="application/json" id="${PLAYER_DATA_ELEMENT_ID}">(.*?)</script>`, 's'));
    assert.ok(match, '数据块存在且未被内容截断');
    const parsed = JSON.parse(match[1] ?? '');
    assert.equal(parsed.project.evil, '</script><script>alert(1)</script>');
    // title 注入被转义
    assert.ok(!html.includes('<title>x</title><script>alert(1)</script></title>'));
});

test('assetsToDataUriMap：字节 → dataURI（base64 往返）', () => {
    const bytes = new Uint8Array([60, 63, 120, 109, 108]); // "<?xml"
    const map = assetsToDataUriMap(new Map([['a'.repeat(32) + '.svg', bytes]]));
    const dataUri: string = map['a'.repeat(32) + '.svg'] ?? '';
    assert.ok(dataUri.startsWith('data:image/svg+xml;base64,'));
    const decoded: string = Buffer.from(dataUri.split(',')[1] ?? '', 'base64').toString('binary');
    assert.equal(decoded, '<?xml');
});

test('assetsToDataUriMap：未知扩展名回退 octet-stream', () => {
    const map = assetsToDataUriMap(new Map([['b'.repeat(32) + '.xyz', new Uint8Array([1])]]));
    assert.ok((map['b'.repeat(32) + '.xyz'] ?? '').startsWith('data:application/octet-stream;base64,'));
});
