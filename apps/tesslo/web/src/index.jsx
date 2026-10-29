import React from 'react';
import {createRoot} from 'react-dom/client';
import GUI, {AppStateHOC, defaultProjectId} from '@scratch/scratch-gui';

import WebStorageHelper from './storage';

const appTarget = document.getElementById('app');
window.__TESSLO_ASSET_ORIGIN__ = 'http://127.0.0.1:20114';
GUI.setAppElement(appTarget);

const WrappedGUI = AppStateHOC(GUI);

const onStorageInit = storage => {
    storage.addHelper(new WebStorageHelper(storage));
};

const onClickAbout = [
    {
        title: '关于 Tesslo',
        onClick: () => window.alert('Tesslo 0.1.0\nScratch 兼容编辑器，运行在 HarmonyOS ArkWeb 中。')
    },
    {
        title: '隐私政策',
        onClick: () => window.alert('Tesslo 不收集遥测数据。项目和素材只在本机处理。')
    }
];

createRoot(appTarget).render(
    <WrappedGUI
        canEditTitle
        canModifyCloudData={false}
        canSave={false}
        platform="DESKTOP"
        projectId={defaultProjectId}
        isTelemetryEnabled={false}
        showTelemetryModal={false}
        onClickAbout={onClickAbout}
        onProjectTelemetryEvent={() => {}}
        onStorageInit={onStorageInit}
    />
);
