import {ScratchStorage} from 'scratch-storage';

import defaultProject from './default-project';
import {GUIStorage, TranslatorFunction, VirtualMachine, GUICloudVariableProvider} from '../gui-config';
import {LegacyBackpackStorage} from './legacy-backpack-storage';
import CloudProvider from './cloud-provider';

import saveProjectToServer from '../lib/save-project-to-server';

export class LegacyStorage implements GUIStorage {
    private projectHost?: string;
    private translator?: TranslatorFunction;

    readonly scratchStorage = new ScratchStorage();
    readonly backpackStorage = new LegacyBackpackStorage({
        readAuth (session) {
            if (!session) {
                return Promise.reject(new Error('missing session'));
            }

            return Promise.resolve({
                username: session.username,
                authType: 'x-token',
                authToken: session.token
            });
        }
    });
    readonly cloudVariables = {
        createProvider (
            cloudHost: string,
            vm: VirtualMachine,
            username: string,
            projectId: string
        ): GUICloudVariableProvider {
            return new CloudProvider(cloudHost, vm, username, projectId);
        }
    };

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

    setBackpackHost (host: string): void {
        this.backpackStorage.setHostAndRegisterWebStore(host, this.scratchStorage);
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
    }
}
