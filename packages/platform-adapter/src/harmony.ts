// harmony 实现：经回环 HTTP 访问宿主 ProjectServer（P1）与 AssetServer。
// 端口唯一事实来源是 apps/tesslo/entry/src/main/ets/common/Ports.ets；
// Web 侧只有本文件允许出现端口字面量（规范 §9/§10.2：adapter 是唯一出口）。
// v5：项目工作区以目录结构（tesslo.json/project.json/assets）进出，
// .tess/.sb3 只是导出产物；旧 .tess 经 E_LEGACY + readLegacyTess 迁移。
import {ADAPTER_PROTOCOL, type AssetStore, type PlatformAdapter, type ProjectAsset,
    type ProjectBundle, type ProjectIdentityQuery, type ProjectMeta, type ProjectSnapshot,
    type ProjectStore, type ProjectSummary, type SnapshotContent} from './types.ts';
import {requestJson, TIMEOUT_MS_DEFAULT, TIMEOUT_MS_PICKER, TIMEOUT_MS_SLOW} from './envelope.ts';
import {platformError} from './errors.ts';

// ProjectServer 端口（Ports.ets PROJECT_SERVER_PORT，P1 新登记）
const PROJECT_SERVER_PORT = 20117;
// AssetServer 端口（Ports.ets ASSET_SERVER_PORT，存量 20114）
const ASSET_SERVER_PORT = 20114;

// 素材 ID / 格式仅允许安全文件名字符：拼进 URL 前挡住路径注入
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

const projectBase = `http://127.0.0.1:${PROJECT_SERVER_PORT}`;
const assetBase = `http://127.0.0.1:${ASSET_SERVER_PORT}`;

// 宿主工作区响应体（ProjectServer: BundleBody）
interface AssetBody {
    readonly md5ext: string;
    readonly bytesBase64: string;
}

interface BundleBody {
    readonly meta: ProjectMeta;
    readonly project: Record<string, unknown>;
    readonly assets: AssetBody[];
}

// 快照响应体（kind: bundle | tess）
interface SnapshotBundleBody {
    readonly kind: string;
    readonly meta: ProjectMeta;
    readonly project: Record<string, unknown>;
}

interface SnapshotTessBody {
    readonly kind: string;
    readonly tessBase64: string;
}

// 旧 .tess 响应体（迁移用）
interface LegacyTessBody {
    readonly tessBase64: string;
}

// 导入去重查询响应体
interface FindBody {
    readonly found: boolean;
    readonly project?: ProjectSummary;
}

// 宿主 POST /pick-dir 的响应体（ProjectServer: PickDirBody）
interface PickDirBody {
    readonly dirUri: string;
    readonly persisted: boolean;
}

// JSON 请求 init 构造（POST/PUT 语义）
const jsonInit = (method: string, body: object): RequestInit => ({
    method,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
});

// 字节过 JSON 信封的载体（回环内传输，体积放大 4/3 可接受；P2 再评估二进制通道）
const bytesToBase64 = (bytes: ArrayBuffer): string => {
    const view = new Uint8Array(bytes);
    let binary = '';
    const CHUNK = 0x8000; // 32KB 分段，避免 String.fromCharCode 栈溢出
    for (let index = 0; index < view.length; index += CHUNK) {
        binary += String.fromCharCode(...view.subarray(index, index + CHUNK));
    }
    return btoa(binary);
};
const base64ToBytes = (encoded: string): ArrayBuffer => {
    const binary = atob(encoded);
    const view = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        view[index] = binary.charCodeAt(index);
    }
    return view.buffer;
};

// 宿主素材体 → 产品层素材
const toProjectAsset = (body: AssetBody): ProjectAsset => ({
    md5ext: body.md5ext,
    bytes: base64ToBytes(body.bytesBase64)
});

// 产品层素材 → 宿主素材体
const fromProjectAsset = (asset: ProjectAsset): AssetBody => ({
    md5ext: asset.md5ext,
    bytesBase64: bytesToBase64(asset.bytes)
});

/**
 * 创建 harmony 平台的 ProjectStore。
 *
 * @returns 走 ProjectServer JSON API 的实现。
 */
const createProjectStore = (): ProjectStore => ({
    listProjects: () => requestJson<ProjectSummary[]>(
        `${projectBase}/projects`, {method: 'GET'}, TIMEOUT_MS_DEFAULT
    ),

    createProject: (name, options) => requestJson<ProjectSummary>(
        `${projectBase}/projects`,
        jsonInit('POST', {name, customDirUri: options?.customDirUri})
    ),

    readProject: id => requestJson<BundleBody>(
        `${projectBase}/projects/${encodeURIComponent(id)}`, {method: 'GET'}, TIMEOUT_MS_SLOW
    ).then(body => ({
        meta: body.meta,
        project: body.project,
        assets: body.assets.map(toProjectAsset)
    })),

    saveProject: (id, bundle: ProjectBundle) => requestJson<ProjectSummary>(
        `${projectBase}/projects/${encodeURIComponent(id)}`,
        jsonInit('PUT', {
            meta: bundle.meta,
            project: bundle.project,
            assets: bundle.assets.map(fromProjectAsset)
        }),
        TIMEOUT_MS_SLOW
    ),

    deleteProject: (id, options) => requestJson<void>(
        `${projectBase}/projects/${encodeURIComponent(id)}?deleteDir=${options.deleteDir ? 1 : 0}`,
        {method: 'DELETE'}
    ).then(() => undefined),

    renameProject: (id, name) => requestJson<ProjectSummary>(
        `${projectBase}/projects/${encodeURIComponent(id)}/meta`,
        jsonInit('PUT', {name})
    ),

    duplicateProject: (id, newName) => requestJson<ProjectSummary>(
        `${projectBase}/projects/${encodeURIComponent(id)}/duplicate`,
        jsonInit('POST', {newName})
    ),

    listSnapshots: id => requestJson<ProjectSnapshot[]>(
        `${projectBase}/projects/${encodeURIComponent(id)}/snapshots`, {method: 'GET'}
    ),

    readSnapshot: (id, snapshotId) => requestJson<SnapshotBundleBody | SnapshotTessBody>(
        `${projectBase}/projects/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapshotId)}`,
        {method: 'GET'}, TIMEOUT_MS_SLOW
    ).then((body): SnapshotContent => {
        if (body.kind === 'tess') {
            return {kind: 'tess', bytes: base64ToBytes((body as SnapshotTessBody).tessBase64)};
        }
        const bundle = body as SnapshotBundleBody;
        return {kind: 'bundle', meta: bundle.meta, project: bundle.project};
    }),

    relinkProject: (id, dirUri) => requestJson<ProjectSummary>(
        `${projectBase}/projects/${encodeURIComponent(id)}/relink`,
        jsonInit('POST', {dirUri})
    ),

    setFavorite: (id, favorite) => requestJson<ProjectSummary>(
        `${projectBase}/projects/${encodeURIComponent(id)}/meta`,
        jsonInit('PUT', {favorite})
    ),

    findExistingProject: (query: ProjectIdentityQuery) => requestJson<FindBody>(
        `${projectBase}/projects/find`,
        jsonInit('POST', {
            projectId: query.projectId,
            fingerprint: query.fingerprint
        })
    ).then(body => (body.found && body.project ? body.project : null)),

    readLegacyTess: id => requestJson<LegacyTessBody>(
        `${projectBase}/projects/${encodeURIComponent(id)}/legacy`,
        {method: 'GET'}, TIMEOUT_MS_SLOW
    ).then(body => base64ToBytes(body.tessBase64)),

    // 单文件 HTML 在宿主侧组装（模板 13MB，经页面 base64 传输会卡死主线程）；
    // 服务端在用户完成保存选择器后才返回，沿用 picker 超时
    exportHtmlProject: id => requestJson<void>(
        `${projectBase}/projects/${encodeURIComponent(id)}/export-html`,
        jsonInit('POST', {}), TIMEOUT_MS_PICKER
    ).then(() => undefined)
});

/**
 * 创建 harmony 平台的 AssetStore（离线素材库）。
 *
 * @returns 走 AssetServer（rawfile 静态目录）的实现。
 */
const createAssetStore = (): AssetStore => ({
    load: async (assetId, dataFormat) => {
        if (!SAFE_NAME.test(assetId) || !SAFE_NAME.test(dataFormat)) {
            throw platformError('E_IO', `invalid asset name: ${assetId}.${dataFormat}`);
        }
        const response = await fetch(`${assetBase}/static/fetched/${assetId}.${dataFormat}`);
        if (!response.ok) {
            throw platformError('E_IO', `asset ${assetId}.${dataFormat} returned ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
    }
});

/**
 * harmony 平台完整 adapter（ArkWeb 宿主内使用）。
 */
export const harmonyAdapter: PlatformAdapter = {
    protocol: ADAPTER_PROTOCOL,
    projects: createProjectStore(),
    assets: createAssetStore(),

    // 宿主返回 {dirUri, persisted}：必须解包成 URI 字符串（曾把对象直接当目录传入，
    // 服务端见非字符串字段按缺省处理，自定义目录被静默回落到默认库）
    pickProjectDir: () => requestJson<PickDirBody>(
        `${projectBase}/pick-dir`, {method: 'POST'}, TIMEOUT_MS_PICKER
    ).then(body => body.dirUri),

    // 下载落盘由宿主 DownloadSaver 承接（复用存量下载链路）
    saveDownload: async (fileName, bytes, mimeType) => {
        await requestJson<void>(
            `${projectBase}/download`,
            jsonInit('POST', {fileName, mimeType, bytesBase64: bytesToBase64(bytes)}),
            TIMEOUT_MS_PICKER
        );
    }
};
