import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import GUI, {AppStateHOC, defaultProjectId} from '@scratch/scratch-gui';

import AboutModal from './about-modal.jsx';
import WebStorageHelper from './storage';

import tessloLogo from './assets/tesslo-logo.png';

// webpack 打包单页的挂载点
const appTarget = document.getElementById('app');
GUI.setAppElement(appTarget);

// AppStateHOC 包装：接入 GUI 的全局状态与弹窗调度
const WrappedGUI = AppStateHOC(GUI);

// GUI 初始化存储时注入离线素材 Helper
const onStorageInit = storage => {
  // 离线素材唯一入口：全部素材从设备内 AssetServer（rawfile）读取；
  // 官方 CDN web store 已在 legacy-storage 中移除，不再有网络回退
  storage.addHelper(new WebStorageHelper(storage), 1);
};

/**
 * 根组件：全屏 scratch-gui 编辑器 + 可选的“关于”弹窗。
 */
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
