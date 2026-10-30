import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import GUI, {AppStateHOC, defaultProjectId} from '@scratch/scratch-gui';

import AboutModal from './about-modal.jsx';
import WebStorageHelper from './storage';

import tessloLogo from './assets/tesslo-logo.png';

const appTarget = document.getElementById('app');
window.__TESSLO_ASSET_ORIGIN__ = 'http://127.0.0.1:20114';
GUI.setAppElement(appTarget);

const WrappedGUI = AppStateHOC(GUI);

const onStorageInit = storage => {
    // 本地素材 helper 必须排在官方 CDN web store 之前（priority=1），
    // 否则离线设备上每次素材请求都会先等待 CDN 超时才回退本地
    storage.addHelper(new WebStorageHelper(storage), 1);
};

const App = () => {
    const [aboutOpen, setAboutOpen] = useState(false);

    const onClickAbout = [
        {
            title: '关于 Tesslo',
            onClick: () => setAboutOpen(true)
        }
    ];

    return (
        <React.Fragment>
            <WrappedGUI
                canEditTitle={false}
                canModifyCloudData={false}
                canSave={false}
                logo={tessloLogo}
                platform="DESKTOP"
                projectId={defaultProjectId}
                isTelemetryEnabled={false}
                showTelemetryModal={false}
                onClickAbout={onClickAbout}
                onProjectTelemetryEvent={() => {}}
                onStorageInit={onStorageInit}
            />
            {aboutOpen ? (
                <AboutModal
                    logo={tessloLogo}
                    onRequestClose={() => setAboutOpen(false)}
                />
            ) : null}
        </React.Fragment>
    );
};

createRoot(appTarget).render(<App />);
