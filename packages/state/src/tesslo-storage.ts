// TessloStorage：GUIStorage 的产品层实现（D5：经官方保存后端接口接管，
// 不迁就引擎 chrome）。项目 JSON 与素材全部经 platform-adapter 走作品库，
// 引擎 gui 内部零改动。
// 依赖全部来自 'scratch-storage' 包与主出口（不触碰 standalone 出口——
// 其内嵌整套 react/react-dom，混入主 bundle 会造成双实例与 internals 断线，
// 真机实测 2026-11-18）。
// 默认项目回落：ScratchStorage 自带 BuiltinHelper（默认项目 id '0' 与默认素材），
// 本 Helper 对"库里没有"的请求返回 null，让 helper 链自然落过去。
import {Asset, Helper, ScratchStorage} from 'scratch-storage';
import type {AssetId, AssetType, DataFormat} from 'scratch-storage';

// scratch-storage 未导出的 AssetData 类型（本地等价定义）
type AssetData = string | Uint8Array;
import {buildDefaultProject} from '@scratch/scratch-gui';
import {createTessloMeta, fingerprintProject, readTess, validateTessloMeta,
    type TessloMeta} from '@tesslo/formats';
import type {PlatformAdapter, ProjectAsset, ProjectBundle} from '@tesslo/platform-adapter';
import {asPlatformError} from '@tesslo/platform-adapter';

// 翻译函数类型（引擎 gui-config 契约的本地等价：MessageObject 含 description）
type TranslatorFunction = (msgObj: {
    id: string;
    description: string;
    defaultMessage: string;
}) => string;

// GUIStorage 的结构等价声明（主出口未导出该类型；与 gui-config.ts 契约一致）
export interface GUIStorageLike {
    readonly scratchStorage: ScratchStorage;
    saveProject(
        projectId: string | number | null | undefined,
        vmState: string,
        params: {title?: string}
    ): Promise<{id: string | number}>;
    setTranslatorFunction?(translator: (msgObj: unknown) => string): void;
}

// 引擎 VM 的最小结构句柄（引擎类型不外泄到产品层，规范 §2.2）
export interface VmAsset {
    readonly assetId: string;
    readonly dataFormat: string;
    readonly data: Uint8Array;
    readonly clean?: boolean;
}
// 渲染器的最小截图接口（舞台封面）
export interface VmRenderer {
    requestSnapshot(callback: (dataUri: string) => void): void;
    draw(): void;
}
export interface VmHandle {
    readonly assets: VmAsset[];
    readonly renderer?: VmRenderer;
}

// md5ext 成员键（小写扩展名与 vm 序列化一致）
const assetKey = (assetId: string, dataFormat: string): string =>
    `${assetId}.${dataFormat.toLowerCase()}`;

// 字符串素材编码（store 契约允许 string data，如 SVG 文本）
const encodeIfText = (data: AssetData): Uint8Array =>
    typeof data === 'string' ? new TextEncoder().encode(data) : data;

// Helper 与 Storage 的共享上下文（避免跨类访问 private 成员）
interface StorageContext {
    readonly adapter: PlatformAdapter;
    // 当前项目素材缓存（md5ext → 字节）：.tess 载入 + 脏素材 store 写入
    readonly projectAssets: Map<string, Uint8Array>;
    // 项目 JSON 装载（.tess → 缓存；无 .tess 返回 null 落 BuiltinHelper 默认项目）
    loadProjectJson(requestedId: string): Promise<string | null>;
}

/**
 * 作品库 Helper：scratch-storage 的一级数据源（优先级 1）。
 * load：项目 JSON 从 .tess 取；素材先查当前项目缓存，再回落离线素材库；
 *       库里没有一律返回 null（Helper 契约），让 BuiltinHelper 接默认项目/素材。
 * store：脏素材并入缓存（随下次 saveProject 写入 .tess），回 ok 让引擎标 clean。
 */
class LibraryHelper extends Helper {
    private readonly context: StorageContext;

    constructor (parent: ScratchStorage, context: StorageContext) {
        super(parent);
        this.context = context;
    }

    /**
     * Helper.load 契约（null = 交给下一优先级 helper）。
     *
     * @param assetType - 素材类型（Project / ImageVector / Sound …）。
     * @param assetId - 项目 ID 或素材 md5。
     * @param dataFormat - 数据格式（json / svg / wav …）。
     * @returns 包装后的 storage.Asset；库里没有时 null。
     */
    override load (
        assetType: AssetType,
        assetId: AssetId,
        dataFormat: DataFormat
    ): Promise<Asset | null> {
        if (assetType === this.parent.AssetType.Project) {
            const requestedId: string = String(assetId);
            // '0' 或新工程（无 .tess）→ 直接问 builtinHelper（预填的默认项目）；
            // 不能经 parent.load 回落——那会重入本 helper 形成无限递归（真机实测）
            const loadJson: Promise<string | null> = requestedId === '0'
                ? Promise.resolve(null)
                : this.context.loadProjectJson(requestedId);
            return loadJson.then(json => {
                if (json !== null) {
                    return new Asset(assetType, assetId, dataFormat, json);
                }
                return Promise.resolve(
                    this.parent.builtinHelper.load(assetType, '0'));
            });
        }
        const key: string = assetKey(String(assetId), dataFormat);
        const cached = this.context.projectAssets.get(key);
        if (cached) {
            return Promise.resolve(new Asset(assetType, assetId, dataFormat, cached));
        }
        // 回落：素材库（rawfile 离线素材）后写入缓存；没有则 null（BuiltinHelper）
        return this.context.adapter.assets.load(String(assetId), dataFormat)
            .then(bytes => {
                this.context.projectAssets.set(key, bytes);
                return new Asset(assetType, assetId, dataFormat, bytes);
            })
            .catch(() => null);
    }

    /**
     * Helper.store 契约（project-saver 脏素材上传）。
     *
     * @param assetType - 素材类型。
     * @param dataFormat - 数据格式。
     * @param data - 素材字节或文本。
     * @param assetId - 素材 ID。
     * @returns 引擎期待的 {status:'ok'} 应答。
     */
    store (
        assetType: AssetType,
        dataFormat: DataFormat | undefined,
        data: AssetData,
        assetId: AssetId
    ): Promise<{status: string}> {
        const format: string = dataFormat ?? 'dat';
        this.context.projectAssets.set(assetKey(String(assetId), format), encodeIfText(data));
        return Promise.resolve({status: 'ok'});
    }
}

// TessloStorage 构造参数
export interface TessloStorageParams {
    readonly adapter: PlatformAdapter;
    readonly projectId: string;
    readonly projectName: string;
    // 项目元数据起始值（打开已有项目时由调用方从 .tess 读出）
    readonly initialMeta?: TessloMeta;
}

/**
 * 作品保存后端：saveProject 组装 .tess（tesslo.json + 纯净 project.json + 全素材）。
 * 新建工程首次加载落到 ScratchStorage 内置默认项目（BuiltinHelper）。
 */
export class TessloStorage implements GUIStorageLike {
    readonly scratchStorage: ScratchStorage;

    private readonly adapter: PlatformAdapter;
    private readonly projectId: string;
    private meta: TessloMeta;
    private readonly projectAssets: Map<string, Uint8Array>;
    private vm: VmHandle | null;
    private translator: TranslatorFunction | undefined;

    constructor (params: TessloStorageParams) {
        this.adapter = params.adapter;
        this.projectId = params.projectId;
        this.meta = params.initialMeta ?? createTessloMeta(params.projectName, params.projectId);
        this.projectAssets = new Map();
        this.vm = null;

        const context: StorageContext = {
            adapter: this.adapter,
            projectAssets: this.projectAssets,
            loadProjectJson: _requestedId => this.loadProjectJson(_requestedId)
        };
        this.scratchStorage = new ScratchStorage();
        this.scratchStorage.addHelper(new LibraryHelper(this.scratchStorage, context), 1);
        this.cacheDefaultProject();
    }

    /**
     * 默认项目预填 builtinHelper（LegacyStorage 同款机制）：
     * 项目 '0' JSON + 内置素材经 _store 注册，新工程回落时由 helper 链命中。
     *
     * @param translator 可选翻译函数（本地化默认文案）。
     */
    private cacheDefaultProject (translator?: TranslatorFunction): void {
        try {
            this.cacheDefaultProjectInner(translator);
        } catch (error) {
            console.error('[tesslo-storage] cacheDefaultProject failed:', error);
        }
    }

    private cacheDefaultProjectInner (translator?: TranslatorFunction): void {
        const storage = this.scratchStorage;
        // buildDefaultProject 的 assetType/dataFormat 是字符串（引擎 d.ts 放宽），
        // 此处按 AssetType/DataFormat 的键断言（默认项目成员恒为合法键）
        const assetTypes = storage.AssetType as unknown as Record<string, AssetType>;
        const dataFormats = storage.DataFormat as unknown as Record<string, DataFormat>;
        for (const asset of buildDefaultProject(translator)) {
            // 默认项目成员的 assetType/dataFormat 恒为合法键（引擎内置数据）
            storage.builtinHelper._store(
                assetTypes[asset.assetType]!,
                dataFormats[asset.dataFormat]!,
                asset.data,
                asset.id
            );
        }
    }

    /**
     * 注入 VM 句柄（GUI onVmInit 回调转发；保存时收集素材全集）。
     *
     * @param vm - 引擎 VM。
     */
    attachVm (vm: VmHandle): void {
        this.vm = vm;
    }

    /**
     * GUIStorage 可选钩子：翻译函数（默认项目文案本地化由 BuiltinHelper 处理，
     * 此钩子保留契约形状）。
     *
     * @param _translator - react-intl formatMessage 包装（未使用）。
     */
    setTranslatorFunction (translator: TranslatorFunction): void {
        this.translator = translator;
        // 默认项目文案本地化（重建缓存）
        this.cacheDefaultProject(translator);
    }

    /**
     * GUIStorage.saveProject：vmState（vm.toJSON()）+ vm.assets 全集 →
     * 目录工作区 bundle（tesslo.json + project.json + assets）。
     *
     * @param projectId - 引擎侧项目 ID（应等于会话项目 ID）。
     * @param vmState - 序列化的纯净 Scratch 项目 JSON 字符串。
     * @param params - 保存参数（title 用于更新元数据名称）。
     * @returns {id}（引擎期待形状）。
     */
    async saveProject (
        projectId: string | number | null | undefined,
        vmState: string,
        params: {title?: string}
    ): Promise<{id: string | number}> {
        const assets = new Map<string, Uint8Array>(this.projectAssets);
        if (this.vm) {
            for (const asset of this.vm.assets) {
                if (asset.data) {
                    assets.set(assetKey(asset.assetId, asset.dataFormat), asset.data);
                }
            }
        }
        this.meta = {
            ...this.meta,
            name: params.title && params.title.length > 0 ? params.title : this.meta.name
        };
        // 封面：保存前截取舞台（失败不影响保存，沿用已有缩略图）
        const thumbnail: string | null = await this.captureThumbnail();
        if (thumbnail !== null) {
            this.meta = {...this.meta, thumbnail};
        }
        const project: Record<string, unknown> = JSON.parse(vmState) as Record<string, unknown>;
        await this.saveBundle(project, assetsToProjectAssets(assets));
        return {id: projectId ?? this.projectId};
    }

    /**
     * 截取舞台作为项目封面：requestSnapshot → 缩放到 320×240 JPEG。
     * 渲染器不可用/超时/失败时返回 null（保存继续）。
     *
     * @returns dataURI 或 null。
     */
    private async captureThumbnail (): Promise<string | null> {
        const renderer = this.vm?.renderer;
        if (renderer === undefined) {
            return null;
        }
        const dataUri: string | null = await new Promise<string | null>(resolve => {
            let settled = false;
            const finish = (value: string | null): void => {
                if (settled) {
                    return;
                }
                settled = true;
                window.clearTimeout(timer);
                resolve(value);
            };
            const timer = window.setTimeout(() => finish(null), 1200);
            try {
                renderer.requestSnapshot((snapshotUri: string) => {
                    finish(typeof snapshotUri === 'string' && snapshotUri.startsWith('data:image/')
                        ? snapshotUri
                        : null);
                });
                renderer.draw();
            } catch {
                finish(null);
            }
        });
        if (dataUri === null) {
            return null;
        }
        return resizeThumbnail(dataUri);
    }

    /**
     * 保存 bundle：更新 updatedAt + 内容指纹后交给 adapter 落目录。
     *
     * @param project - 纯净项目 JSON。
     * @param assets - 素材列表。
     */
    private async saveBundle (project: Record<string, unknown>, assets: ProjectAsset[]): Promise<void> {
        this.meta = {
            ...this.meta,
            projectId: this.projectId,
            updatedAt: new Date().toISOString(),
            fingerprint: fingerprintProject(project)
        };
        const bundle: ProjectBundle = {meta: this.meta, project, assets};
        await this.adapter.projects.saveProject(this.projectId, bundle);
    }

    /**
     * 读项目 JSON：目录工作区 → 项目 JSON；旧 .tess 自动迁移；
     * 新建工程（无工作区）返回 null（helper 链回落内置默认项目）。
     *
     * @param requestedId - 引擎请求的项目 ID。
     * @returns 项目 JSON 字符串或 null。
     */
    async loadProjectJson (_requestedId: string): Promise<string | null> {
        try {
            const bundle = await this.adapter.projects.readProject(this.projectId);
            return this.applyBundle(bundle);
        } catch (cause) {
            const platformError = asPlatformError(cause);
            if (platformError !== null && platformError.code === 'E_LEGACY') {
                return this.migrateLegacyProject();
            }
            if (platformError !== null && platformError.code === 'E_DIR_MISSING') {
                return null; // 新建工程尚无工作区 → BuiltinHelper 默认项目
            }
            throw cause;
        }
    }

    /**
     * 旧版单 .tess 工作文件 → 目录工作区（首次打开自动迁移）。
     *
     * @returns 迁移后的项目 JSON 字符串。
     */
    private async migrateLegacyProject (): Promise<string> {
        const legacyBytes: ArrayBuffer = await this.adapter.projects.readLegacyTess(this.projectId);
        const container = await readTess(legacyBytes);
        // 名称与身份以注册表为准（旧文件内可能是重命名前的旧名）
        this.meta = {...container.meta, name: this.meta.name, projectId: this.projectId};
        this.projectAssets.clear();
        const assets: ProjectAsset[] = [];
        for (const [md5ext, bytes] of container.assets) {
            this.projectAssets.set(md5ext, bytes);
            assets.push({md5ext, bytes: bytes.slice().buffer as ArrayBuffer});
        }
        const project = container.project as Record<string, unknown>;
        await this.saveBundle(project, assets);
        return JSON.stringify(project);
    }

    /**
     * 应用宿主返回的工作区：校验元数据、缓存素材、返回项目 JSON 字符串。
     *
     * @param bundle - 工作区内容。
     * @returns 项目 JSON 字符串。
     */
    private applyBundle (bundle: ProjectBundle): string {
        const parsed = validateTessloMeta(bundle.meta);
        this.meta = {...parsed, name: this.meta.name, projectId: this.projectId};
        this.projectAssets.clear();
        for (const asset of bundle.assets) {
            this.projectAssets.set(asset.md5ext, new Uint8Array(asset.bytes));
        }
        return JSON.stringify(bundle.project);
    }
}

/**
 * 素材缓存 → adapter 素材数组（ArrayBuffer 精确切片）。
 *
 * @param assets - md5ext → 字节。
 * @returns 可直接传输的素材列表。
 */
const assetsToProjectAssets = (assets: ReadonlyMap<string, Uint8Array>): ProjectAsset[] => {
    const list: ProjectAsset[] = [];
    for (const [md5ext, bytes] of assets) {
        list.push({md5ext, bytes: bytes.slice().buffer as ArrayBuffer});
    }
    return list;
};

/**
 * 舞台截图缩放为 320×240 JPEG（封面体积可控；白底避免透明变黑）。
 *
 * @param dataUri - 渲染器返回的 dataURI。
 * @returns 缩放后的 dataURI；失败时回退原图或 null。
 */
const resizeThumbnail = (dataUri: string): Promise<string | null> => new Promise(resolve => {
    try {
        const image = new Image();
        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 320;
                canvas.height = 240;
                const context = canvas.getContext('2d');
                if (context === null) {
                    resolve(dataUri);
                    return;
                }
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.78));
            } catch {
                resolve(dataUri);
            }
        };
        image.onerror = () => resolve(null);
        image.src = dataUri;
    } catch {
        resolve(null);
    }
});
