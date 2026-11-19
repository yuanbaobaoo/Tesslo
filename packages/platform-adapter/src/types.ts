// PlatformAdapter 接口（架构 §10 / docs/plans/P1-works.md）。
// 改动本接口视为协议变更：ADAPTER_PROTOCOL +1，harmony/browser 双实现
// 同步修改，并在 PR 说明列出破坏面（规范 §10.2）。

// 协议版本：产品层与宿主服务的契约版本
// v2（2026-11-18）：新增 readSnapshot（快照差异摘要需要快照内容）
// v3（2026-11-19）：曾试过"外部项目=单个 .tess 文件"（目录 URI 直接拼子文件
//   报 13900002 导致误判平台不支持目录）
// v4（2026-11-19）：外部项目 = 用户选定的空目录 + 持久授权；目录 URI 经
//   fileUri.FileUri(uri).path 转真实路径后，目录 IO 全部可用
// v5（2026-11-19）：**目录即工程**。宿主把项目存为目录结构
//   （tesslo.json / project.json / assets/ / snapshots/），.tess/.sb3 仅作为
//   导出产物；adapter 进出改为 ProjectBundle（不再传 .tess 字节）；
//   新增 findExistingProject（导入去重）与 readLegacyTess（旧 .tess 迁移）。
// v6（2026-11-19）：ProjectSummary 增加可选 thumbnail（项目封面 dataURI，
//   由编辑器保存时截取舞台生成；无缩略图时列表显示占位封面）。
// v7（2026-11-19）：新增可选 exportHtmlProject（宿主侧组装单文件 HTML，
//   避免 13MB 播放器模板经回环 JSON/base64 传输导致页面长时间卡死）。
export const ADAPTER_PROTOCOL = 7;

// 项目元数据（tesslo.json 的结构投影；与 @tesslo/formats 的 TessloMeta 同形）
export interface ProjectMeta {
    readonly formatVersion: number;
    readonly projectId: string;
    readonly name: string;
    readonly createdAt: string; // ISO 8601
    readonly updatedAt: string; // ISO 8601
    readonly thumbnail?: string | null; // dataURI；无缩略图为 null
    readonly author?: string;
    readonly settings?: Record<string, unknown>;
    // 项目内容指纹（导入去重；旧项目可缺省）
    readonly fingerprint?: string;
}

// 单个素材（md5ext → 字节）
export interface ProjectAsset {
    readonly md5ext: string; // <32位小写md5>.<扩展名>
    readonly bytes: ArrayBuffer;
}

// 项目工作区内容（目录结构的读写单位）
export interface ProjectBundle {
    readonly meta: ProjectMeta;
    readonly project: Record<string, unknown>; // 纯净 Scratch project.json
    readonly assets: ProjectAsset[];
}

// 项目在列表页的注册信息（元数据以 tesslo.json 为准，此为缓存）
export interface ProjectSummary {
    readonly id: string; // 项目 ID（写入 tesslo.json 的 projectId）
    readonly name: string;
    readonly updatedAt: string; // ISO 8601
    readonly location: 'sandbox' | 'external'; // 库内 / 自定义目录
    readonly missing: boolean; // 目录缺失态（置灰 + 重新关联）
    readonly favorite: boolean;
    // 项目封面（舞台截图 dataURI）；无缩略图时缺省/ null → 列表显示占位封面
    readonly thumbnail?: string | null;
}

// 快照条目（新快照 = snapshots/<id>/{tesslo.json,project.json}；
// 旧版快照 = snapshots/<id>.tess）
export interface ProjectSnapshot {
    readonly id: string; // 快照标识
    readonly savedAt: string; // ISO 8601
}

// 快照内容：新旧两种载体
export type SnapshotContent =
    | {readonly kind: 'bundle'; readonly meta: ProjectMeta; readonly project: Record<string, unknown>}
    | {readonly kind: 'tess'; readonly bytes: ArrayBuffer};

// 新建项目选项（外部项目 = 用户选定的空目录，URI 由系统目录选择器授权）
export interface CreateProjectOptions {
    // 目录选择器返回的目录 URI；缺省 = 库内默认位置
    readonly customDirUri?: string;
}

// 删除选项：是否连项目目录一起删除
export interface DeleteProjectOptions {
    readonly deleteDir: boolean;
}

// 导入去重查询（任一命中即视为已存在）
export interface ProjectIdentityQuery {
    // 导入文件 tesslo.json 里的原始项目 ID
    readonly projectId?: string;
    // 项目内容指纹（formats.fingerprintProject）
    readonly fingerprint?: string;
}

// 素材读取（离线素材库，替代存量 WebStorageHelper 的直连语义）
export interface AssetStore {
    /**
     * 读取素材库素材。
     *
     * @param assetId - 素材 ID（md5）。
     * @param dataFormat - 数据格式（如 png / svg / wav）。
     * @returns 素材字节。
     */
    load(assetId: string, dataFormat: string): Promise<Uint8Array>;
}

// 作品库操作（目录工作区；容器编解码在 @tesslo/formats，仅导出时使用）
export interface ProjectStore {
    listProjects(): Promise<ProjectSummary[]>;
    createProject(name: string, options?: CreateProjectOptions): Promise<ProjectSummary>;
    /** 读取项目工作区（tesslo.json + project.json + assets/）。 */
    readProject(id: string): Promise<ProjectBundle>;
    /** 保存项目工作区（原子写；先转存旧版为快照）。 */
    saveProject(id: string, bundle: ProjectBundle): Promise<ProjectSummary>;
    deleteProject(id: string, options: DeleteProjectOptions): Promise<void>;
    renameProject(id: string, name: string): Promise<ProjectSummary>;
    /** 复制项目（新 ID；名称由调用方保证唯一性提示）。 */
    duplicateProject(id: string, newName: string): Promise<ProjectSummary>;
    listSnapshots(id: string): Promise<ProjectSnapshot[]>;
    /** 读取快照内容（新目录快照或旧 .tess 快照）。 */
    readSnapshot(id: string, snapshotId: string): Promise<SnapshotContent>;
    /** 重新关联项目目录（目录选择器）。 */
    relinkProject(id: string, dirUri: string): Promise<ProjectSummary>;
    setFavorite(id: string, favorite: boolean): Promise<ProjectSummary>;
    /** 导入去重：按原始项目 ID / 内容指纹查已存在项目。 */
    findExistingProject(query: ProjectIdentityQuery): Promise<ProjectSummary | null>;
    /** 读取旧版 .tess 工作文件（仅迁移用；目录化后不再有该文件）。 */
    readLegacyTess(id: string): Promise<ArrayBuffer>;
    /**
     * 在宿主侧组装并保存单文件 HTML（可选能力）。
     * harmony 实现直接读 rawfile 模板 + 工作区文件，避免大模板经页面传输；
     * 未实现时装配层回落到 `buildExportedHtml` 的页面内组装。
     */
    readonly exportHtmlProject?: (id: string) => Promise<void>;
}

// 平台适配器：产品层访问宿主能力的唯一出口（规范 §10.2）
export interface PlatformAdapter {
    readonly protocol: typeof ADAPTER_PROTOCOL;
    readonly projects: ProjectStore;
    readonly assets: AssetStore;

    /**
     * 选择项目目录（harmony：DocumentViewPicker 目录模式 + 持久授权）。
     *
     * @returns 目录 URI（file://docs/...）。
     */
    pickProjectDir(): Promise<string>;

    /**
     * 保存下载产物（导出 .tess / .sb3 / .html 落"下载"目录）。
     *
     * @param fileName - 已清洗的合法文件名（含扩展名）。
     * @param bytes - 文件字节。
     * @param mimeType - MIME 类型。
     */
    saveDownload(fileName: string, bytes: ArrayBuffer, mimeType: string): Promise<void>;
}

// 错误码重导出，方便实现侧与 UI 层统一 import
export type {PlatformErrorCode} from './errors.ts';
