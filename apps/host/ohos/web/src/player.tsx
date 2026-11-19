// 播放端入口（导出的单文件 HTML 内运行，零网络）：
// 解析内嵌项目数据 → ExportedAssetHelper → AppStateHOC 挂载 gui 的 player 出口
// （最小播放器：舞台+监视器，不含编辑器；语言裁剪 zh-cn+en，dist ~10MB）。
import React from 'react';
import {createRoot} from 'react-dom/client';
import {setAppElement} from 'react-modal';
// 必须先于 gui dist 执行（其 runtime 初始化依赖 currentScript，见 shim 头注）
import './player-public-path-shim';
import {Provider} from 'react-redux';
import Player, {createPlayerStore} from '@scratch/scratch-gui/player';
import {ScratchStorage} from 'scratch-storage';
import {ExportedAssetHelper, PLAYER_DATA_ELEMENT_ID,
    type EmbeddedProjectData} from '@tesslo/app/player';
import './player.css';

const appTarget: HTMLElement | null = document.getElementById('app');

/**
 * 解析内嵌项目数据（<script type="application/json" id="tesslo-player-data">）。
 *
 * @returns 数据缺失/非法时返回 null。
 */
const readEmbeddedData = (): EmbeddedProjectData | null => {
    const element: HTMLElement | null = document.getElementById(PLAYER_DATA_ELEMENT_ID);
    if (element === null || element.textContent === null) {
        return null;
    }
    try {
        return JSON.parse(element.textContent) as EmbeddedProjectData;
    } catch {
        return null;
    }
};

if (appTarget !== null) {
    setAppElement(appTarget);
    const data: EmbeddedProjectData | null = readEmbeddedData();
    if (data === null) {
        appTarget.textContent = '作品数据缺失或损坏';
    } else {
        // 内嵌数据 storage：Project 与素材全走 ExportedAssetHelper
        const scratchStorage = new ScratchStorage();
        scratchStorage.addHelper(new ExportedAssetHelper(scratchStorage, data), 1);
        const store = createPlayerStore({storage: {scratchStorage}}, 'zh-cn');
        createRoot(appTarget).render(
            <Provider store={store}>
                <Player
                    isPlayerOnly
                    isFullScreen
                    fontsLoaded
                    projectId={data.meta.projectId}
                    onSetLanguage={() => {}}
                    onProjectTelemetryEvent={() => {}}
                />
            </Provider>
        );
    }
}
