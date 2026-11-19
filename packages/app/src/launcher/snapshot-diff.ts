// 快照差异摘要（面向孩子：积木总数、角色数、积木类型增减；不做文本 diff）。
// 输入是纯净 Scratch project JSON（.tess 内 project.json 解析结果）。
import {readTess} from '@tesslo/formats';

// 项目统计快照
export interface ProjectSummaryStats {
    readonly spriteCount: number; // 角色数（不含舞台）
    readonly blockCount: number; // 积木总数
    // 积木类别计数（opcode 去掉序号后缀的大类，如 motion / looks / event）
    readonly categories: ReadonlyMap<string, number>;
}

// Scratch 目标（角色/舞台）的最小结构
interface ScratchTarget {
    readonly isStage?: boolean;
    readonly blocks?: Record<string, unknown>;
}

// 积木对象（取 opcode 用）
interface ScratchBlock {
    readonly opcode?: string;
    readonly topLevel?: boolean;
}

// opcode 大类（opcode 前缀）
const categoryOf = (opcode: string): string => {
    const dot: number = opcode.indexOf('_');
    return dot > 0 ? opcode.substring(0, dot) : opcode;
};

/**
 * 统计项目：角色数 / 积木总数 / 积木类别分布。
 *
 * @param project - 纯净 Scratch 项目 JSON。
 * @returns 统计值。
 */
export const summarizeProject = (project: unknown): ProjectSummaryStats => {
    const targets = (project as {targets?: ScratchTarget[]})?.targets ?? [];
    let spriteCount = 0;
    let blockCount = 0;
    const categories = new Map<string, number>();
    for (const target of targets) {
        if (target.isStage !== true) {
            spriteCount += 1;
        }
        const blocks = target.blocks ?? {};
        for (const key of Object.keys(blocks)) {
            const block = blocks[key] as ScratchBlock;
            if (block === null || typeof block !== 'object') {
                continue; // 数组形态的分支占位不算积木
            }
            if (typeof block.opcode === 'string') {
                blockCount += 1;
                const category = categoryOf(block.opcode);
                categories.set(category, (categories.get(category) ?? 0) + 1);
            }
        }
    }
    return {spriteCount, blockCount, categories};
};

/**
 * 快照 vs 当前版的友好差异文案（孩子可读，最多三句）。
 *
 * @param current - 当前版统计。
 * @param snapshot - 快照统计。
 * @returns 文案数组；无实质差异时为空数组。
 */
export const diffStatText = (current: ProjectSummaryStats,
    snapshot: ProjectSummaryStats): string[] => {
    const lines: string[] = [];
    const blockDelta = snapshot.blockCount - current.blockCount;
    if (blockDelta > 0) {
        lines.push(`比现在多 ${blockDelta} 个积木`);
    } else if (blockDelta < 0) {
        lines.push(`比现在少 ${-blockDelta} 个积木`);
    }
    const spriteDelta = snapshot.spriteCount - current.spriteCount;
    if (spriteDelta > 0) {
        lines.push(`多 ${spriteDelta} 个角色`);
    } else if (spriteDelta < 0) {
        lines.push(`少 ${-spriteDelta} 个角色`);
    }
    // 新出现的积木类别
    const newCategories: string[] = [];
    for (const [category, count] of snapshot.categories) {
        if (count > 0 && (current.categories.get(category) ?? 0) === 0) {
            newCategories.push(category);
        }
    }
    if (newCategories.length > 0) {
        lines.push(`有现在没有的积木类型（${newCategories.slice(0, 3).join('、')}）`);
    }
    return lines;
};

/**
 * 从 .tess 字节取统计（旧版快照兼容）。
 *
 * @param tessBytes - .tess 字节。
 * @returns 统计值；容器损坏时抛出。
 */
export const statsFromTess = async (tessBytes: ArrayBuffer): Promise<ProjectSummaryStats> =>
    summarizeProject((await readTess(tessBytes)).project);

/**
 * 从项目 JSON 取统计（目录快照/当前工作区）。
 *
 * @param project - 纯净 Scratch 项目 JSON。
 * @returns 统计值。
 */
export const statsFromProject = (project: unknown): ProjectSummaryStats =>
    summarizeProject(project);

// —— 版本对比（"查看改了啥"） ——

// 单个目标（角色/舞台）的统计
export interface TargetStat {
    readonly name: string;
    readonly isStage: boolean;
    readonly blockCount: number;
}

// 细化统计（含每个角色）
export interface ProjectDetailStats extends ProjectSummaryStats {
    readonly targets: TargetStat[];
}

// 一行对比结论
export interface CompareLine {
    readonly tone: 'more' | 'less' | 'info';
    readonly text: string;
}

// Scratch 目标名（对比用）
interface NamedTarget extends ScratchTarget {
    readonly name?: string;
}

// 积木大类中文名（未知类别回退原始前缀）
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
    motion: '运动',
    looks: '外观',
    sound: '声音',
    event: '事件',
    control: '控制',
    sensing: '侦测',
    operator: '运算',
    variables: '变量',
    list: '列表',
    procedures: '自定义积木',
    argument: '参数',
    pen: '画笔',
    music: '音乐',
    video: '视频',
    text2speech: '文字朗读',
    translate: '翻译',
    makeymakey: 'Makey Makey',
    microbit: 'micro:bit',
    ev3: 'LEGO EV3',
    wedo2: 'WeDo 2.0',
    boost: 'BOOST',
    gdxfor: 'Force and Acceleration'
};

/**
 * 积木大类 → 中文标签。
 *
 * @param category - opcode 前缀。
 * @returns 展示名。
 */
export const categoryLabel = (category: string): string => CATEGORY_LABELS[category] ?? category;

/**
 * 细化统计：角色数 / 总积木 / 每个角色积木数 / 类别分布。
 *
 * @param project - 纯净 Scratch 项目 JSON。
 * @returns 细化统计。
 */
export const detailStats = (project: unknown): ProjectDetailStats => {
    const targets = (project as {targets?: NamedTarget[]})?.targets ?? [];
    const result: TargetStat[] = [];
    let spriteCount = 0;
    let blockCount = 0;
    const categories = new Map<string, number>();
    for (const target of targets) {
        const isStage = target.isStage === true;
        let targetBlocks = 0;
        const blocks = target.blocks ?? {};
        for (const key of Object.keys(blocks)) {
            const block = blocks[key] as ScratchBlock;
            if (block === null || typeof block !== 'object') {
                continue;
            }
            if (typeof block.opcode === 'string') {
                targetBlocks += 1;
                blockCount += 1;
                const category = categoryOf(block.opcode);
                categories.set(category, (categories.get(category) ?? 0) + 1);
            }
        }
        if (!isStage) {
            spriteCount += 1;
        }
        result.push({
            name: target.name !== undefined && target.name.length > 0
                ? target.name : (isStage ? '舞台' : '角色'),
            isStage,
            blockCount: targetBlocks
        });
    }
    return {spriteCount, blockCount, categories, targets: result};
};

// 按名字聚合积木数（重名角色合并，避免对比噪声）
const blocksByName = (stats: ProjectDetailStats, includeStage: boolean): Map<string, number> => {
    const map = new Map<string, number>();
    for (const target of stats.targets) {
        if (target.isStage && !includeStage) {
            continue;
        }
        map.set(target.name, (map.get(target.name) ?? 0) + target.blockCount);
    }
    return map;
};

/**
 * 版本对比：生成面向孩子的差异结论（快照 vs 当前）。
 *
 * @param current - 当前版本细化统计。
 * @param snapshot - 快照版本细化统计。
 * @returns 对比行；完全一致时为单行"没有变化"。
 */
export const compareDetails = (current: ProjectDetailStats,
    snapshot: ProjectDetailStats): CompareLine[] => {
    const lines: CompareLine[] = [];
    const blockDelta = snapshot.blockCount - current.blockCount;
    if (blockDelta !== 0) {
        lines.push({
            tone: blockDelta > 0 ? 'more' : 'less',
            text: `积木总数：该版本 ${snapshot.blockCount} 个，当前 ${current.blockCount} 个`
                + `（${blockDelta > 0 ? '+' : ''}${blockDelta}）`
        });
    }
    const spriteDelta = snapshot.spriteCount - current.spriteCount;
    if (spriteDelta !== 0) {
        lines.push({
            tone: spriteDelta > 0 ? 'more' : 'less',
            text: `角色数：该版本 ${snapshot.spriteCount} 个，当前 ${current.spriteCount} 个`
                + `（${spriteDelta > 0 ? '+' : ''}${spriteDelta}）`
        });
    }
    // 角色增删（按名字聚合，舞台单独列）
    const currentSprites = blocksByName(current, false);
    const snapshotSprites = blocksByName(snapshot, false);
    const addedInCurrent: string[] = []; // 当前有、该版本没有（之后新增）
    const removedInCurrent: string[] = []; // 该版本有、当前没有（之后删除）
    for (const name of currentSprites.keys()) {
        if (!snapshotSprites.has(name)) {
            addedInCurrent.push(name);
        }
    }
    for (const name of snapshotSprites.keys()) {
        if (!currentSprites.has(name)) {
            removedInCurrent.push(name);
        }
    }
    if (addedInCurrent.length > 0) {
        lines.push({tone: 'info', text: `当前新增了角色：${addedInCurrent.slice(0, 5).join('、')}`});
    }
    if (removedInCurrent.length > 0) {
        lines.push({tone: 'info', text: `该版本有、当前已删除的角色：${removedInCurrent.slice(0, 5).join('、')}`});
    }
    // 共同角色的积木数变化
    for (const [name, snapshotBlocks] of snapshotSprites) {
        const currentBlocks = currentSprites.get(name);
        if (currentBlocks === undefined || currentBlocks === snapshotBlocks) {
            continue;
        }
        const delta = snapshotBlocks - currentBlocks;
        lines.push({
            tone: delta > 0 ? 'more' : 'less',
            text: `角色「${name}」：该版本 ${snapshotBlocks} 个积木，当前 ${currentBlocks} 个`
                + `（${delta > 0 ? '+' : ''}${delta}）`
        });
    }
    // 舞台积木变化
    const snapshotStage = blocksByName(snapshot, true).get('舞台') ?? 0;
    const currentStage = blocksByName(current, true).get('舞台') ?? 0;
    if (snapshotStage !== currentStage) {
        const delta = snapshotStage - currentStage;
        lines.push({
            tone: delta > 0 ? 'more' : 'less',
            text: `舞台：该版本 ${snapshotStage} 个积木，当前 ${currentStage} 个（${delta > 0 ? '+' : ''}${delta}）`
        });
    }
    // 积木类别变化
    const categories = new Set<string>([...current.categories.keys(), ...snapshot.categories.keys()]);
    for (const category of categories) {
        const snapshotCount = snapshot.categories.get(category) ?? 0;
        const currentCount = current.categories.get(category) ?? 0;
        if (snapshotCount === currentCount) {
            continue;
        }
        const delta = snapshotCount - currentCount;
        lines.push({
            tone: delta > 0 ? 'more' : 'less',
            text: `${categoryLabel(category)}积木：该版本 ${snapshotCount} 个，当前 ${currentCount} 个`
                + `（${delta > 0 ? '+' : ''}${delta}）`
        });
    }
    if (lines.length === 0) {
        lines.push({tone: 'info', text: '这个版本与当前版本的积木和角色完全一致。'});
    }
    return lines;
};
