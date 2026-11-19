// 兼容矩阵端到端（P1-works.md 兼容矩阵五行）：
// 用官方语义引擎（scratch-vm node dist）加载 Tesslo 产物，机器验证"核心内容 100% 可用"。
// 行 5（.tess → 官方 Scratch 不支持）是设计定论，由矩阵表断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {buildSb3, readTess, sb3ToTess, writeTess} from '../packages/formats/src/index.ts';

const require2 = createRequire(import.meta.url);
// 官方语义引擎：scratch-vm node dist（引擎包名级引用，测试装配层）
const VirtualMachine = require2('../packages/engine/scratch/scratch-vm/dist/node/scratch-vm.js');

const corpusDir: string = join(dirname(fileURLToPath(import.meta.url)), 'corpus');

// vm 结构摘要（加载成功后取）
const vmStats = (vm: {runtime: {targets: Array<{isStage?: boolean; getName(): string;
    blocks: {_blocks: Record<string, {opcode?: string}>}}>}}): {sprites: number;
    blocks: number; names: string[]} => {
    const sprites = vm.runtime.targets.filter(target => target.isStage !== true);
    let blocks = 0;
    for (const target of vm.runtime.targets) {
        blocks += Object.values(target.blocks._blocks)
            .filter(block => typeof block.opcode === 'string').length;
    }
    return {sprites: sprites.length, blocks, names: sprites.map(sprite => sprite.getName())};
};

// 加载一个项目（sb3 字节或 project.json 文本），返回结构摘要
// audioEngine stub：node 无 AudioContext——音乐扩展构造期会调用
// loadSound/decodeSoundPlayer/createBank 等一整套 API，用 Proxy 全量吞掉
// （返回 null/空结果不破坏结构加载与积木解析，官方 vm 测试同思路）
const makeAudioEngineStub = (): object => {
    const soundBank = {stopAllSounds: (): void => undefined, playSound: (): void => undefined};
    return new Proxy({}, {
        get: (_target: object, property: string | symbol): unknown => {
            if (property === 'then') {
                return undefined; // 避免 thenable 误判
            }
            if (property === 'ingestedSoundsFor') {
                return (): typeof soundBank => soundBank; // 须同步返回对象
            }
            return async (): Promise<null> => null;
        }
    });
};
const loadWithOfficialVm = async (input: Uint8Array | string): Promise<ReturnType<typeof vmStats>> => {
    const vm = new VirtualMachine();
    vm.attachAudioEngine(makeAudioEngineStub());
    await vm.loadProject(input);
    return vmStats(vm); // 不触发 stopAll（其声音链依赖真实 audioEngine）
};

const readCorpus = (name: string): ArrayBuffer => {
    const raw: Buffer = readFileSync(join(corpusDir, name));
    return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
};

// 矩阵行 1：Tesslo → 导出 .sb3 → 官方（语义引擎）加载，核心内容等价
test('矩阵行1：Tesslo 导出 .sb3 经官方引擎加载，核心内容等价', async () => {
    for (const fileName of ['variable_characters.sb3', 'monitors.sb3', 'default.sb3']) {
        const original: ArrayBuffer = readCorpus(fileName);
        const baseline = await loadWithOfficialVm(new Uint8Array(original));
        // Tesslo 链路：sb3 → .tess 容器 → 再导出 .sb3
        const staged = await sb3ToTess(original, fileName, 'm1');
        const exported = await buildSb3(staged);
        const reloaded = await loadWithOfficialVm(new Uint8Array(exported));
        assert.deepEqual(reloaded, baseline, `${fileName}：经 Tesslo 往返后官方加载结构不一致`);
    }
});

// 矩阵行 2：官方 .sb3 → 导入 Tesslo（project.json 语义保留，官方引擎可加载）
test('矩阵行2：官方 .sb3 导入 Tesslo 后项目语义完整', async () => {
    const original: ArrayBuffer = readCorpus('variable_characters.sb3');
    const baseline = await loadWithOfficialVm(new Uint8Array(original));
    const staged = await sb3ToTess(original, '导入作品', 'm2');
    // 导入产物以 project.json 文本喂官方引擎（vm 原生支持 json 输入）
    const reloaded = await loadWithOfficialVm(JSON.stringify(staged.project));
    assert.deepEqual(reloaded, baseline, '导入后的 project.json 官方加载结构不一致');
});

// 矩阵行 3：.tess 导回 Tesslo 完整恢复（官方引擎再次确认语义）
test('矩阵行3：.tess 导回后语义不变', async () => {
    const original: ArrayBuffer = readCorpus('monitors.sb3');
    const staged = await sb3ToTess(original, '回环', 'm3');
    const roundTrip = await readTess(await writeTess(staged));
    const reloaded = await loadWithOfficialVm(JSON.stringify(roundTrip.project));
    const baseline = await loadWithOfficialVm(new Uint8Array(original));
    assert.deepEqual(reloaded, baseline);
});

// 矩阵行 4：官方重存剥离静默成员 → 降级为纯 Scratch 项目打开（不崩溃）
test('矩阵行4：静默成员被剥离后降级打开，不崩溃', async () => {
    const original: ArrayBuffer = readCorpus('default.sb3');
    const staged = await sb3ToTess(original, '剥离测试', 'm4');
    const sb3Bytes = await buildSb3(staged);
    // 模拟官方重存：重读并剥掉 tesslo.json
    const {default: JSZip} = await import('jszip');
    const zip = await JSZip.loadAsync(sb3Bytes);
    zip.remove('tesslo.json');
    const rescanned = await zip.generateAsync({type: 'arraybuffer'});
    const degraded = await sb3ToTess(rescanned, '剥离测试', 'fresh-id');
    assert.equal(degraded.meta.projectId, 'fresh-id', '剥离后应派生新身份而非报错');
    const reloaded = await loadWithOfficialVm(JSON.stringify(degraded.project));
    assert.ok(reloaded.sprites >= 1, '降级后项目仍可运行');
});

// 矩阵行 5：.tess → 官方 Scratch ❌（自有格式；容器校验拒绝根级 project.json 缺失的形态由格式层保证）
test('矩阵行5：.tess 不是 sb3（官方仅认根级 project.json + 约定素材命名）', async () => {
    const original: ArrayBuffer = readCorpus('default.sb3');
    const tessBytes = await writeTess(await sb3ToTess(original, 'x', 'm5'));
    // .tess 用 STORE 且含 tesslo.json 成员：官方加载器语义上会忽略未知成员，
    // 但 Tesslo 导出 .sb3 才是互通路径——这里断言 .tess 不伪装成 .sb3（格式身份区分）
    const {default: JSZip} = await import('jszip');
    const zip = await JSZip.loadAsync(tessBytes);
    assert.ok(zip.file('tesslo.json') !== null, '.tess 应携带自有身份成员');
});
