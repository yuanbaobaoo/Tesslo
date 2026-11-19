// Tesslo 主入口（P1）：首屏作品列表（packages/app Shell）+ standalone 自持编辑器。
// legacy 直进编辑器的旧入口保留于 index.jsx，经构建开关回落（TESSLO_LEGACY=1，
// 见 webpack.config.js）——P1 首周 spike 若 standalone 在 ArkWeb 不过关时启用。
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
// setAppElement 走主出口（standalone 出口内嵌整套 react，混入会造成双实例）
import {setAppElement} from '@scratch/scratch-gui';
import {selectAdapter} from '@tesslo/platform-adapter';
import {AboutModal, AlertDialog, presentError, TessloShell} from '@tesslo/app';
import type {ProjectSummary} from '@tesslo/platform-adapter';
import {exportProject} from './exporter';
import tessloLogo from './assets/tesslo-logo.png';

// webpack 打包单页的挂载点；引擎弹窗也锚定于此
const appTarget = document.getElementById('app');
setAppElement(appTarget);

// 平台适配器单例（harmony = ArkWeb 宿主内）
const adapter = selectAdapter();

/**
 * 根组件：Launcher / 编辑器外壳 + 可选的“关于”弹窗。
 * 导出失败按错误码提示（P1：保存失败最常见是用户取消系统保存选择器）。
 */
const App = (): React.JSX.Element => {
    const [aboutOpen, setAboutOpen] = useState(false);
    const [exportAlert, setExportAlert] = useState<{title: string; message: string} | null>(null);
    return (
        <React.Fragment>
            <TessloShell
                adapter={adapter}
                locale="zh-cn"
                logo={tessloLogo}
                version={__TESSLO_VERSION__}
                onOpenAbout={() => setAboutOpen(true)}
                onExportProject={async (project: ProjectSummary, format) => {
                    try {
                        await exportProject(adapter, project, format);
                        return true;
                    } catch (cause) {
                        const presented = presentError(cause);
                        if (presented.text.length > 0) {
                            setExportAlert({title: presented.title, message: presented.text});
                        }
                        return false;
                    }
                }}
            />
            {exportAlert ? (
                <AlertDialog
                    title={exportAlert.title}
                    message={exportAlert.message}
                    onClose={() => setExportAlert(null)}
                />
            ) : null}
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
