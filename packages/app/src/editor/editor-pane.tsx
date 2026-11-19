// Tesslo 工作台编辑器宿主：Tesslo 自绘导航条（WorkbenchNav）+ 仅复用 Scratch 工作区。
// 状态自持：EditorState 由本面板创建（Provider 包住导航条与 GUI，导航可在 Provider 内
// dispatch 设置/语言）。保存状态由导航条内部管理（避免外层 re-render 与内层 root 脱节）。
// D2：每次进入新建会话，返回时先保存后卸载重建。
// 不用 standalone 出口的原因（真机实测 2026-11-18）：standalone UMD 内嵌另一份
// react/react-dom，与主 bundle 形成双实例（hooks dispatcher null）。
import React, {useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Provider} from 'react-redux';
import GUI, {EditorState, setAppElement} from '@scratch/scratch-gui';
import {TessloStorage} from '@tesslo/state';
import type {VmHandle} from '@tesslo/state';
import type {PlatformAdapter, ProjectSummary} from '@tesslo/platform-adapter';
import {WorkbenchNav} from './workbench-nav.tsx';
import {ExportDialog} from '../launcher/export-dialog.tsx';
import type {ExportFormatChoice} from '../launcher/export-dialog.tsx';
import {presentError} from '../error-text.ts';
import type {ErrorPresentation} from '../error-text.ts';
import {Toast} from '../ui/toast.tsx';
import AboutModal from '../ui/about-modal.tsx';
import './editor-pane.css';

// 编辑器面板参数
export interface EditorPaneProps {
    readonly project: ProjectSummary;
    readonly adapter: PlatformAdapter;
    readonly locale: string;
    readonly logo?: string;
    readonly onExit: () => void;
    // 导出钩子（Shell 注入，与列表页同款三格式对话框）；
    // true = 已导出，false = 取消/失败（失败时装配层已弹提示）
    readonly onExportProject?: (
        project: ProjectSummary,
        format: ExportFormatChoice
    ) => Promise<boolean> | void;
}

// VM 的最小保存接口（vm.toJSON 与 vm.assets 由 onVmInit 注入的真实 VM 提供）
interface SaveableVm extends VmHandle {
    toJSON(): string;
}

/**
 * 单个项目的工作台：Tesslo 导航条 + Scratch 工作区（积木/舞台/画板）。
 * 卸载即销毁会话（D2）。
 *
 * @param props - 项目、适配器、语言与退出回调。
 * @returns 工作台 JSX。
 */
export const EditorPane = ({project, adapter, locale, logo, onExit,
    onExportProject}: EditorPaneProps): React.JSX.Element => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    // 退出回调与 VM/存储句柄保持最新引用供挂载闭包使用
    const exitRef = useRef(onExit);
    exitRef.current = onExit;
    const vmRef = useRef<SaveableVm | null>(null);
    const storageRef = useRef<TessloStorage | null>(null);

    // 浮层状态（渲染在外层 React 树，与工作台 root 独立）
    const [exportOpen, setExportOpen] = React.useState(false);
    const [exportBusy, setExportBusy] = React.useState(false);
    const [aboutOpen, setAboutOpen] = React.useState(false);
    // 成功提示（导出完成）
    const [toast, setToast] = React.useState<string | null>(null);

    // 保存当前版（导航条保存 / 返回 / 导出前共用）：null = 成功，否则返回可展示错误
    const saveCurrent = async (): Promise<ErrorPresentation | null> => {
        const vm = vmRef.current;
        const storage = storageRef.current;
        if (vm === null || storage === null) {
            return {title: '保存失败', text: '编辑器还没准备好，请稍后再试。', action: 'retry'};
        }
        try {
            await storage.saveProject(project.id, vm.toJSON(), {});
            return null;
        } catch (cause) {
            return presentError(cause);
        }
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return undefined;
        }
        const storage = new TessloStorage({
            adapter,
            projectId: project.id,
            projectName: project.name
        });
        storageRef.current = storage;

        // 自持 EditorState：Provider 包住导航条 + GUI，导航条可直接 dispatch 设置
        const editorState = new EditorState({locale}, () => ({storage}));
        const store = editorState.store;
        setAppElement(container);

        const root = createRoot(container);
        root.render(
            <Provider store={store}>
                <div className="tesslo-workbench">
                    <WorkbenchNav
                        projectName={project.name}
                        {...(logo !== undefined ? {logo} : {})}
                        onSave={saveCurrent}
                        onBack={() => {
                            void (async () => {
                                await saveCurrent();
                                exitRef.current();
                            })();
                        }}
                        onExport={() => setExportOpen(true)}
                        onAbout={() => setAboutOpen(true)}
                    />
                    <div className="tesslo-editor-gui">
                        <GUI
                            menuBarHidden
                            canSave
                            canEditTitle={false}
                            canModifyCloudData={false}
                            canCreateNew={false}
                            canRemix={false}
                            canShare={false}
                            canUseCloud={false}
                            isTelemetryEnabled={false}
                            showTelemetryModal={false}
                            projectId={project.id}
                            platform="DESKTOP"
                            onVmInit={(vm: unknown) => {
                                vmRef.current = vm as SaveableVm;
                                storage.attachVm(vm as VmHandle);
                            }}
                            onProjectTelemetryEvent={() => {}}
                        />
                    </div>
                </div>
            </Provider>
        );
        return () => {
            root.unmount();
        };
        // 项目 ID 变化 = 新会话；其余依赖经 ref 取最新（刻意窄依赖，不随文案/logo 重建编辑器）
    }, [project.id, adapter, locale, logo, project.name]);

    return (
        <React.Fragment>
            <div ref={containerRef} className="tesslo-workbench-host" />
            {exportOpen ? (
                <ExportDialog
                    project={project}
                    busy={exportBusy}
                    onClose={() => {
                        if (!exportBusy) {
                            setExportOpen(false);
                        }
                    }}
                    onChoose={format => {
                        setExportBusy(true);
                        void (async () => {
                            // 导出前先保存：保证导出内容与当前编辑一致
                            await saveCurrent();
                            const done = await Promise.resolve(onExportProject?.(project, format));
                            if (done === true) {
                                const extension = format === 'html' ? '.html' : `.${format}`;
                                setToast(`已导出「${project.name}」${extension}`);
                            }
                        })().catch(() => {
                            // 装配层已弹出错误提示；这里只负责收尾
                        }).finally(() => {
                            setExportBusy(false);
                            setExportOpen(false);
                        });
                    }}
                />
            ) : null}
            {aboutOpen ? (
                <AboutModal
                    {...(logo !== undefined ? {logo} : {})}
                    onRequestClose={() => setAboutOpen(false)}
                />
            ) : null}
            {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
        </React.Fragment>
    );
};
