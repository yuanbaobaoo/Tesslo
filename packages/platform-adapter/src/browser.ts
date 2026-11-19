// browser 实现：桌面浏览器开发与 E2E 测试用（无宿主）。
// 作品库落 IndexedDB；素材库不可用（E_IO）；picker 不支持（E_UNSUPPORTED）。
// v5：直接存 ProjectBundle（结构化克隆支持对象与 ArrayBuffer），语义与宿主目录一致。
import {ADAPTER_PROTOCOL, type AssetStore, type PlatformAdapter, type ProjectBundle,
    type ProjectStore, type ProjectSummary, type SnapshotContent} from './types.ts';
import {platformError} from './errors.ts';

// IndexedDB 库名 / 仓库名
const DB_NAME = 'tesslo-works';
const STORE_PROJECTS = 'projects';

// 单条库记录（IndexedDB 存储形状）
interface ProjectRecord {
    id: string;
    name: string;
    updatedAt: string;
    location: 'sandbox' | 'external';
    favorite: boolean;
    fingerprint?: string;
    bundle?: ProjectBundle; // 新建未保存时缺省
}

// 快照记录（轻量：meta + project，不含素材；素材只增不减）
interface SnapshotRecord {
    snapshotId: string;
    savedAt: string;
    meta: ProjectBundle['meta'];
    project: ProjectBundle['project'];
}

interface ProjectRecordWithSnapshots extends ProjectRecord {
    snapshots: SnapshotRecord[];
}

/**
 * 打开（或创建）IndexedDB。
 *
 * @returns 就绪的 IDBDatabase。
 */
const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore(STORE_PROJECTS, {keyPath: 'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(platformError('E_IO', 'IndexedDB open failed'));
});

/**
 * 事务包装：把 IDB 请求转成 Promise。
 *
 * @param db - 数据库句柄。
 * @param store - 仓库名。
 * @param mode - 事务模式。
 * @param run - 在事务上执行的操作，返回 IDBRequest。
 * @returns 请求 result。
 */
const withStore = <T>(
    db: IDBDatabase,
    store: string,
    mode: IDBTransactionMode,
    run: (objectStore: IDBObjectStore) => IDBRequest
): Promise<T> => new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(platformError('E_IO', `IndexedDB ${store} op failed`));
});

const toSummary = (record: ProjectRecord): ProjectSummary => ({
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
    location: record.location,
    favorite: record.favorite,
    missing: false,
    thumbnail: record.bundle?.meta.thumbnail ?? null
});

// 深拷贝 bundle（避免 IndexedDB 记录之间共享 ArrayBuffer）
const cloneBundle = (bundle: ProjectBundle): ProjectBundle => ({
    meta: {...bundle.meta},
    project: JSON.parse(JSON.stringify(bundle.project)) as Record<string, unknown>,
    assets: bundle.assets.map(asset => ({md5ext: asset.md5ext, bytes: asset.bytes.slice(0)}))
});

/**
 * 创建 browser 平台的 ProjectStore（IndexedDB）。
 *
 * @returns 本地实现。
 */
const createProjectStore = (): ProjectStore => {
    const dbPromise = openDb();

    const getRecord = async (id: string): Promise<ProjectRecordWithSnapshots | undefined> => {
        const db = await dbPromise;
        return withStore<ProjectRecordWithSnapshots | undefined>(
            db, STORE_PROJECTS, 'readonly', objectStore => objectStore.get(id));
    };

    const requireRecord = async (id: string): Promise<ProjectRecordWithSnapshots> => {
        const record = await getRecord(id);
        if (!record) {
            throw platformError('E_DIR_MISSING', `project ${id} not found`);
        }
        return record;
    };

    return {
        listProjects: async () => {
            const db = await dbPromise;
            const records = await withStore<ProjectRecord[]>(db, STORE_PROJECTS, 'readonly',
                objectStore => objectStore.getAll());
            return records.map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        },

        createProject: async (name, options) => {
            if (options?.customDirUri) {
                throw platformError('E_UNSUPPORTED', 'browser 平台不支持自定义目录');
            }
            const db = await dbPromise;
            const record: ProjectRecord = {
                id: (crypto.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`),
                name,
                updatedAt: new Date().toISOString(),
                location: 'sandbox',
                favorite: false
            };
            await withStore(db, STORE_PROJECTS, 'readwrite', objectStore => objectStore.put(record));
            return toSummary(record);
        },

        readProject: async id => {
            const record = await requireRecord(id);
            if (!record.bundle) {
                throw platformError('E_DIR_MISSING', `project ${id} has no saved workspace`);
            }
            return cloneBundle(record.bundle);
        },

        saveProject: async (id, bundle) => {
            const record = await requireRecord(id);
            // 先转存旧版为快照（与宿主 ProjectServer 语义一致）
            if (record.bundle) {
                record.snapshots = [
                    {
                        snapshotId: `snap-${Date.now()}`,
                        savedAt: record.updatedAt,
                        meta: record.bundle.meta,
                        project: record.bundle.project
                    },
                    ...(record.snapshots ?? [])
                ].slice(0, 10);
            }
            record.bundle = cloneBundle(bundle);
            record.fingerprint = bundle.meta.fingerprint;
            record.updatedAt = new Date().toISOString();
            const db = await dbPromise;
            await withStore(db, STORE_PROJECTS, 'readwrite', objectStore => objectStore.put(record));
            return toSummary(record);
        },

        deleteProject: async (id, _options) => {
            const db = await dbPromise;
            await withStore(db, STORE_PROJECTS, 'readwrite', objectStore => objectStore.delete(id));
        },

        renameProject: async (id, name) => {
            const record = await requireRecord(id);
            record.name = name;
            if (record.bundle) {
                record.bundle = {...record.bundle, meta: {...record.bundle.meta, name}};
            }
            const db = await dbPromise;
            await withStore(db, STORE_PROJECTS, 'readwrite', objectStore => objectStore.put(record));
            return toSummary(record);
        },

        duplicateProject: async (id, newName) => {
            const record = await requireRecord(id);
            const copy: ProjectRecord = {
                id: crypto.randomUUID?.() ?? `p-${Date.now()}`,
                name: newName,
                updatedAt: new Date().toISOString(),
                location: record.location,
                favorite: false
            };
            if (record.bundle) {
                copy.fingerprint = record.bundle.meta.fingerprint;
                const cloned = cloneBundle(record.bundle);
                copy.bundle = {
                    ...cloned,
                    meta: {...cloned.meta, projectId: copy.id, name: newName}
                };
            }
            const db = await dbPromise;
            await withStore(db, STORE_PROJECTS, 'readwrite', objectStore => objectStore.put(copy));
            return toSummary(copy);
        },

        listSnapshots: async id => {
            const record = await requireRecord(id);
            return (record.snapshots ?? []).map(snapshot => ({
                id: snapshot.snapshotId,
                savedAt: snapshot.savedAt
            }));
        },

        readSnapshot: async (id, snapshotId): Promise<SnapshotContent> => {
            const record = await requireRecord(id);
            const snapshot = (record.snapshots ?? []).find(item => item.snapshotId === snapshotId);
            if (!snapshot) {
                throw platformError('E_DIR_MISSING', `snapshot ${snapshotId} not found`);
            }
            return {kind: 'bundle', meta: snapshot.meta, project: snapshot.project};
        },

        relinkProject: async () => {
            throw platformError('E_UNSUPPORTED', 'browser 平台无外部目录概念');
        },

        setFavorite: async (id, favorite) => {
            const record = await requireRecord(id);
            record.favorite = favorite;
            const db = await dbPromise;
            await withStore(db, STORE_PROJECTS, 'readwrite', objectStore => objectStore.put(record));
            return toSummary(record);
        },

        findExistingProject: async query => {
            const db = await dbPromise;
            const records = await withStore<ProjectRecord[]>(db, STORE_PROJECTS, 'readonly',
                objectStore => objectStore.getAll());
            for (const record of records) {
                const idMatch = query.projectId !== undefined && record.id === query.projectId;
                const fingerprintMatch = query.fingerprint !== undefined &&
                    record.fingerprint === query.fingerprint;
                if (idMatch || fingerprintMatch) {
                    return toSummary(record);
                }
            }
            return null;
        },

        readLegacyTess: async () => {
            throw platformError('E_UNSUPPORTED', 'browser 平台无旧版 .tess 工作文件');
        }
    };
};

/**
 * browser 平台的 AssetStore：无宿主素材服务，明确不支持。
 */
const createAssetStore = (): AssetStore => ({
    load: () => Promise.reject(platformError('E_UNSUPPORTED', 'browser 平台无离线素材服务'))
});

/**
 * browser 平台完整 adapter（开发 / E2E 用）。
 */
export const browserAdapter: PlatformAdapter = {
    protocol: ADAPTER_PROTOCOL,
    projects: createProjectStore(),
    assets: createAssetStore(),

    pickProjectDir: () => Promise.reject(
        platformError('E_UNSUPPORTED', 'browser 平台不支持目录选择')
    ),

    saveDownload: async (fileName, bytes, mimeType) => {
        // 标准锚点下载：桌面浏览器行为
        const blob = new Blob([bytes], {type: mimeType});
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
    }
};
