// 兼容回归 v1：格式往返金测（语料 sb3 → .tess → 读回，语义无损）。
// 引擎 / 格式层改动必跑（规范 §11）；行为金测（VM 运行快照）待 U8 基线后接入。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {readTess, sb3ToTess, writeTess} from '../packages/formats/src/index.ts';

// 语料目录（官方固定件 24 个；扩充见 tests/corpus/README.md）
const corpusDir: string = join(dirname(fileURLToPath(import.meta.url)), 'corpus');
const sb3Files: Array<string> = readdirSync(corpusDir)
    .filter((name: string): boolean => name.endsWith('.sb3'))
    .sort();

// 负向语料：损坏/非标准样本，往返应当报错或原样容忍，不得静默丢内容
// - corrupt_png / corrupt_svg / missing_svg：素材级损坏（官方 vm 负向固定件，
//   zip 本身合法或损坏，sb3ToTess 可能拒绝）
// - origin.sb3：打包损坏样本（内容嵌套在 origin/ 子目录，无根级 project.json）
const CORRUPT_SAMPLES: ReadonlySet<string> = new Set([
    'corrupt_png.sb3',
    'corrupt_svg.sb3',
    'missing_svg.sb3',
    'origin.sb3'
]);

test('语料库就位（≥20 官方固定件）', () => {
    assert.ok(sb3Files.length >= 20, `语料不足：${sb3Files.length}`);
});

for (const fileName of sb3Files) {
    test(`往返：${fileName}`, async () => {
        const raw: Buffer = readFileSync(join(corpusDir, fileName));
        const bytes: ArrayBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

        if (CORRUPT_SAMPLES.has(fileName)) {
            // 负向：损坏样本必须抛 TessFormatError 或保持可解析但内容原样
            try {
                const staged = await sb3ToTess(bytes, fileName, 'corpus-id');
                const roundTrip = await readTess(await writeTess(staged));
                assert.deepEqual(roundTrip.project, staged.project);
            } catch (cause) {
                assert.ok(cause instanceof Error, '损坏样本抛出的是 Error');
            }
            return;
        }

        // 正向：sb3 → tess 容器 → 字节 → 读回，项目 JSON 与素材逐字节等价
        const staged = await sb3ToTess(bytes, fileName, 'corpus-id');
        const rebuiltBytes = await writeTess(staged);
        const roundTrip = await readTess(rebuiltBytes);

        assert.equal(roundTrip.meta.projectId, 'corpus-id');
        assert.deepEqual(roundTrip.project, staged.project,
            `${fileName}: project JSON 语义变化`);
        assert.equal(roundTrip.assets.size, staged.assets.size,
            `${fileName}: 素材数量变化`);
        for (const [memberName, assetBytes] of staged.assets) {
            const returned: Uint8Array | undefined = roundTrip.assets.get(memberName);
            assert.ok(returned, `${fileName}: 素材丢失 ${memberName}`);
            assert.deepEqual(returned, assetBytes, `${fileName}: 素材字节变化 ${memberName}`);
        }
    });
}
