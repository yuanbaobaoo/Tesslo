// 快照差异摘要单测：统计与孩子友好文案。
import test from 'node:test';
import assert from 'node:assert/strict';
import {diffStatText, summarizeProject} from '../src/launcher/snapshot-diff.ts';

// 构造最小项目 JSON（1 舞台 + N 角色 + blocks 表）
const makeProject = (sprites: number, opcodes: string[]): unknown => ({
    targets: [
        {isStage: true, blocks: {}},
        ...Array.from({length: sprites}, (_, i) => ({
            isStage: false,
            name: `角色${i}`,
            blocks: Object.fromEntries(opcodes.map((opcode, j) => [
                `b${i}_${j}`, {opcode, topLevel: j === 0}
            ]))
        }))
    ]
});

test('统计：角色数 / 积木数 / 类别分布', () => {
    const stats = summarizeProject(makeProject(2, ['motion_movesteps', 'looks_sayforsecs']));
    assert.equal(stats.spriteCount, 2);
    assert.equal(stats.blockCount, 4);
    assert.equal(stats.categories.get('motion'), 2);
    assert.equal(stats.categories.get('looks'), 2);
});

test('统计：无目标 / 非法输入安全通过', () => {
    assert.equal(summarizeProject({}).spriteCount, 0);
    assert.equal(summarizeProject(null).blockCount, 0);
});

test('差异文案：多积木 / 多角色 / 新类别', () => {
    const current = summarizeProject(makeProject(1, ['motion_movesteps']));
    const snapshot = summarizeProject(makeProject(2, ['motion_movesteps', 'sound_play']));
    const lines = diffStatText(current, snapshot);
    assert.ok(lines.some(line => line.includes('多 3 个积木')), lines.join(';'));
    assert.ok(lines.some(line => line.includes('多 1 个角色')));
    assert.ok(lines.some(line => line.includes('sound')));
});

test('差异文案：完全一致时为空', () => {
    const stats = summarizeProject(makeProject(1, ['motion_movesteps']));
    assert.deepEqual(diffStatText(stats, stats), []);
});
