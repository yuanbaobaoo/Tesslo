// .sb3 互通层：Tesslo ↔ 官方 Scratch 双向。
// 导出：纯净 sb3（project.json + md5 素材）+ 静默内嵌 tesslo.json zip 成员
//       ——官方 Scratch 忽略未知成员，导回 Tesslo 时专属数据完整恢复。
// 导入：官方 sb3 → .tess 容器内容（元数据按文件名派生）。
import JSZip from 'jszip';
import {createTessloMeta, TessFormatError, validateTessloMeta,
    type TessloMeta} from './tess-meta.ts';
import {isAssetMemberName} from './tess-meta.ts';
import type {TessContainer} from './tess.ts';

// sb3 内静默附加成员名（与 .tess 同名同构）
const META_MEMBER = 'tesslo.json';
const PROJECT_MEMBER = 'project.json';

// 文件格式判定（导入入口用）
export type WorkFormat = 'tess' | 'sb3';

/**
 * 按文件扩展名判定格式。
 *
 * @param fileName - 用户选择的文件名。
 * @returns 格式标识。
 * @throws TessFormatError 扩展名未知。
 */
export const detectFormat = (fileName: string): WorkFormat => {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.tess')) return 'tess';
    if (lower.endsWith('.sb3')) return 'sb3';
    throw new TessFormatError(`unsupported file type: ${fileName}`);
};

/**
 * 组装 .sb3 互通导出字节（DEFLATE 压缩，与官方 sb3 产物一致）。
 *
 * @param container - .tess 内容（meta 静默随附）。
 * @returns .sb3 字节。
 */
export const buildSb3 = async (container: TessContainer): Promise<ArrayBuffer> => {
    const zip = new JSZip();
    zip.file(PROJECT_MEMBER, JSON.stringify(container.project));
    zip.file(META_MEMBER, JSON.stringify(container.meta));
    for (const [memberName, bytes] of container.assets) {
        zip.file(memberName, bytes);
    }
    return zip.generateAsync({type: 'arraybuffer', compression: 'DEFLATE'});
};

/**
 * .sb3 → .tess 容器内容（导入转换）。
 * 含 tesslo.json 静默成员（Tesslo 导出的 sb3）时恢复完整元数据；
 * 官方 sb3 则按文件名派生新身份。
 *
 * @param bytes - .sb3 字节。
 * @param fallbackName - 官方 sb3 无名可用时的项目名（来自文件名，已清洗）。
 * @param projectId - 新项目 ID（官方 sb3 导入时启用；有静默成员时忽略）。
 * @returns .tess 容器内容。
 * @throws TessFormatError 非法 sb3。
 */
export const sb3ToTess = async (
    bytes: ArrayBuffer,
    fallbackName: string,
    projectId: string
): Promise<TessContainer> => {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(bytes);
    } catch (cause) {
        throw new TessFormatError(`not a valid .sb3 (zip) file: ${String(cause)}`);
    }
    const projectFile = zip.file(PROJECT_MEMBER);
    if (!projectFile) {
        throw new TessFormatError('sb3 missing project.json');
    }
    let project: unknown;
    try {
        project = JSON.parse(await projectFile.async('string'));
    } catch (cause) {
        throw new TessFormatError(`malformed sb3 project.json: ${String(cause)}`);
    }

    // 静默成员恢复（Tesslo 导出 → 官方 Scratch 未重存 → 导回）
    let meta: TessloMeta | null = null;
    const metaFile = zip.file(META_MEMBER);
    if (metaFile) {
        try {
            meta = validateTessloMeta(JSON.parse(await metaFile.async('string')));
        } catch {
            // 官方 Scratch 重存会剥离未知成员；损坏的静默成员按官方 sb3 处理
            meta = null;
        }
    }

    const assets = new Map<string, Uint8Array>();
    for (const memberName of Object.keys(zip.files)) {
        if (memberName === PROJECT_MEMBER || memberName === META_MEMBER) continue;
        if (!isAssetMemberName(memberName)) continue; // 官方 sb3 可能带 project.json 之外的元数据，忽略
        const entry = zip.file(memberName);
        if (!entry) continue;
        assets.set(memberName, await entry.async('uint8array'));
    }
    return {meta: meta ?? createTessloMeta(fallbackName, projectId), project, assets};
};
