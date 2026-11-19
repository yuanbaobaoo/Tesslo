// .tess 容器编解码（zip）。
// 压缩策略：STORE（不压缩）——宿主 ArkTS 侧未来直接解析时无需实现 inflate；
// 回环传输与本地盘读写下体积差异可接受（项目素材本身多为 png/svg/mp3 已压缩格式）。
import JSZip from 'jszip';
import {isAssetMemberName, TessFormatError, validateTessloMeta, type TessloMeta} from './tess-meta.ts';

// 容器内固定成员名
const META_MEMBER = 'tesslo.json';
const PROJECT_MEMBER = 'project.json';

// 解析后的 .tess 内容
export interface TessContainer {
    readonly meta: TessloMeta;
    readonly project: unknown; // 纯净 Scratch 项目 JSON（解析后的对象）
    readonly assets: Map<string, Uint8Array>; // md5ext → 字节
}

// 组装 .tess 的输入（project 接受对象或字符串，写盘前一律字符串化）
export interface TessBuildInput {
    readonly meta: TessloMeta;
    readonly project: unknown;
    readonly assets: ReadonlyMap<string, Uint8Array> | Iterable<readonly [string, Uint8Array]>;
}

/**
 * 解析 .tess 字节为结构化容器。
 *
 * @param bytes - .tess 文件字节（zip）。
 * @returns 元数据 + 项目 JSON + 素材表。
 * @throws TessFormatError 非法 zip / 成员缺失 / tesslo.json 校验失败。
 */
export const readTess = async (bytes: ArrayBuffer): Promise<TessContainer> => {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(bytes);
    } catch (cause) {
        throw new TessFormatError(`not a valid .tess (zip) file: ${String(cause)}`);
    }

    const metaFile = zip.file(META_MEMBER);
    const projectFile = zip.file(PROJECT_MEMBER);
    if (!metaFile || !projectFile) {
        throw new TessFormatError('missing tesslo.json or project.json member');
    }

    let metaRaw: unknown;
    let projectRaw: unknown;
    try {
        metaRaw = JSON.parse(await metaFile.async('string'));
        projectRaw = JSON.parse(await projectFile.async('string'));
    } catch (cause) {
        throw new TessFormatError(`malformed JSON member: ${String(cause)}`);
    }
    const meta = validateTessloMeta(metaRaw);

    const assets = new Map<string, Uint8Array>();
    for (const memberName of Object.keys(zip.files)) {
        if (memberName === META_MEMBER || memberName === PROJECT_MEMBER) continue;
        if (!isAssetMemberName(memberName)) {
            // 容器纪律：未知成员直接拒绝（前向兼容走 formatVersion 升级）
            throw new TessFormatError(`unexpected member in .tess: ${memberName}`);
        }
        const entry = zip.file(memberName);
        if (!entry) continue;
        assets.set(memberName, await entry.async('uint8array'));
    }
    return {meta, project: projectRaw, assets};
};

/**
 * 组装 .tess 字节。
 *
 * @param input - 元数据 + 项目 JSON + 素材表。
 * @returns zip 字节（STORE 压缩）。
 */
export const writeTess = async (input: TessBuildInput): Promise<ArrayBuffer> => {
    const zip = new JSZip();
    zip.file(META_MEMBER, JSON.stringify(input.meta));
    zip.file(PROJECT_MEMBER,
        typeof input.project === 'string' ? input.project : JSON.stringify(input.project));
    const entries = input.assets instanceof Map ? input.assets.entries() : input.assets;
    for (const [memberName, bytes] of entries) {
        if (!isAssetMemberName(memberName)) {
            throw new TessFormatError(`invalid asset member name: ${memberName}`);
        }
        zip.file(memberName, bytes);
    }
    return zip.generateAsync({type: 'arraybuffer', compression: 'STORE'});
};

/**
 * 只读元数据成员（relink 匹配 / 列表缓存刷新等轻量场景，不解素材）。
 *
 * @param bytes - .tess 文件字节。
 * @returns 元数据。
 * @throws TessFormatError 同 readTess。
 */
export const readTessMeta = async (bytes: ArrayBuffer): Promise<TessloMeta> => {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(bytes);
    } catch (cause) {
        throw new TessFormatError(`not a valid .tess (zip) file: ${String(cause)}`);
    }
    const metaFile = zip.file(META_MEMBER);
    if (!metaFile) {
        throw new TessFormatError('missing tesslo.json member');
    }
    return validateTessloMeta(JSON.parse(await metaFile.async('string')));
};
