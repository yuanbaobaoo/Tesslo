import {ScratchStorage} from 'scratch-storage';

import defaultProject from './default-project';
import {GUIStorage, TranslatorFunction} from '../gui-config';

import saveProjectToServer from '../lib/save-project-to-server';

/**
 * 设备内素材服务 origin：由装配层注入 window.__TESSLO_ASSET_ORIGIN__
 * （见 apps/host/ohos/web/src/index.tsx），引擎不硬编码宿主地址。
 * 求值放在 web store 的 URL 函数里，注入晚于模块加载也能生效。
 *
 * @returns 去掉结尾斜杠的 origin；未注入时为空串（保持相对路径语义）。
 */
const localAssetOrigin = (): string => {
    const holder = globalThis as typeof globalThis & {__TESSLO_ASSET_ORIGIN__?: string};
    const origin = holder.__TESSLO_ASSET_ORIGIN__;
    return typeof origin === 'string' ? origin.replace(/\/+$/, '') : '';
};

export class LegacyStorage implements GUIStorage {
    private projectHost?: string;
    private translator?: TranslatorFunction;

    readonly scratchStorage = new ScratchStorage();

    constructor () {
        this.cacheDefaultProject(this.scratchStorage);
        this.addLocalWebStores(this.scratchStorage);
    }

    setProjectHost (host: string): void {
        this.projectHost = host;
    }

    // Tesslo runs fully offline: projects and assets are served by the on-device asset
    // server or bundled with the app, so the token/host below are never used to reach
    // the official Scratch web services.
    setProjectToken (_token: string): void {
        // no-op
    }

    setProjectMetadata (projectId: string | null | undefined): void {
        const {RequestMetadata, setMetadata, unsetMetadata} = this.scratchStorage.scratchFetch;

        // If project ID is '0' or zero, it's not a real project ID. In that case, remove the project ID metadata.
        // Same if it's null undefined.
        if (projectId && projectId !== '0') {
            setMetadata(RequestMetadata.ProjectId, projectId);
        } else {
            unsetMetadata(RequestMetadata.ProjectId);
        }
    }

    setAssetHost (_host: string): void {
        // no-op: assets are resolved by the on-device storage helpers, never a remote host
    }

    setTranslatorFunction (translator: TranslatorFunction): void {
        this.translator = translator;

        this.cacheDefaultProject(this.scratchStorage);
    }

    saveProject (
        projectId: number,
        vmState: string,
        params: {originalId: string; isCopy: boolean; isRemix: boolean; title: string;}
    ): Promise<{id: string | number;}> {
        const host = this.projectHost;

        if (!host) {
            return Promise.reject(new Error('Project host not set'));
        }
        // Haven't inlined the code here so that we can keep Git history on the implementation, just in case
        return saveProjectToServer(host, projectId, vmState, params);
    }

    private cacheDefaultProject (storage: ScratchStorage) {
        const defaultProjectAssets = defaultProject(this.translator);
        defaultProjectAssets.forEach(asset => storage.builtinHelper._store(
            storage.AssetType[asset.assetType],
            storage.DataFormat[asset.dataFormat],
            asset.data,
            asset.id
        ));
    }

    private addLocalWebStores (storage: ScratchStorage) {
        storage.addWebStore(
            [storage.AssetType.Sound],
            asset => `static/extension-assets/scratch3_music/${asset.assetId}.${asset.dataFormat}`
        );
        // 库缩略图（角色/造型/背景）经 ScratchImage → 本实例 load() 取图：
        // 这些素材不在工程目录里，由设备内 AssetServer 以 /static/fetched/ 提供。
        // 必须走 http origin——resource:// 下 fetch/XHR 不可用，<img> 才勉强可读。
        storage.addWebStore(
            [storage.AssetType.ImageVector, storage.AssetType.ImageBitmap],
            asset => `${localAssetOrigin()}/static/fetched/${asset.assetId}.${asset.dataFormat}`
        );
    }
}
